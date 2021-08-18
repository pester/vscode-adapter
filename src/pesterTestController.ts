import { join } from 'path'
import {
	Disposable,
	Extension,
	ExtensionContext,
	Location,
	MarkdownString,
	Position,
	Range,
	RelativePattern,
	TestController,
	TestItem,
	TestMessage,
	TestRunProfileKind,
	TestRunRequest,
	tests,
	Uri,
	window,
	workspace
} from 'vscode'
import { DotnetNamedPipeServer } from './dotnetNamedPipeServer'
import log from './log'
import {
	TestData,
	TestDefinition,
	TestFile,
	TestResult,
	TestResultState,
	TestTree
} from './pesterTestTree'
import {
	IPowerShellExtensionClient,
	PowerShellExtensionClient
} from './powershellExtensionClient'
import { findTestItem, getUniqueTestItems } from './testItemUtils'
import debounce = require('debounce-promise')
import { info } from 'console'

/** A wrapper for the vscode TestController API specific to PowerShell Pester Test Suite.
 * This should only be instantiated once in the extension activate method.
 */
export class PesterTestController implements Disposable {
	constructor(
		private readonly powershellExtension: Extension<IPowerShellExtensionClient>,
		private readonly context: ExtensionContext,
		public readonly id: string = 'Pester',
		public testController: TestController = tests.createTestController(id, id),
		private powerShellExtensionClient?: PowerShellExtensionClient,
		private returnServer: DotnetNamedPipeServer = new DotnetNamedPipeServer(
			id + 'TestController-' + process.pid
		)
	) {
		// wire up our custom handlers to the managed instance
		// HACK: https://github.com/microsoft/vscode/issues/107467#issuecomment-869261078
		testController.resolveHandler = testItem => this.resolveHandler(testItem)
		testController.createRunProfile(
			'Run',
			TestRunProfileKind.Run,
			this.testHandler.bind(this),
			true
		)
		testController.createRunProfile(
			'Debug',
			TestRunProfileKind.Debug,
			this.testHandler.bind(this),
			true
		)
	}

	private initialized = false
	/** Start up the test controller. This includes watching all workspaces for Pester files */
	async initialize() {
		try {
			await Promise.all([this.watchWorkspaces(), this.returnServer.listen()])
			this.initialized = true
		} catch (err: any) {
			if (err) {
				throw new Error(err)
			}
		}
	}

	/** Queues up testItems from resolveHandler requests because pester works faster scanning multiple files together **/
	private resolveQueue = new Array<TestItem>()

	/** The test controller API calls this whenever it needs to get the resolveChildrenHandler
	 * for Pester, this is only relevant to TestFiles as this is pester's lowest level of test resolution
	 */
	private async resolveHandler(testItem: TestItem | undefined) {
		if (!this.initialized) {
			// HACK: Avoid a race condition when resolveHandler is called multiple times. This can be done better
			this.initialized = true
			await this.initialize()
		}
		// For the controller root, children are resolved via the watchers
		if (!testItem) {
			return
		}

		const testItemData = TestData.get(testItem)
		if (!testItemData) {
			throw new Error('No matching testItem data found. This is a bug')
		}

		// Test Definitions should never show up here, they aren't resolvable in Pester as we only do it at file level
		if (testItemData instanceof TestDefinition) {
			log.warn(
				`Received a test definition ${testItemData.id} to resolve. Should not happen`
			)
		}

		// TODO: Wire this back up to the test adapter
		const testItemLookup = new Map<string, TestItem>()
		const testItemDiscoveryHandler = (t: unknown) => {
			// TODO: This should be done before onDidReceiveObject maybe as a handler callback?
			const testDef = t as TestDefinition

			// If there was a syntax error, set the error and short circuit the rest
			if (testDef.error !== undefined) {
				const existingTest = this.testController.items.get(testDef.id)
				if (existingTest) {
					existingTest.error = new MarkdownString(
						`$(error) ${testDef.error}`,
						true
					)
					return
				}
			}

			const parent =
				testItemLookup.get(testDef.parent) ??
				this.testController.items.get(testDef.id)
			if (parent === undefined && testDef.error === undefined) {
				log.fatal(
					`Test Item ${testDef.label} does not have a parent. This is a bug and should not happen`
				)
				throw new Error(
					`Test Item ${testDef.label} does not have a parent. This is a bug and should not happen`
				)
			}
			const newTestItem = this.testController.createTestItem(
				testDef.id,
				testDef.label,
				testItem.uri
			)
			newTestItem.range = new Range(testDef.startLine, 0, testDef.endLine, 0)
			newTestItem.description = testDef.tags ? testDef.tags : undefined
			if (testDef.error !== undefined) {
				newTestItem.error = testDef.error
			}

			TestData.set(newTestItem, testDef)
			testItemLookup.set(newTestItem.id, newTestItem)
			if (parent !== undefined) {
				parent.children.add(newTestItem)
			}
		}

		if (
			testItemData instanceof TestFile &&
			!testItemData.testsDiscovered &&
			!testItem.busy
		) {
			// Indicate the start of a discovery, will cause the UI to show a spinner
			testItem.busy = true

			// Run Pester and get tests
			log.info('Adding to Discovery Queue: ', testItem.id)
			this.resolveQueue.push(testItem)
			// For discovery we don't care about the terminal output, thats why no assignment to var here
			await this.startTestDiscovery(testItemDiscoveryHandler)
			testItem.busy = false
			testItemData.testsDiscovered = true
		} else {
			log.info(
				`Resolve for ${testItem.label} requested but it is already resolving/resolved`
			)
		}
	}

	private startTestDiscovery = debounce(async testItemDiscoveryHandler => {
		log.info(`Starting Test Discovery of ${this.resolveQueue.length} files`)
		const result = await this.startPesterInterface(
			this.resolveQueue,
			testItemDiscoveryHandler,
			true,
			false
		)
		this.resolveQueue.length = 0
		return result
	}, 100)

	/** The test controller API calls this when tests are requested to run in the UI. It handles both runs and debugging */
	private async testHandler(request: TestRunRequest) {
		if (!this.initialized) {
			await this.initialize()
		}

		const run = this.testController.createTestRun(request)
		if (request.profile === undefined) {
			throw new Error('No profile provided. This is (currently) a bug.')
		}
		const debug = request.profile.kind === TestRunProfileKind.Debug

		const testItems = this.getRunRequestTestItems(request)
		// Indicate that the tests are ready to run
		testItems.forEach(run.enqueued)

		const exclude = new Set<TestItem>(request.exclude)

		/** Takes the returned objects from Pester and resolves their status in the test controller **/
		const runResultHandler = (item: unknown) => {
			const testResult = item as TestResult
			// Skip Test Suites for now, focus on test results
			if (testResult.type === 'Block') {
				return
			}

			// BUG: Find out why this doesn't match. Maybe get isn't recursive?
			const testRequestItem = findTestItem(
				testResult.id,
				this.testController.items
			)

			if (testRequestItem === undefined) {
				throw new Error(
					`${testResult.id} was returned from Pester but was not tracked in the test controller. This is probably a bug in test discovery.`
				)
			}
			if (exclude.has(testRequestItem)) {
				log.warn(`${testResult.id} was run in Pester but excluded from results`)
				return
			}

			if (testResult.result === TestResultState.Passed) {
				run.passed(testRequestItem, testResult.duration)
			} else {
				// TODO: This is clumsy and should be a constructor/method on the TestData type perhaps
				const message =
					testResult.message && testResult.expected && testResult.actual
						? TestMessage.diff(
								testResult.message,
								testResult.expected,
								testResult.actual
						  )
						: new TestMessage(testResult.message)
				if (
					testResult.targetFile != undefined &&
					testResult.targetLine != undefined
				) {
					message.location = new Location(
						Uri.file(testResult.targetFile),
						new Position(testResult.targetLine, 0)
					)
				}
				if (message.message) {
					run.failed(testRequestItem, message, testResult.duration)
				}
			}
		}

		testItems.forEach(run.started)
		// TODO: Adjust testItems parameter to a Set
		const terminalOutput = await this.startPesterInterface(
			Array.from(testItems),
			runResultHandler.bind(this),
			false,
			debug
		)
		// FIXME: Terminal Output relied on a proposed API that won't be published, need a workaround
		// // Because we are capturing from a terminal, some intermediate line breaks can be introduced
		// // due to window resizing so we want to strip those out
		// const fullWidthTerminalOutput = terminalOutput.replace(/\r?\n/g, '')
		// run.appendOutput(fullWidthTerminalOutput)
		run.end()
	}

	/** Runs pester in the PSIC. Results will be sent via a named pipe and handled as events
	 * Returns a promise that completes with the terminal output during the pester run
	 * returnHandler will run on each object that comes back from the Pester Interface
	 */
	// TODO: Mutex or otherwise await so that this can only happen one at a time?
	private async startPesterInterface(
		testItems: TestItem[],
		returnHandler: (event: unknown) => void,
		discovery?: boolean,
		debug?: boolean
	) {
		if (!discovery) {
			// HACK: Using flatMap to filter out undefined in a type-safe way. Unintuitive but effective
			// https://stackoverflow.com/a/64480539/5511129
			// Change to map and filter when https://github.com/microsoft/TypeScript/issues/16069 is resolved
			const undiscoveredTestFiles: Promise<void>[] = testItems.flatMap(
				testItem => {
					const testDataItem = TestData.get(testItem)
					if (
						testDataItem instanceof TestFile &&
						!testDataItem.testsDiscovered
					) {
						log.info(
							`Run invoked on undiscovered testFile ${testItem.label}, discovery will be run first`
						)
						return [this.resolveHandler(testItem)]
					} else {
						return []
					}
				}
			)
			// The resolve handler is debounced, this will wait until the delayed resolve handler completes
			await Promise.all(undiscoveredTestFiles)
		}

		// Derive Pester-friendly test line identifiers from the testItem info
		const testsToRun = testItems.map(testItem => {
			if (!testItem.uri) {
				throw new Error(
					'TestItem did not have a URI. For pester, this is a bug'
				)
			}
			const fsPath = testItem.uri.fsPath
			const testLine = testItem.range?.start.line
				? [fsPath, testItem.range.start.line + 1].join(':')
				: fsPath
			return testLine
		})

		const scriptFolderPath = join(
			this.context.extension.extensionPath,
			'Scripts'
		)
		const scriptPath = join(scriptFolderPath, 'PesterInterface.ps1')
		const scriptArgs = new Array<string>()

		if (discovery) {
			scriptArgs.push('-Discovery')
		}

		scriptArgs.push('-PipeName')
		scriptArgs.push(this.returnServer.name)
		// Quotes are required when passing to integrated terminal if the test path has spaces
		scriptArgs.push(
			...testsToRun.map(testFilePath => {
				return `'${testFilePath}'`
			})
		)

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

		if (discovery) {
			verbosity = 'None'
		}
		if (verbosity && verbosity != 'FromPreference') {
			scriptArgs.push('-Verbosity')
			scriptArgs.push(verbosity)
		}

		const runObjectListenEvent =
			this.returnServer.onDidReceiveObject(returnHandler)

		// HACK: Calling this function indirectly starts/waits for PSIC to be available
		await this.powerShellExtensionClient.GetVersionDetails()

		// No idea if this will work or not
		const terminalData = new Promise<string>(resolve =>
			this.powerShellExtensionClient!.RunCommand(
				scriptPath,
				scriptArgs,
				debug,
				terminalData => {
					runObjectListenEvent.dispose()
					return resolve(terminalData)
				}
			)
		)
		return terminalData
	}

	/**
	 * Starts up filewatchers for each workspace to scan for pester files and add them to the test controller root.
	 *
	 * @param {TestController} testController - The test controller to initiate watching on
	 * @param {Disposable[]} [disposable=[]] - An array to store disposables from the watchers, usually {@link ExtensionContext.subscriptions} to auto-dispose the watchers on unload or cancel
	 */
	async watchWorkspaces() {
		const testController = this.testController
		const disposable = this.context.subscriptions
		if (!workspace.workspaceFolders) {
			// TODO: Register event to look for when a workspace folder is added
			log.warn('No workspace folders detected.')
			return
		}
		for (const workspaceFolder of workspace.workspaceFolders) {
			const pattern = new RelativePattern(
				workspaceFolder,
				'**/*.[tT]ests.[pP][sS]1'
			)

			const testWatcher = workspace.createFileSystemWatcher(pattern)
			const tests = this.testController.items
			testWatcher.onDidCreate(uri =>
				tests.add(TestFile.getOrCreate(testController, uri))
			)
			testWatcher.onDidDelete(uri => tests.delete(uri.toString()))
			testWatcher.onDidChange(uri =>
				this.testController.resolveHandler!(
					TestFile.getOrCreate(testController, uri)
				)
			)

			// TODO: Make this a setting
			const isPesterTestFile = /\.[tT]ests\.[pP][sS]1$/

			workspace.onDidOpenTextDocument(e => {
				if (!isPesterTestFile.test(e.fileName)) {
					return
				}
				this.testController.resolveHandler!(
					TestFile.getOrCreate(testController, e.uri)
				)
			})

			const files = await workspace.findFiles(pattern)
			for (const file of files) {
				log.info('Detected Pester File: ', file.fsPath)
				TestFile.getOrCreate(testController, file)
			}
		}
	}

	/** Find a TestItem by its ID in the TestItem tree hierarchy of this controller */
	// TODO: Maybe build a lookup cache that is populated as items are added
	getTestItemById(id: string) {
		this.testController.items.get(id)
	}

	/** Retrieves all test items to run, minus the exclusions */
	getRunRequestTestItems(request: TestRunRequest) {
		// Pester doesn't understand a "root" test so get all files registered to the controller instead
		// TODO: Move some of this logic to the TestItemUtils
		const tcItems = new Set<TestItem>()
		this.testController.items.forEach(item => tcItems.add(item))

		// TODO: Figure out a way to this without having to build tcItems ahead of time
		const testItems =
			request.include === undefined
				? tcItems
				: new Set<TestItem>(request.include)

		if (request.exclude?.length) {
			window.showWarningMessage(
				'Pester: Hiding tests is currently not supported. The tests will still be run but their status will be suppressed'
			)
		}

		const exclude = new Set<TestItem>(request.exclude)

		/** Resursively walk the function and add to testitems **/
		const addChildren = (item: TestItem) => {
			item.children.forEach(child => {
				if (!exclude.has(child)) {
					testItems.add(child)
				}
				addChildren(child)
			})
		}
		testItems.forEach(addChildren)
		return testItems
	}

	dispose() {
		this.testController.dispose()
		this.returnServer.dispose()
	}
}
