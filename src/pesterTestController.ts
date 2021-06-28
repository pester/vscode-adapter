import { Disposable, Extension, ExtensionContext, RelativePattern, test, TestController, TestItem, workspace } from 'vscode'
import { TestData, TestDefinition, TestFile } from './pesterTestTree'
import { IPowerShellExtensionClient } from './powershellExtensionClient'

/** A wrapper for the vscode TestController API specific to PowerShell Pester Test Suite.
 * This should only be instantiated once in the extension activate method.
 */
export class PesterTestController implements Disposable {
    constructor(
        private readonly powershellExtension: Extension<IPowerShellExtensionClient>,
        private readonly context: ExtensionContext,
        public readonly id: string = 'Pester',
        public testController: TestController = test.createTestController(id)
    ) {
        this.testController.root.label = id

        // wire up our custom handlers to the managed instance
        // HACK: https://github.com/microsoft/vscode/issues/107467#issuecomment-869261078
        testController.resolveChildrenHandler = testItem => this.resolveChildrenHandler(testItem)
        // testController.runHandler = testItem => this.runHandler(testItem)

        // Tells the test controller to run resolveChildrenHandler() on the root
        testController.root.canResolveChildren = true
    }

    /** Start up the test controller. This includes watching all workspaces for Pester files */
    async initialize() {
        try {
            this.watchWorkspaces()
        } catch (err) {
            throw new Error(err)
        }
    }

    /** The test controller API calls this whenever it needs to get the resolveChildrenHandler
     * for Pester, this is only relevant to TestFiles as this is pester's lowest level of test resolution
     */
    private async resolveChildrenHandler(testItem: TestItem) {
        // the test root being provided to this handler indicates initial startup of the extension
        if (testItem === this.testController.root) {
            this.initialize()
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
            testItemData.discoverTests()

            // FIXME: Move this to a handler for incoming items
            // .then(tests => {
            //     // Use a lookup as a temporary hierarchy workaround until a recursive lookup can be made
            //     // TODO: A recursive child lookup is going to be needed now that things have switched to objects rather than IDs
            //     const testItemLookup = new Map<string, TestItem>()

            //     for (const testItem of tests) {
            //         // Default to the testFile if a deeper hierarchy is not found
            //         const parent = testItemLookup.get(testItem.parent) ?? item
            //         const newTestItem = testController.createTestItem(
            //             testItem.id,
            //             testItem.label,
            //             parent,
            //             testItem.uri
            //         )
            //         newTestItem.range = new Range(testItem.startLine,0,testItem.endLine,0)
            //         newTestItem.description = testItem.tags ? testItem.tags : undefined
            //         newTestItem.debuggable = true
            //         TestData.set(newTestItem, testItem)
            //         testItemLookup.set(newTestItem.id, newTestItem)
            //     }
            // })
        } else {
            throw new Error("TestItem received but did not recognize the type")
        }
        // TODO: Watch for unsaved document changes and try invoke-pester on scriptblock
        testItem.busy = false
    }

    // async runHandler(request: TestRunRequest) {
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
        }
    }

    dispose() {this.testController.dispose()}

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