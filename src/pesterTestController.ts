import * as Path from 'path'
import * as vscode from 'vscode'
import { PowerShellRunner } from './powershellRunner'

/** Represents a test result returned from pester, serialized into JSON */

export type PesterTestInfo = vscode.TestItemOptions | TestRunResult | TestDefinition

/** The type used to represent a test run from the Pester runner, with additional status data */
export interface TestRunResult extends vscode.TestItemOptions {
    result: vscode.TestResultState
    duration: number
    message: string
    expected: string
    actual: string
    targetFile: string
    targetLine: number
}

export interface TestDefinition extends vscode.TestItemOptions {
    startLine: number
    endLine: number
    file: string
    description?: string
    error?: string
}

/** A union that represents all types of TestItems related to Pester */
export type TestData = TestFile | TestDefinition

/**
 * An "implementation" of TestItem that represents the test hierachy in a workspace.
 * For Pester, the resolveHandler will find Pester test files and instantiate them as TestFile objects, which will in turn discover the tests in each file
*/
export class WorkspaceTestRoot {
    // A static method is used instead of a constructor so that this can be used async
    static create(
        workspaceFolder: vscode.WorkspaceFolder,
        token: vscode.CancellationToken,
        pesterTestController: PesterTestController,
    ): vscode.TestItem<WorkspaceTestRoot, TestFile> {
        // item is meant to generically represent "this new item we are building" in a test hierarchy
        // First generic type is what the data property should be (if used). Second generic type is what kind of children it can have
        const item = vscode.test.createTestItem<WorkspaceTestRoot, TestFile>({
            id: `pester ${workspaceFolder.uri}`,
            label: 'Pester',
            uri: workspaceFolder.uri
        })

        item.status = vscode.TestItemStatus.Pending
        item.resolveHandler = async token => {
            // TODO: Make this a setting
            const pattern = new vscode.RelativePattern(workspaceFolder, '**/*.[tT]ests.[pP][sS]1')
            const watcher = vscode.workspace.createFileSystemWatcher(pattern)
            // const contentChange = new vscode.EventEmitter<vscode.Uri>()
            const files = await vscode.workspace.findFiles(pattern)

            for (const uri of files) {
                item.addChild(TestFile.create(uri, pesterTestController))
            }
            item.status = vscode.TestItemStatus.Resolved

            watcher.onDidCreate(
                uri => item.addChild(TestFile.create(uri, pesterTestController))
            )
            watcher.onDidChange(
                uri => {
                    const testFile = item.children.get(uri.toString())
                    if (testFile && testFile.resolveHandler) {
                        // TODO: Use an event handler like the markdown test example
                        testFile.dispose()
                        item.addChild(TestFile.create(uri, pesterTestController))
                    } else {
                        console.log(`A test file wasnt returned or the test file didnt have a resolvehandler for ${uri.toString()}. This is probably a bug`)
                    }
                }
            )
            watcher.onDidDelete(uri => item.children.get(uri.toString())?.dispose())

            token.onCancellationRequested(() => {
                // Tell vscode to rescan the whole workspace for tests via resolveHandler
                item.status = vscode.TestItemStatus.Pending
                watcher.dispose()
            })
        }

        // TODO: Add setting to scan all files on startup

        return item
    }

    constructor(public readonly workspaceFolder: vscode.WorkspaceFolder) { }
}

/**
 * Represents a Pester Test file, typically named .tests.ps1.
 * Its resolveHandler will run the DiscoverTests.ps1 script on the file it represents to discover the Context/Describe/It blocks within.
 * */
export class TestFile {
    public static create(testFilePath: vscode.Uri, ps: PesterTestController) {
        const item = vscode.test.createTestItem<TestFile, TestData>({
            id: testFilePath.toString(),
            label: testFilePath.path.split('/').pop()!,
            uri: testFilePath
        })
        item.resolveHandler = async token => {
            token.onCancellationRequested(() => {
                item.status = vscode.TestItemStatus.Pending
            })
            const fsPath = testFilePath.fsPath
            const fileTests = await ps.discoverPesterTests([fsPath], true)
            for (const testItem of fileTests) {
                try {
                    item.addChild(
                        TestIt.create(testItem)
                    )
                } catch (err) {
                    vscode.window.showErrorMessage(err.message)
                }
            }
            item.status = vscode.TestItemStatus.Resolved
        }
        item.debuggable = false
        item.runnable = false
        item.status = vscode.TestItemStatus.Pending
        return item
    }
}

/** Represents an "It" statement block in Pester which roughly correlates to a Test Case or set of Cases */
export class TestIt {
    public static create(
        info: TestDefinition
    ) {
        info.uri = vscode.Uri.file(info.file)
        const item = vscode.test.createTestItem<TestDefinition, never>(info, info)

        // There are no child items here so we don't need a resolve handler
        item.status = vscode.TestItemStatus.Resolved

        item.debuggable = true
        item.runnable = true
        item.range = new vscode.Range(info.startLine, 0, info.endLine, 0)
        return item
    }
}


/**
 * @inheritdoc
 */
export class PesterTestController implements vscode.TestController<TestData> {

    /** Initializes a Pester Test controller to use a particular ps extension. The controller will spawn a shared pwsh runner to be used for all test activities */
    static async create(context: vscode.ExtensionContext, psextension: vscode.Extension<any>) {
        // TODO: Figure out how to lazy load this later
        // const pseClient = await PowerShellExtensionClient.create(context, psextension)
        // const pseDetails = await pseClient.GetVersionDetails();
        // // Node-Powershell will auto-append the .exe for some reason so we have to strip it first.
        // const psExePath = pseDetails.exePath.replace(new RegExp('\.exe$'), '')
        const psExePath = 'pwsh'

        // This returns a promise so that the runner can be lazy initialized later when Pester Tests actually need to be run
        const powerShellRunner = PowerShellRunner.create(psExePath)
        return new PesterTestController(powerShellRunner,context)
    }

    constructor(private readonly powerShellRunner : Promise<PowerShellRunner>, private readonly context : vscode.ExtensionContext) {}

    /**
     * @inheritdoc
     */
    createWorkspaceTestRoot(workspace: vscode.WorkspaceFolder, token: vscode.CancellationToken) {
        // return WorkspaceTestRoot.create(workspace, token, this.powerShellRunner, this.context.extensionPath)
        return WorkspaceTestRoot.create(workspace, token, this)
    }

    /**
     * @inheritdoc
     */
    createDocumentTestRoot(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.TestItem<TestData, TestData> | undefined{
        // TODO: Implement for on-the-fly pester tests in an unsaved document
        // WARNING: If this is not present, createworkspacetestroot will get called twice until https://github.com/microsoft/vscode/issues/126290 is fixed
        return
    }

    /** Fetch the Pester Test json information for a particular path(s) */
    async getPesterTests<T extends PesterTestInfo>(path: string[], discoveryOnly?: boolean, testsOnly?: boolean) {
        const scriptFolderPath = Path.join(this.context.extension.extensionPath, 'Scripts')
        const scriptPath = Path.join(scriptFolderPath, 'PesterInterface.ps1')
        let scriptArgs = Array<string>()
        if (testsOnly) {scriptArgs.push('-TestsOnly')}
        if (discoveryOnly) {scriptArgs.push('-Discovery')}
        // Add remaining search paths as arguments, these will be rolled up into the path parameter of the script
        scriptArgs.push(...path)

        // Lazy initialize the powershell runner so the filewatcher-based test finder works quickly
        const runner = await this.powerShellRunner
        // TODO: Need validation here
        const result:T[] = await runner.execPwshScriptFile(scriptPath,scriptArgs) as T[]
        console.log('Objects received from Pester',result)

        // TODO: Refactor this using class-transformer https://github.com/typestack/class-transformer

        // Coerce null/undefined into an empty arrayP
        if (result == null || result == undefined) {return new Array<T>()}

        // BUG: ConvertTo-Json in PS5.1 doesn't have a "-AsArray" and can return single objects which typescript doesn't catch.
        if (!Array.isArray(result)) {throw 'Powershell script returned a single object that is not an array. This is a bug. Make sure you did not pipe to Convert-Json!'}
        return result
    }
    /** Retrieve Pester Test information without actually running them */
    async discoverPesterTests(path: string[], testsOnly?: boolean) {
        return this.getPesterTests<TestDefinition>(path, true, testsOnly)
    }
    /** Run Pester Tests and retrieve the results */
    async runPesterTests(path: string[], testsOnly?: boolean) {
        return this.getPesterTests<TestRunResult>(path, false, testsOnly)
    }

    /**
     * @inheritdoc
     */
    async runTests(
        request: vscode.TestRunRequest<TestDefinition>,
        cancellation: vscode.CancellationToken
    ) {
        const run = vscode.test.createTestRun(request)
        // TODO: Maybe? Determine if a child of a summary block is excluded
        // TODO: Check if a child of a describe/context can be excluded, for now add warning that child hidden tests may still run
        // TODO: De-Duplicate children that can be consolidated into a higher line, this is probably not necessary.
        if (request.exclude?.length) {
            vscode.window.showWarningMessage("Pester: Hiding tests is currently not supported. The tests will still be run but their status will be suppressed")
        }

        for (const testItem of request.tests) {
            run.setState(testItem,vscode.TestResultState.Queued)
        }
        // Use a special line format to run the tests
        // +1 because lines are zero based in vscode and 1-based in Powershell
        const testsToRun = request.tests.map(testItem => {return [testItem.data.file, testItem.data.startLine+1].join(':')})

        // TODO: Use a queue instead to line these up like the test example
        for (const testItem of request.tests) {
            run.setState(testItem,vscode.TestResultState.Running)
        }
        const pesterTestRunResult = await this.runPesterTests(testsToRun, true)


        // Make this easier to query by putting the IDs in a map so we dont have to iterate an array constantly.
        // TODO: Make this part of getPesterTests?
        const pesterTestRunResultLookup = new Map<string,TestRunResult>()
        pesterTestRunResult.map(testResultItem =>
            pesterTestRunResultLookup.set(testResultItem.id, testResultItem)
        )

        for (const testRequestItem of request.tests) {
            const testResult = pesterTestRunResultLookup.get(testRequestItem.id)
            if (!testResult) {
                throw 'No Test Results were found in the test request. This should not happen and is probably a bug.'
            }
            // TODO: Test for blank or invalid result
            if (!testResult.result) {
                throw `No test result found for ${testResult.id}. This is probably a bug in the PesterInterface script`
            }

            run.setState(testRequestItem, testResult.result, testResult.duration)

            // TODO: This is clumsy and should be a constructor/method on the TestData type perhaps
            const message = testResult.message && testResult.expected && testResult.actual
                ? vscode.TestMessage.diff(
                        testResult.message,
                        testResult.expected,
                        testResult.actual
                    )
                : new vscode.TestMessage(testResult.message)
            if (testResult.targetFile != undefined && testResult.targetLine != undefined) {
                message.location = new vscode.Location(
                    vscode.Uri.file(testResult.targetFile),
                    new vscode.Position(testResult.targetLine, 0)
                )
            }
            if (message.message) {
                run.appendMessage(testRequestItem, message)
            }

            // TODO: Add error metadata
        }

        // Loop through the requested tests, correlate them to the results, and then set the appropriate status
        // TODO: There is probably a faster way to do this
        // for (const testItem in request.tests) {


        // }

        run.end()
        // testsToRun.filter(testItem =>
        //     !request.exclude?.includes(testItem)
        // )
    }
}
