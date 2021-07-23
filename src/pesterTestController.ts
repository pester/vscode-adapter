import { join } from 'path'
import { Disposable, Extension, ExtensionContext, Location, Position, Range, RelativePattern, TestController, TestItem, TestMessage, TestResultState, TestRunProfileKind, TestRunRequest, tests, Uri, window, workspace } from 'vscode'
import { DotnetNamedPipeServer } from './dotnetNamedPipeServer'
import { TestData, TestDefinition, TestFile, TestResult } from './pesterTestTree'
import { IPowerShellExtensionClient, PowerShellExtensionClient } from './powershellExtensionClient'

/** A wrapper for the vscode TestController API specific to PowerShell Pester Test Suite.
 * This should only be instantiated once in the extension activate method.
 */
export class PesterTestController implements Disposable {
    constructor(
        private readonly powershellExtension: Extension<IPowerShellExtensionClient>,
        private readonly context: ExtensionContext,
        public readonly id: string = 'Pester',
        public testController: TestController = tests.createTestController(id, id),
        private powerShellExtensionClient? : PowerShellExtensionClient,
        private returnServer: DotnetNamedPipeServer = new DotnetNamedPipeServer(id + 'TestController-' + process.pid)
    ) {

        // wire up our custom handlers to the managed instance
        // HACK: https://github.com/microsoft/vscode/issues/107467#issuecomment-869261078
        testController.resolveHandler = testItem => this.resolveChildrenHandler(testItem)
        // FIXME: Enums don't work for some reason for createrunprofile
        testController.createRunProfile('Run',TestRunProfileKind.Run, this.runHandler.bind(this), true)
        testController.createRunProfile('Debug',TestRunProfileKind.Debug, this.debugHandler.bind(this), true)
    }

    private initialized: boolean = false
    /** Start up the test controller. This includes watching all workspaces for Pester files */
    async initialize() {
        try {
            await Promise.all([
                this.watchWorkspaces(),
                this.returnServer.listen()
            ])
            this.initialized = true
        } catch (err: any) {
            if (err) {
                throw new Error(err)
            }
        }
    }


    /** The test controller API calls this whenever it needs to get the resolveChildrenHandler
     * for Pester, this is only relevant to TestFiles as this is pester's lowest level of test resolution
     */
    private async resolveChildrenHandler(testItem: TestItem|undefined) {
        if (!this.initialized) {
            await this.initialize()
        }
        // For the controller root, children are resolved via the watchers
        if (!testItem) {
            return
        }

        const testItemData = TestData.get(testItem)
        if (!testItemData) {throw new Error('No matching testItem data found. This is a bug')}

        // Test Definitions should never show up here, they aren't resolvable in Pester as we only do it at file level
        if (testItemData instanceof TestDefinition) {
            console.log(`WARNING: Received a test definition ${testItemData.id} to resolve. Should not happen`)
        }

        // TODO: Wire this back up to the test adapter
        const testItemLookup = new Map<string, TestItem>()
        const testItemDiscoveryHandler = (t: object) => {
            // TODO: This should be done before onDidReceiveObject maybe as a handler callback?
            const testDef = t as TestDefinition
            const parent = testItemLookup.get(testDef.parent) ?? testItem
            const newTestItem = this.testController.createTestItem(
                testDef.id,
                testDef.label,
                testItem.uri
            )
            newTestItem.range = new Range(testDef.startLine,0,testDef.endLine,0)
            newTestItem.description = testDef.tags ? testDef.tags : undefined
            TestData.set(newTestItem, testDef)
            testItemLookup.set(newTestItem.id, newTestItem)
            parent.children.add(newTestItem)
        }

        // Indicate the start of a discovery, will cause the UI to show a spinner
        testItem.busy = true
        if (testItemData instanceof TestFile) {
            // Run Pester and get tests
            console.log('Discovering Tests: ',testItem.id)

            // For discovery we discard the terminal output
            await this.startPesterInterface(
                [testItem],
                testItemDiscoveryHandler,
                true,
                false
            )
        } else {
            throw new Error("TestItem received but did not recognize the type")
        }
        testItem.busy = false
    }

    private async debugHandler(request: TestRunRequest) {
        this.testHandler(request, true)
    }
    /** Called by the test controller when "run" is clicked **/
    private async runHandler(request: TestRunRequest) {
        this.testHandler(request, false)
    }

    /** The test controller API calls this when tests are requested to run in the UI. It handles both runs and debugging */
    private async testHandler(request: TestRunRequest, debug: boolean) {
        if (!this.initialized) {
            await this.initialize()
        }
        // Pester doesn't understand a "root" test so get all files registered to the controller instead
        const tcItems = new Set<TestItem>()
        this.testController.items.forEach(item => tcItems.add(item))
        const testFiles = request.include === undefined
            ? Array.from(tcItems)
            : request.include

        const run = this.testController.createTestRun(request)
        if (request.exclude?.length) {
            window.showWarningMessage("Pester: Hiding tests is currently not supported. The tests will still be run but their status will be suppressed")
        }

        for (const testItem of testFiles) {
            const testData = TestData.get(testItem)
            if (!testData) {throw new Error("testItem not found in testData. This is a bug.")}

            // TODO: Fix when API stabilizes
            // FIXME: Find another way to do this, as new API changed this from an array to an iterable and couting the size doesnt work aynmore
            // if ((testData instanceof TestFile) && testItem.children.size === 0) {
            //     window.showWarningMessage('TEMPORARY: You must expand a test file at least once before you run it')
            //     run.end()
            //     return
            // }
            execChildren(testItem, item => run.enqueued(item))

        }
        const testReturnAccumulator = new Array<TestItem>()
        const runResultHandler = (item: Object) => {
            const testResult = item as TestResult
            // Skip Test Suites for now, focus on test results
            if (testResult.type === 'Block') {return}

            // We may have received more results than we had runners due to test cases and summaries, go ahead
            // and process all returned results
            const testRequestItem = this.testController.items.get(testResult.id)
            if (!testRequestItem) {throw new Error(`Test Result with ID ${testResult.id} doesn't exist in the controller test tree. This is a bug`)}

            if (testResult.result === TestResultState.Passed) {
                run.passed(testRequestItem, testResult.duration)
            }

            // TODO: This is clumsy and should be a constructor/method on the TestData type perhaps
            const message = testResult.message && testResult.expected && testResult.actual
                ? TestMessage.diff(
                        testResult.message,
                        testResult.expected,
                        testResult.actual
                    )
                : new TestMessage(testResult.message)
            if (testResult.targetFile != undefined && testResult.targetLine != undefined) {
                message.location = new Location(
                    Uri.file(testResult.targetFile),
                    new Position(testResult.targetLine, 0)
                )
            }
            if (message.message) {
                run.failed(testRequestItem, message)
            }
            testReturnAccumulator.push(testRequestItem)
        }

        testFiles.forEach(testItem => execChildren(testItem, item => run.started(item)))
        const terminalOutput = await this.startPesterInterface(
            testFiles,
            runResultHandler,
            false,
            debug
        )
        // Because we are capturing from a terminal, some intermediate line breaks can be introduced
        // due to window resizing so we want to strip those out
        const fullWidthTerminalOutput = terminalOutput.replace(/\r?\n/g,'')
        run.appendOutput(fullWidthTerminalOutput)
        run.end()
    }



    /** Runs pester in the PSIC. Results will be sent via a named pipe and handled as events
     * Returns a promise that completes with the terminal output during the pester run
     * returnHandler will run on each object that comes back from the Pester Interface
    */
    // TODO: Mutex or otherwise await so that this can only happen one at a time?
    private async startPesterInterface(
        testItems: TestItem[],
        returnHandler: (event: Object) => void,
        discovery?: boolean,
        debug?: boolean,
    ) {

        // Derive Pester-friendly test line identifiers from the testItem info
        const testsToRun = testItems.map(testItem => {
            if (!testItem.uri) {throw new Error('TestItem did not have a URI. For pester, this is a bug')}
            const fsPath = testItem.uri.fsPath
            const testLine = testItem.range?.start.line
                ? [fsPath, testItem.range.start.line+1].join(':')
                : fsPath
            return testLine
        })

        const scriptFolderPath = join(this.context.extension.extensionPath, 'Scripts')
        const scriptPath = join(scriptFolderPath, 'PesterInterface.ps1')
        const scriptArgs = new Array<string>()

        if (discovery) {scriptArgs.push('-Discovery')}

        scriptArgs.push('-PipeName')
        scriptArgs.push(this.returnServer.name)
        scriptArgs.push(...testsToRun)

        if (!this.powerShellExtensionClient) {
            this.powerShellExtensionClient = await PowerShellExtensionClient.create(
                this.context,
                this.powershellExtension
            )
        }

        const pesterSettings = this.powerShellExtensionClient.GetPesterSettings()

        let verbosity = debug
            ? pesterSettings.get<string>('debugOutputVerbosity')
            : pesterSettings.get<string>('outputVerbosity')

        if (discovery) {verbosity = 'None'}
        if (verbosity && verbosity != 'FromPreference') {
            scriptArgs.push('-Verbosity')
            scriptArgs.push(verbosity)
        }

        const runObjectListenEvent = this.returnServer.onDidReceiveObject(returnHandler)

        // HACK: Calling this function indirectly starts/waits for PSIC to be available
        await this.powerShellExtensionClient.GetVersionDetails()

        // No idea if this will work or not
        const terminalData = new Promise<string>(resolve => this.powerShellExtensionClient!.RunCommand(scriptPath, scriptArgs, debug, (terminalData) => {
            runObjectListenEvent.dispose()
            console.log("Terminal Results",terminalData)
            return resolve(terminalData)
        }))
        return terminalData
    }

    /**
     * Scans the specified files for Pester Tests
     *
     * @param {TestItem[]} testFiles - Managed Test Items. These should always be files for Pester.
     */
    // async discoverTests(testFiles: TestItem[]) {
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
    // }


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
            const tests = this.testController.items
            testWatcher.onDidCreate(uri => tests.add(TestFile.getOrCreate(testController, uri)))
            testWatcher.onDidDelete(uri => tests.delete(uri.toString()))
            testWatcher.onDidChange(uri => this.testController.resolveHandler!(TestFile.getOrCreate(testController, uri)))

            // TODO: Make this a setting
            const isPesterTestFile = /\.[tT]ests\.[pP][sS]1$/

            workspace.onDidOpenTextDocument(e => {
                if (!isPesterTestFile.test(e.fileName)) {return}
                this.testController.resolveHandler!(TestFile.getOrCreate(testController, e.uri))
            })

            const files = await workspace.findFiles(pattern)
            for (const file of files) {
                console.log("Detected Pester File: ",file.fsPath)
                TestFile.getOrCreate(testController, file)
            }
        }
    }

    /** Find a TestItem by its ID in the TestItem tree hierarchy of this controller */
    // TODO: Maybe build a lookup cache that is populated as items are added
    getTestItemById(id: string) {
        this.testController.items.get(id)
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
        // queue.push(...item.children.all())
    }
    return accumulator
}



/** Runs the specified function on this item and all its children, if present */
async function execChildren(parent: TestItem, fn: (child: TestItem) => void) {
    const queue = [parent]
    while (queue.length) {
        const item = queue.shift()!;
        fn(item)
        // queue.push(...item.children.values())
    }
}