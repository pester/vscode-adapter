import { join } from 'path'
import { Disposable, Extension, ExtensionContext, Range, RelativePattern, test, TestController, TestItem, TestRunRequest, workspace } from 'vscode'
import { DotnetNamedPipeServer } from './dotnetNamedPipeServer'
import { TestData, TestDefinition, TestFile } from './pesterTestTree'
import { IPowerShellExtensionClient, PowerShellExtensionClient } from './powershellExtensionClient'

/** A wrapper for the vscode TestController API specific to PowerShell Pester Test Suite.
 * This should only be instantiated once in the extension activate method.
 */
export class PesterTestController implements Disposable {
    constructor(
        private readonly powershellExtension: Extension<IPowerShellExtensionClient>,
        private readonly context: ExtensionContext,
        public readonly id: string = 'Pester',
        public testController: TestController = test.createTestController(id),
        private powerShellExtensionClient? : PowerShellExtensionClient,
        private returnServer: DotnetNamedPipeServer = new DotnetNamedPipeServer(id + 'TestController-' + process.pid)
    ) {
        this.testController.root.label = id

        // wire up our custom handlers to the managed instance
        // HACK: https://github.com/microsoft/vscode/issues/107467#issuecomment-869261078
        testController.resolveChildrenHandler = testItem => this.resolveChildrenHandler(testItem)
        testController.runHandler = testItem => this.runHandler(testItem)

        // Tells the test controller to run resolveChildrenHandler() on the root
        testController.root.canResolveChildren = true
    }

    /** Start up the test controller. This includes watching all workspaces for Pester files */
    private initialized: boolean = false
    async initialize() {
        try {
            await Promise.all([
                this.watchWorkspaces(),
                this.returnServer.listen()
            ])
            this.initialized = true
        } catch (err) {
            throw new Error(err)
        }
    }


    /** The test controller API calls this whenever it needs to get the resolveChildrenHandler
     * for Pester, this is only relevant to TestFiles as this is pester's lowest level of test resolution
     */
    private async resolveChildrenHandler(testItem: TestItem) {
        if (!this.initialized) {
            await this.initialize()
        }
        // For the controller root, children are resolved via the watchers
        if (testItem === this.testController.root) {
            return
        }

        const testItemData = TestData.get(testItem)
        if (!testItemData) {throw new Error('No matching testItem data found. This is a bug')}

        // Test Definitions should never show up here, they aren't resolvable in Pester as we only do it at file level
        if (testItemData instanceof TestDefinition) {
            console.log(`WARNING: Received a test definition ${testItemData.id} to resolve. Should not happen`)
        }

        if (testItemData instanceof TestFile) {
            // Run Pester and get tests
            console.log('Discovering Tests: ',testItem.id)

            if (!this.powerShellExtensionClient) {
                this.powerShellExtensionClient = await PowerShellExtensionClient.create(
                    this.context,
                    this.powershellExtension
                )
            }

            // Indicate the start of a discovery, will cause the UI to show a spinner
            testItem.busy = true

            const scriptFolderPath = join(this.context.extension.extensionPath, 'Scripts')
            const scriptPath = join(scriptFolderPath, 'PesterInterface.ps1')
            let scriptArgs = new Array<string>()
            // if (testsOnly) {scriptArgs.push('-TestsOnly')}
            // if (discoveryOnly) {scriptArgs.push('-Discovery')}
            scriptArgs.push('-Discovery')
            // Add remaining search paths as arguments, these will be rolled up into the path parameter of the script
            scriptArgs.push(testItemData.file)

            // HACK: Calling this function indirectly starts/waits for PSIC to be available
            await this.powerShellExtensionClient.GetVersionDetails()

            scriptArgs.push('-PipeName')
            scriptArgs.push(this.returnServer.name)

            // TODO: Wire this back up to the test adapter
            const testItemLookup = new Map<string, TestItem>()

            const runObjectListenEvent = this.returnServer.onDidReceiveObject(t => {
                // TODO: This should be done before onDidReceiveObject maybe as a handler callback?
                const testDef = t as TestDefinition
                const parent = testItemLookup.get(testDef.parent) ?? testItem
                const newTestItem = this.testController.createTestItem(
                    testDef.id,
                    testDef.label,
                    parent,
                    testItem.uri
                )
                newTestItem.range = new Range(testDef.startLine,0,testDef.endLine,0)
                newTestItem.description = testDef.tags ? testDef.tags : undefined
                newTestItem.debuggable = true
                TestData.set(newTestItem, testDef)
                testItemLookup.set(newTestItem.id, newTestItem)
            })
            await this.powerShellExtensionClient.RunCommand(scriptPath, scriptArgs, false, (terminalData) => {
                runObjectListenEvent.dispose()
                // TODO: maybe promisify all the createTestItem actions and don't set this until they are done.
                // This is probably only a slight visual bug if anything.
                testItem.busy = false
            })
        } else {
            throw new Error("TestItem received but did not recognize the type")
        }
    }

    /**
     * Scans the specified files for Pester Tests
     *
     * @param {TestItem[]} testFiles - Managed Test Items. These should always be files for Pester.
     */
    async discoverTests(testFiles: TestItem[]) {




    //     // Lazy initialize the powershell runner so the filewatcher-based test finder works quickly
    //     try {
    //         const runner = await this.powerShellRunner
    //         // TODO: Need validation here
    //         const runnerResult = await runner.execPwshScriptFile(scriptPath,scriptArgs,debug)
    //         // TODO: Better error handling
    //         if (!runnerResult) {return new Array<T>()}
    //         console.log('Objects received from Pester',runnerResult.result)
    //         const result:T[] = runnerResult.result as T[]

    //         // TODO: Refactor this using class-transformer https://github.com/typestack/class-transformer

    //         // Coerce null/undefined into an empty arrayP
    //         if (result == null || result == undefined) {return new Array<T>()}

    //         // BUG: ConvertTo-Json in PS5.1 doesn't have a "-AsArray" and can return single objects which typescript doesn't catch.
    //         if (!Array.isArray(result)) {throw 'Powershell script returned a single object that is not an array. This is a bug. Make sure you did not pipe to Convert-Json!'}
    //         return result
    //     } catch (err) {
    //         throw new Error(err)
    //     }
    // }



        // HACK: Because the managed controller data type is returned as an <any>, we need to type assert it back to a TestRootContext
        // so that the return type is inferred correctly
        // const testRootContext: TestRootContext = TestControllerData.get(this.controller.root)!
        // Ask the controller to run tests, then also register a callback that this is done scanning.
        // return await testRootContext.discoverPesterTestsFromFile(this)
        testFiles.forEach(testItem => testItem.busy = false)
    }

    async runHandler(request: TestRunRequest) {
        console.log(request)
    }
    //     const run = this.testController.createTestRun(request)
    //     if (request.debug) {console.log("Debugging was requested")}
    //     // TODO: Maybe? Determine if a child of a summary block is excluded
    //     // TODO: Check if a child of a describe/context can be excluded, for now add warning that child hidden tests may still run
    //     // TODO: De-Duplicate children that can be consolidated into a higher line, this is probably not necessary.
    //     if (request.exclude?.length) {
    //         window.showWarningMessage("Pester: Hiding tests is currently not supported. The tests will still be run but their status will be suppressed")
    //     }

    //     for (const testItem of request.tests) {
    //         const testData = TestData.get(testItem)
    //         if (!testData) {throw new Error("testItem not found in testData. This is a bug.")}

    //         execChildren(testItem, item => item.busy = true)

    //         // Do a discovery on empty test files first. TODO: Probably a way to consolidate this with the runner so it doesn't run Pester twice
    //         if ((testData instanceof TestFile) && testItem.children.size === 0) {
    //             // TODO: Fix when API stabilizes
    //             window.showWarningMessage('TEMPORARY: You must expand a test file at least once before you run it')
    //             run.end()
    //             return
    //         }
    //         run.setState(testItem,TestResultState.Queued)
    //     }

    //     const testsToRun: string[] = []
    //     request.tests.map(testItem => {
    //         const testData = TestData.get(testItem)
    //         if (!testData) {throw new Error("testItem not found in testData. This is a bug.")}
    //         const testLine = testData.startLine
    //             ? [testData.file, testData.startLine+1].join(':')
    //             : testData.file
    //         testsToRun.push(testLine)
    //     })

    //     // TODO: Use a queue instead to line these up like the test example
    //     request.tests.map(testItem => run.setState(testItem,TestResultState.Running))
    //     // FIXME: Use a new handler
    //     const pesterTestRunResult = await testRootContext.runPesterTests(testsToRun, false, request.debug)


    //     // Make this easier to query by putting the IDs in a map so we dont have to iterate an array constantly.
    //     // TODO: Make this part of getPesterTests?
    //     const pesterTestRunResultLookup = new Map<string,TestResult>()
    //     pesterTestRunResult.map(testResultItem =>
    //         pesterTestRunResultLookup.set(testResultItem.id, testResultItem)
    //     )

    //     const requestedTests = request.tests.flatMap(
    //         item => expandAllChildren(item)
    //     )

    //     for (const testRequestItem of requestedTests) {
    //         try {
    //             // Skip Testfiles
    //             if (TestData.get(testRequestItem) instanceof TestFile) {
    //                 continue
    //             }
    //             let testResult = pesterTestRunResultLookup.get(testRequestItem.id)

    //             if (!testResult) {
    //                 throw 'No Test Results were found in the test request. This should not happen and is probably a bug.'
    //             }
    //             // TODO: Test for blank or invalid result
    //             if (!testResult.result) {
    //                 throw `No test result found for ${testResult.id}. This is probably a bug in the PesterInterface script`
    //             }

    //             run.setState(testRequestItem, testResult.result, testResult.duration)
    //             execChildren(testRequestItem, item => item.busy = false)

    //             // TODO: This is clumsy and should be a constructor/method on the TestData type perhaps
    //             const message = testResult.message && testResult.expected && testResult.actual
    //                 ? TestMessage.diff(
    //                         testResult.message,
    //                         testResult.expected,
    //                         testResult.actual
    //                     )
    //                 : new TestMessage(testResult.message)
    //             if (testResult.targetFile != undefined && testResult.targetLine != undefined) {
    //                 message.location = new Location(
    //                     Uri.file(testResult.targetFile),
    //                     new Position(testResult.targetLine, 0)
    //                 )
    //             }
    //             if (message.message) {
    //                 run.appendMessage(testRequestItem, message)
    //             }

    //         } catch (err) {
    //             console.log(err)
    //         }
    //         // TODO: Add error metadata
    //     }
    //     run.end()
    //     // testsToRun.filter(testItem =>
    //     //     !request.exclude?.includes(testItem)
    //     // )
    // }

    /**
     * Starts up filewatchers for each workspace to scan for pester files and add them to the test controller root.
     *
     * @param {TestController} testController - The test controller to initiate watching on
     * @param {Disposable[]} [disposable=[]] - An array to store disposables from the watchers, usually \
     {@link ExtensionContext.subscriptions} to auto-dispose the watchers on unload or cancel
    */
    async watchWorkspaces() {
        const testController = this.testController
        const disposable = this.context.subscriptions
        if (!workspace.workspaceFolders) {
            // TODO: Register event to look for when a workspace folder is added
            console.log('No workspace folders detected.')
            return
        }
        for (const workspaceFolder of workspace.workspaceFolders) {
            const pattern = new RelativePattern(workspaceFolder, '**/*.[tT]ests.[pP][sS]1')
            const testWatcher = workspace.createFileSystemWatcher(pattern)

            testWatcher.onDidCreate(uri => TestFile.getOrCreate(testController, uri),undefined,disposable)
            // In both these cases we can somewhat safely assume the file will already be known, hence the ! used
            testWatcher.onDidDelete(uri => TestFile.getOrCreate(testController, uri).dispose(),undefined,disposable)
            testWatcher.onDidChange(uri => this.testController.resolveChildrenHandler!(TestFile.getOrCreate(testController, uri)))

            // TODO: Make this a setting
            const isPesterTestFile = /\.[tT]ests\.[pP][sS]1$/

            workspace.onDidOpenTextDocument(e => {
                if (!isPesterTestFile.test(e.fileName)) {return}
                this.testController.resolveChildrenHandler!(TestFile.getOrCreate(testController, e.uri))
            })

            const files = await workspace.findFiles(pattern)
            for (const file of files) {
                console.log("Detected Pester File: ",file.fsPath)
                TestFile.getOrCreate(testController, file)
            }
        }
    }

    dispose() {
        this.testController.dispose()
        this.returnServer.dispose()
    }

}




/** Recursively retrieve all the children of this item along with itself */
function expandAllChildren(parent: TestItem) {
    const accumulator: TestItem[] = []
    const queue = [parent]
    while (queue.length) {
        const item = queue.shift()!;
        accumulator.push(item)
        queue.push(...item.children.values())
    }
    return accumulator
}

/** Runs the specified function on this item and all its children, if present */
async function execChildren(parent: TestItem, fn: (child: TestItem) => void) {
    const queue = [parent]
    while (queue.length) {
        const item = queue.shift()!;
        fn(item)
        queue.push(...item.children.values())
    }
}