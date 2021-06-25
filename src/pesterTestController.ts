import { Disposable, Extension, ExtensionContext, Location, Position, Range, RelativePattern, test, TestController, TestItem, TestMessage, TestResultState, Uri, window, workspace } from 'vscode'
import { TestDefinition, TestFile, TestResult, TestRootContext, TestTree } from './pesterTestTree'
import { IPowerShellExtensionClient } from './powershellExtensionClient'

// Create a Test Controller for Pester which can be used to interface with the Pester APIs
export async function CreatePesterTestController(
    powershellExtension: Extension<IPowerShellExtensionClient>,
    context: ExtensionContext,
    id: string = 'Pester'
) {
    // A pester test controller should only have testfiles at its root, whether physical files or in-progress documents
    // The generic type in this case represents the possible test item types that can be stored and would need to be updated
    // when a run starts
    const testController = test.createTestController<TestTree>('pesterTestController')
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
            item.data.discoverTests().then(tests => {
                // Use a lookup as a temporary hierarchy workaround until a recursive lookup can be made
                // TODO: A recursive child lookup is going to be needed now that things have switched to objects rather than IDs
                const testItemLookup = new Map<string, TestItem<TestDefinition>>()

                for (const testItem of tests) {
                    // Default to the testFile if a deeper hierarchy is not found
                    const parent = testItemLookup.get(testItem.parent) ?? item
                    const newTestItem = testController.createTestItem<TestDefinition>(
                        testItem.id,
                        testItem.label,
                        parent,
                        testItem.uri,
                        testItem
                    )
                    newTestItem.range = new Range(testItem.startLine,0,testItem.endLine,0)
                    newTestItem.description = testItem.tags ? testItem.tags : undefined
                    testItemLookup.set(newTestItem.id, newTestItem)
                }
            })
        }
        // TODO: Watch for unsaved document changes and try invoke-pester on scriptblock
        item.busy = false
    }

    testController.runHandler = async (request, token) => {
        const run = testController.createTestRun<TestTree>(request)

        // TODO: Maybe? Determine if a child of a summary block is excluded
        // TODO: Check if a child of a describe/context can be excluded, for now add warning that child hidden tests may still run
        // TODO: De-Duplicate children that can be consolidated into a higher line, this is probably not necessary.
        if (request.exclude?.length) {
            window.showWarningMessage("Pester: Hiding tests is currently not supported. The tests will still be run but their status will be suppressed")
        }

        for (const testItem of request.tests) {
            run.setState(testItem,TestResultState.Queued)
        }

        const testsToRun = request.tests.map(testItem => testItem.data.startLine
            ? [testItem.data.file, testItem.data.startLine+1].join(':')
            : testItem.data.file
        )

        // TODO: Use a queue instead to line these up like the test example
        for (const testItem of request.tests) {
            run.setState(testItem,TestResultState.Running)
        }
        const testRootContext = testController.root.data as TestRootContext
        const pesterTestRunResult = await testRootContext.runPesterTests(testsToRun, true)


        // Make this easier to query by putting the IDs in a map so we dont have to iterate an array constantly.
        // TODO: Make this part of getPesterTests?
        const pesterTestRunResultLookup = new Map<string,TestResult>()
        pesterTestRunResult.map(testResultItem =>
            pesterTestRunResultLookup.set(testResultItem.id, testResultItem)
        )

        const requestedTests = request.tests

        // Include all relevant children
        // TODO: Recurse for multiple levels
        for (const testRequestItem of request.tests) {
            requestedTests.push(...testRequestItem.children.values())
        }

        for (const testRequestItem of requestedTests) {
            try {
                // Skip Testfiles
                // HACK: Should be doing this by class rather than searching for delimiter
                if (testRequestItem.data instanceof TestFile) {
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