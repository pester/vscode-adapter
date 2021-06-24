import { Disposable, Extension, ExtensionContext, RelativePattern, test, TestController, TestItemStatus, workspace } from 'vscode'
import { TestDefinition, TestFile, TestRootContext } from './pesterTestTree'
import { IPowerShellExtensionClient } from './powershellExtensionClient'

// Create a Test Controller for Pester which can be used to interface with the Pester APIs
export async function CreatePesterTestController(
    powershellExtension: Extension<IPowerShellExtensionClient>,
    context: ExtensionContext,
    id: string = 'Pester'
) {
    // A pester test controller should only have testfiles at its root, whether physical files or in-progress documents
    const testController = test.createTestController<TestFile>('pesterTestController')
    const testRoot = testController.root
    testRoot.label = id

    // We sort of abuse this data storage for semi-singletons like the PowershellRunner
    testRoot.data = await TestRootContext.create(testController,context,powershellExtension)


    // Wire up testController handlers to the methods defined in our new class
    // For pester, this gets called on startup, so we use it to start watching for pester files using vscode
    // We don't use pester to do initial scans because it is too heavyweight, we want to lazy load it later
    // when the user clicks on a file they want to run tests from.
    // TODO: Setting to just scan everything, useful for other views

    // Any testitem that goes to pending will flow through this method now
    testController.resolveChildrenHandler = (item) => {
        // Indicates initial startup of the extension, so scan for files that match the pester extension
        if (item === testRoot) {
            try {
                watchWorkspaces(testController, context.subscriptions)
            } catch (err) {
                throw new Error(err)
            }
            return
        }
        // We use data as a sort of "type proxy" because we can't really test type on generics directly
        if (item.data instanceof TestFile) {
            // Run Pester and get tests
            console.log('Discovering Tests: ',item.id)
            const discoveredTests = item.data.discoverTests().then(tests => {
                for (const testItem of tests) {
                    const parent = testController.root.children.get(testItem.parent) ?? testController.root
                    testController.createTestItem<TestDefinition>(
                        testItem.id,
                        testItem.label,
                        parent,
                        testItem.uri,
                        testItem
                    )
                }
            })
        }
        // TODO: Watch for unsaved document changes and try invoke-pester on scriptblock
    }

    testController.runHandler = (request, token) => {
        throw new Error('Not Implemented (TODO)')
    }

    // This will trigger resolveChildrenHandler on startup
    testRoot.status = TestItemStatus.Pending

    return testController
}

// /** Overload of {@link TestController.createTestItem} that accepts options
//  * @template T - The type of the testItem data
//  * @template TParent - What parents are allowed to exist.
//  */
// export function createTestItem<T = TestTree, TParent = TestTree>(
//     testController: TestController,
//     options: TestItemOptions<T, TParent>
// ) {
//     return testController.createTestItem<T>(
//         options.id,
//         options.label,
//         options.parent,
//         options.uri,
//         options.data
//     )
// }


/**
 * Starts up filewatchers for each workspace to identify pester files and add them to the test controller root
 *
 * @param {TestController} testController - The test controller to initiate watching on
 * @param {Disposable[]} [disposable=[]] - An array to store disposables from the watchers, usually \
{@link ExtensionContext.subscriptions} to auto-dispose the watchers on unload or cancel
 */
async function watchWorkspaces(testController: TestController, disposable: Disposable[] = []) {
    if (!workspace.workspaceFolders) {
        // TODO: Register event to look for when a workspace folder is added
        console.log('No workspace folders detected.')
        return
    }
    for (const workspaceFolder of workspace.workspaceFolders) {
        const pattern = new RelativePattern(workspaceFolder, '**/*.[tT]ests.[pP][sS]1')
        const testWatcher = workspace.createFileSystemWatcher(pattern)
        // Test files will subscribe to this and update themselves if they see a change
        // TODO: Maybe have each test register its own filewatcher?

        testWatcher.onDidCreate(uri => TestFile.getOrCreate(testController, uri),undefined,disposable)
        testWatcher.onDidDelete(uri => testController.root.children.get(uri.toString())?.dispose(),undefined,disposable)
        // const contentChange = new EventEmitter<Uri>()
        // TODO: testWatcher.onDidChange(uri => contentChange.fire(uri));

        const files = await workspace.findFiles(pattern)
        for (const file of files) {
            console.log("Detected Pester File: ",file.fsPath)
            TestFile.getOrCreate(testController, file)
        }
        testController.root.status = TestItemStatus.Resolved
    }
}




// /**
//  * An "implementation" of TestItem that represents the test hierachy in a workspace.
//  * For Pester, the resolveHandler will find Pester test files and instantiate them as TestFile objects, which will in turn discover the tests in each file
// */
// export class WorkspaceTestRoot {
//     // A static method is used instead of a constructor so that this can be used async
//     static create(
//         workspaceFolder: vscode.WorkspaceFolder,
//         token: vscode.CancellationToken,
//         pesterTestController: PesterTestController,
//     ): vscode.TestItem<WorkspaceTestRoot, TestFile> {
//         // item is meant to generically represent "this new item we are building" in a test hierarchy
//         // First generic type is what the data property should be (if used). Second generic type is what kind of children it can have
//         const item = vscode.test.createTestItem<WorkspaceTestRoot, TestFile>({
//             id: `pester ${workspaceFolder.uri}`,
//             label: 'Pester',
//             uri: workspaceFolder.uri
//         })

//         item.status = vscode.TestItemStatus.Pending
//         item.resolveHandler = async token => {
//             // TODO: Make this a setting
//             const pattern = new vscode.RelativePattern(workspaceFolder, '**/*.[tT]ests.[pP][sS]1')
//             const watcher = vscode.workspace.createFileSystemWatcher(pattern)
//             // const contentChange = new vscode.EventEmitter<vscode.Uri>()
//             const files = await vscode.workspace.findFiles(pattern)

//             for (const uri of files) {
//                 item.addChild(TestFile.create(uri, pesterTestController))
//             }
//             item.status = vscode.TestItemStatus.Resolved

//             watcher.onDidCreate(
//                 uri => item.addChild(TestFile.create(uri, pesterTestController))
//             )
//             watcher.onDidChange(
//                 uri => {
//                     const testFile = item.children.get(uri.toString())
//                     if (testFile && testFile.resolveHandler) {
//                         // TODO: Use an event handler like the markdown test example
//                         testFile.dispose()
//                         item.addChild(TestFile.create(uri, pesterTestController))
//                     } else {
//                         console.log(`A test file wasnt returned or the test file didnt have a resolvehandler for ${uri.toString()}. This is probably a bug`)
//                     }
//                 }
//             )
//             watcher.onDidDelete(uri => item.children.get(uri.toString())?.dispose())

//             token.onCancellationRequested(() => {
//                 // Tell vscode to rescan the whole workspace for tests via resolveHandler
//                 item.status = vscode.TestItemStatus.Pending
//                 watcher.dispose()
//             })
//         }

//         // TODO: Add setting to scan all files on startup

//         return item
//     }

//     constructor(public readonly workspaceFolder: vscode.WorkspaceFolder) { }
// }


// /**
//  * @inheritdoc
//  */
// export class PesterTestController implements vscode.TestController<TestData> {

//     /** Initializes a Pester Test controller to use a particular ps extension. The controller will spawn a shared pwsh runner to be used for all test activities */
//     static async create(context: vscode.ExtensionContext, psextension: vscode.Extension<any>) {
//         // TODO: Figure out how to lazy load this later
//         // const pseClient = await PowerShellExtensionClient.create(context, psextension)
//         // const pseDetails = await pseClient.GetVersionDetails();
//         // // Node-Powershell will auto-append the .exe for some reason so we have to strip it first.
//         // const psExePath = pseDetails
//         const psExePath = 'pwsh'.exePath.replace(new RegExp('\.exe$'), '')

//         // This returns a promise so that the runner can be lazy initialized later when Pester Tests actually need to be run
//         const powerShellRunner = PowerShellRunner.create(psExePath)
//         return new PesterTestController(powerShellRunner,context)
//     }

//     constructor(private readonly powerShellRunner : Promise<PowerShellRunner>, private readonly context : vscode.ExtensionContext) {}

//     /**
//      * @inheritdoc
//      */
//     createWorkspaceTestRoot(workspace: vscode.WorkspaceFolder, token: vscode.CancellationToken) {
//         // return WorkspaceTestRoot.create(workspace, token, this.powerShellRunner, this.context.extensionPath)
//         return WorkspaceTestRoot.create(workspace, token, this)
//     }

//     /**
//      * @inheritdoc
//      */
//     createDocumentTestRoot(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.TestItem<TestData, TestData> | undefined{
//         // TODO: Implement for on-the-fly pester tests in an unsaved document
//         // WARNING: If this is not present, createworkspacetestroot will get called twice until https://github.com/microsoft/vscode/issues/126290 is fixed
//         return
//     }

//     /** Fetch the Pester Test json information for a particular path(s) */
//     async getPesterTests<T extends PesterTestInfo>(path: string[], discoveryOnly?: boolean, testsOnly?: boolean) {
//         const scriptFolderPath = Path.join(this.context.extension.extensionPath, 'Scripts')
//         const scriptPath = Path.join(scriptFolderPath, 'PesterInterface.ps1')
//         let scriptArgs = Array<string>()
//         if (testsOnly) {scriptArgs.push('-TestsOnly')}
//         if (discoveryOnly) {scriptArgs.push('-Discovery')}
//         // Add remaining search paths as arguments, these will be rolled up into the path parameter of the script
//         scriptArgs.push(...path)

//         // Lazy initialize the powershell runner so the filewatcher-based test finder works quickly
//         const runner = await this.powerShellRunner
//         // TODO: Need validation here
//         const runnerResult = await runner.execPwshScriptFile(scriptPath,scriptArgs)
//         console.log('Objects received from Pester',runnerResult.result)
//         const result:T[] = runnerResult.result as T[]

//         // TODO: Refactor this using class-transformer https://github.com/typestack/class-transformer

//         // Coerce null/undefined into an empty arrayP
//         if (result == null || result == undefined) {return new Array<T>()}

//         // BUG: ConvertTo-Json in PS5.1 doesn't have a "-AsArray" and can return single objects which typescript doesn't catch.
//         if (!Array.isArray(result)) {throw 'Powershell script returned a single object that is not an array. This is a bug. Make sure you did not pipe to Convert-Json!'}
//         return result
//     }
//     /** Retrieve Pester Test information without actually running them */
//     async discoverPesterTests(path: string[], testsOnly?: boolean) {
//         return this.getPesterTests<TestDefinition>(path, true, testsOnly)
//     }
//     /** Run Pester Tests and retrieve the results */
//     async runPesterTests(path: string[], testsOnly?: boolean) {
//         return this.getPesterTests<TestRunResult>(path, false, testsOnly)
//     }

//     /**
//      * @inheritdoc
//      */
//     async runTests(
//         request: vscode.TestRunRequest<TestDefinition>,
//         cancellation: vscode.CancellationToken
//     ) {
//         const run = vscode.test.createTestRun(request)
//         // TODO: Maybe? Determine if a child of a summary block is excluded
//         // TODO: Check if a child of a describe/context can be excluded, for now add warning that child hidden tests may still run
//         // TODO: De-Duplicate children that can be consolidated into a higher line, this is probably not necessary.
//         if (request.exclude?.length) {
//             vscode.window.showWarningMessage("Pester: Hiding tests is currently not supported. The tests will still be run but their status will be suppressed")
//         }

//         for (const testItem of request.tests) {
//             run.setState(testItem,vscode.TestResultState.Queued)
//         }
//         // Use a special line format to run the tests
//         // +1 because lines are zero based in vscode and 1-based in Powershell
//         const testsToRun = request.tests.map(testItem => {
//             // HACK: Workaround for TestFile. This should be an exposed getter on TestFile but I can't get it to work right now.
//             if (!testItem.data) {
//                 return testItem.uri!.fsPath
//             }
//             return [testItem.data.file, testItem.data.startLine+1].join(':')}
//         )

//         // TODO: Use a queue instead to line these up like the test example
//         for (const testItem of request.tests) {
//             run.setState(testItem,vscode.TestResultState.Running)
//         }
//         const pesterTestRunResult = await this.runPesterTests(testsToRun, true)


//         // Make this easier to query by putting the IDs in a map so we dont have to iterate an array constantly.
//         // TODO: Make this part of getPesterTests?
//         const pesterTestRunResultLookup = new Map<string,TestRunResult>()
//         pesterTestRunResult.map(testResultItem =>
//             pesterTestRunResultLookup.set(testResultItem.id, testResultItem)
//         )

//         const requestedTests = request.tests

//         // Include all relevant children
//         // TODO: Recurse for multiple levels
//         for (const testRequestItem of request.tests) {
//             requestedTests.push(...testRequestItem.children.values())
//         }

//         for (const testRequestItem of requestedTests) {
//             try {
//                 // Skip Testfiles
//                 // HACK: Should be doing this by class rather than searching for delimiter
//                 if (!/>>/.test(testRequestItem.id)) {
//                     continue
//                 }
//                 let testResult = pesterTestRunResultLookup.get(testRequestItem.id)

//                 if (!testResult) {
//                     throw 'No Test Results were found in the test request. This should not happen and is probably a bug.'
//                 }
//                 // TODO: Test for blank or invalid result
//                 if (!testResult.result) {
//                     throw `No test result found for ${testResult.id}. This is probably a bug in the PesterInterface script`
//                 }

//                 run.setState(testRequestItem, testResult.result, testResult.duration)

//                 // TODO: This is clumsy and should be a constructor/method on the TestData type perhaps
//                 const message = testResult.message && testResult.expected && testResult.actual
//                     ? vscode.TestMessage.diff(
//                             testResult.message,
//                             testResult.expected,
//                             testResult.actual
//                         )
//                     : new vscode.TestMessage(testResult.message)
//                 if (testResult.targetFile != undefined && testResult.targetLine != undefined) {
//                     message.location = new vscode.Location(
//                         vscode.Uri.file(testResult.targetFile),
//                         new vscode.Position(testResult.targetLine, 0)
//                     )
//                 }
//                 if (message.message) {
//                     run.appendMessage(testRequestItem, message)
//                 }
//             } catch (err) {
//                 console.log(err)
//             }


//             // TODO: Add error metadata
//         }

//         // Loop through the requested tests, correlate them to the results, and then set the appropriate status
//         // TODO: There is probably a faster way to do this
//         // for (const testItem in request.tests) {


//         // }

//         run.end()
//         // testsToRun.filter(testItem =>
//         //     !request.exclude?.includes(testItem)
//         // )
//     }
// }
