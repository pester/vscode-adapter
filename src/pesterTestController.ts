import { Disposable, Extension, ExtensionContext, Location, Position, Range, RelativePattern, test, TestController, TestItem, TestMessage, TestResultState, Uri, window, workspace } from 'vscode'
import { TestData, TestFile, TestResult, TestRootContext } from './pesterTestTree'
import { IPowerShellExtensionClient } from './powershellExtensionClient'

export const TestControllerData = new WeakMap<TestItem, TestRootContext>()

// Create a Test Controller for Pester which can be used to interface with the Pester APIs
export async function CreatePesterTestController(
    powershellExtension: Extension<IPowerShellExtensionClient>,
    context: ExtensionContext,
    id: string = 'Pester'
) {
    // A pester test controller should only have testfiles at its root, whether physical files or in-progress documents
    // The generic type in this case represents the possible test item types that can be stored and would need to be updated
    // when a run starts
    const testController = test.createTestController(id)
    const testRoot = testController.root
    testRoot.label = id

    // We sort of abuse this data storage for semi-singletons like the PowershellRunner
    // TODO: This should be a singleton so we can just make this a const outside the function
    TestControllerData.set(
        testRoot,
        await TestRootContext.create(testController,context,powershellExtension)
    )

    // Wire up testController handlers to the methods defined in our new class
    // For pester, this gets called on startup, so we use it to start watching for pester files using vscode
    // We don't use pester to do initial scans because it is too heavyweight, we want to lazy load it later
    // when the user clicks on a file they want to run tests from.
    // TODO: Setting to just scan everything, useful for other views

    /** @inheritdoc */
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

        const testItem = TestData.get(item)
        if (!testItem) {throw new Error('No matching testItem data found. This is a bug')}
        // We use data as a sort of "type proxy" because we can't really test type on generics directly
        if (testItem instanceof TestFile) {
            // Run Pester and get tests
            console.log('Discovering Tests: ',item.id)
            testItem.discoverTests().then(tests => {
                // Use a lookup as a temporary hierarchy workaround until a recursive lookup can be made
                // TODO: A recursive child lookup is going to be needed now that things have switched to objects rather than IDs
                const testItemLookup = new Map<string, TestItem>()

                for (const testItem of tests) {
                    // Default to the testFile if a deeper hierarchy is not found
                    const parent = testItemLookup.get(testItem.parent) ?? item
                    const newTestItem = testController.createTestItem(
                        testItem.id,
                        testItem.label,
                        parent,
                        testItem.uri
                    )
                    newTestItem.range = new Range(testItem.startLine,0,testItem.endLine,0)
                    newTestItem.description = testItem.tags ? testItem.tags : undefined
                    newTestItem.debuggable = true
                    TestData.set(newTestItem, testItem)
                    testItemLookup.set(newTestItem.id, newTestItem)
                }
            })
        }
        // TODO: Watch for unsaved document changes and try invoke-pester on scriptblock
        item.busy = false
    }

    testController.runHandler = async (request, token) => {
        const run = testController.createTestRun(request)
        if (request.debug) {console.log("Debugging was requested")}
        // TODO: Maybe? Determine if a child of a summary block is excluded
        // TODO: Check if a child of a describe/context can be excluded, for now add warning that child hidden tests may still run
        // TODO: De-Duplicate children that can be consolidated into a higher line, this is probably not necessary.
        if (request.exclude?.length) {
            window.showWarningMessage("Pester: Hiding tests is currently not supported. The tests will still be run but their status will be suppressed")
        }

        for (const testItem of request.tests) {
            const testData = TestData.get(testItem)
            if (!testData) {throw new Error("testItem not found in testData. This is a bug.")}

            execChildren(testItem, item => item.busy = true)

            // Do a discovery on empty test files first. TODO: Probably a way to consolidate this with the runner so it doesn't run Pester twice
            if ((testData instanceof TestFile) && testItem.children.size === 0) {
                // TODO: Fix when API stabilizes
                await window.showWarningMessage('TEMPORARY: You must expand a test file at least once before you run it')
                run.end()
                return
            }
            run.setState(testItem,TestResultState.Queued)
        }

        const testsToRun: string[] = []
        request.tests.map(testItem => {
            const testData = TestData.get(testItem)
            if (!testData) {throw new Error("testItem not found in testData. This is a bug.")}
            const testLine = testData.startLine
                ? [testData.file, testData.startLine+1].join(':')
                : testData.file
            testsToRun.push(testLine)
        })

        // TODO: Use a queue instead to line these up like the test example
        request.tests.map(testItem => run.setState(testItem,TestResultState.Running))
        const testRootContext = TestControllerData.get(testController.root)!
        const pesterTestRunResult = await testRootContext.runPesterTests(testsToRun, false, request.debug)


        // Make this easier to query by putting the IDs in a map so we dont have to iterate an array constantly.
        // TODO: Make this part of getPesterTests?
        const pesterTestRunResultLookup = new Map<string,TestResult>()
        pesterTestRunResult.map(testResultItem =>
            pesterTestRunResultLookup.set(testResultItem.id, testResultItem)
        )

        const requestedTests = request.tests.flatMap(
            item => getAllChildren(item)
        )

        for (const testRequestItem of requestedTests) {
            try {
                // Skip Testfiles
                if (TestData.get(testRequestItem) instanceof TestFile) {
                    continue
                }
                let testResult = pesterTestRunResultLookup.get(testRequestItem.id)

                if (!testResult) {
                    throw 'No Test Results were found in the test request. This should not happen and is probably a bug.'
                }
                // TODO: Test for blank or invalid result
                if (!testResult.result) {
                    throw `No test result found for ${testResult.id}. This is probably a bug in the PesterInterface script`
                }

                run.setState(testRequestItem, testResult.result, testResult.duration)
                execChildren(testRequestItem, item => item.busy = false)

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
                    run.appendMessage(testRequestItem, message)
                }

            } catch (err) {
                console.log(err)
            }
            // TODO: Add error metadata
        }
        run.end()
        // testsToRun.filter(testItem =>
        //     !request.exclude?.includes(testItem)
        // )
    }

    // This will trigger resolveChildrenHandler on startup
    testRoot.canResolveChildren = true
    return testController
}

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
    }
}

/** Recursively retrieve all the children of this item along with itself */
function getAllChildren(parent: TestItem) {
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