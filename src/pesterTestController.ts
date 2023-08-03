import { join, isAbsolute, dirname } from 'path'
import {
	Disposable,
	Extension,
	ExtensionContext,
	Location,
	MarkdownString,
	Position,
	TestController,
	TestItem,
	TestMessage,
	TestRun,
	TestRunProfile,
	TestRunProfileKind,
	TestRunRequest,
	tests,
	TestTag,
	Uri,
	window,
	workspace,
	languages,
	FileSystemWatcher,
	CancellationToken,
	WorkspaceFolder,
	TextDocument,
	RelativePattern,
	DocumentSelector,
	WorkspaceConfiguration,
} from 'vscode'
import { DotnetNamedPipeServer } from './dotnetNamedPipeServer'
import { default as parentLog } from './log'
import {
	TestData,
	TestDefinition,
	TestFile,
	TestResult,
	getRange,
} from './pesterTestTree'
import { PowerShell, PowerShellError, PSOutput } from './powershell'
import {
	IPowerShellExtensionClient,
	PowerShellExtensionClient
} from './powershellExtensionClient'
import { clear, findTestItem, forAll, getTestItems, getUniqueTestItems, isTestItemOptions } from './util/testItemUtils'
import debounce = require('debounce-promise')
import { isDeepStrictEqual } from 'util'
import { getPesterExtensionContext } from './extension'
import { watchWorkspaceFolder } from './workspaceWatcher'

const defaultControllerLabel = 'Pester'

/** Used to store the first controller in the system so it can be renamed if multiple controllers are instantiated */
let firstTestController: [string, TestController]
let firstTestControllerRenamed = false

/** Used to provide a lazily initialized singleton PowerShell extension client */
let powerShellExtensionClient: PowerShellExtensionClient | undefined
async function getPowerShellExtensionClient() {
	return powerShellExtensionClient ??= await PowerShellExtensionClient.create(
		getPesterExtensionContext().extensionContext,
		getPesterExtensionContext().powerShellExtension
	)
}

/** A wrapper for the vscode TestController API specific to PowerShell Pester Test Suite.
 */
export class PesterTestController implements Disposable {
	private ps: PowerShell | undefined
	/** Queues up testItems from resolveHandler requests because pester works faster scanning multiple files together **/
	private discoveryQueue = new Set<TestItem>()
	private readonly testRunStatus = new Map<TestRun, boolean>()
	private testFileWatchers = new Map<RelativePattern, FileSystemWatcher>()
	private get testFilePatterns(): ReadonlyArray<RelativePattern> { return Array.from(this.testFileWatchers.keys()) }
	private readonly continuousRunTests = new Set<TestItem>()
	private readonly disposables = new Array<Disposable>()
	private runProfile?: TestRunProfile
	private debugProfile?: TestRunProfile
	private readonly powershellExtension: Extension<IPowerShellExtensionClient>
	get powerShellExtensionClientPromise() { return getPowerShellExtensionClient() }
	private readonly context: ExtensionContext

	// pipe for PSIC communication should be lazy initialized
	private _returnServer?: DotnetNamedPipeServer
	private get returnServer(): DotnetNamedPipeServer {
		return this._returnServer ??= new DotnetNamedPipeServer(
			'VSCodePester' + process.pid + '' + this.workspaceFolder.index
		)
	}

	private _config?: WorkspaceConfiguration
	private get config(): WorkspaceConfiguration {
		return this._config ??= workspace.getConfiguration('pester', this.workspaceFolder.uri)
	}

	// We want our "inner" vscode testController to be lazily initialized on first request so it doesn't show in the UI unless there are relevant test files
	private _testController: TestController | undefined
	public get testController(): TestController { return this._testController ??= this.createTestController() }

	constructor(
		public readonly workspaceFolder: WorkspaceFolder,
		public readonly label: string = `${defaultControllerLabel}: ${workspaceFolder.name}`,
		public readonly log = parentLog.getSubLogger({
			name: workspaceFolder.name
		})
	) {
		const pesterExtensionContext = getPesterExtensionContext()
		this.context = pesterExtensionContext.extensionContext
		this.powershellExtension = pesterExtensionContext.powerShellExtension

		/** Remove the controller if the matching workspace is removed in vscode */
		const onWorkspaceFolderRemoved = workspace.onDidChangeWorkspaceFolders(
			// This should only match once
			e => e.removed.filter(
				f => f === workspaceFolder
			).forEach(() => {
				onWorkspaceFolderRemoved.dispose()
				this.dispose()
			}, this)
		)
	}

	/** Creates a managed vscode instance of our test controller and wires up the appropraite handlers */
	private createTestController() {
		const testController = tests.createTestController(
			`${this.context.extension.id}-${this.workspaceFolder.uri.toString()}`,
			this.label
		)
		testController.refreshHandler = this.refreshHandler.bind(this)
		testController.resolveHandler = this.resolveHandler.bind(this)
		this.runProfile = testController.createRunProfile(
			'Dedicated Pester PowerShell Instance',
			TestRunProfileKind.Run,
			this.testHandler.bind(this),
			true,
			undefined,
			true
		)
		this.debugProfile = testController.createRunProfile(
			'Dedicated Pester PowerShell Instance',
			TestRunProfileKind.Debug,
			this.testHandler.bind(this),
			true
		)
		this.registerDisposable(testController)

		/** The first controller should simply be named 'Pester' and not include the workspace name in a single root
		 * workspace. By default this is hidden if no other non-Pester test controllers but keeps it simple if there are
		 * other controllers. In a multi-root workspace, we want to include the workspace name in the label to differentiate
		 * between controllers.
		*/
		if (firstTestController === undefined) {
			firstTestController = [this.label, testController]
			testController.label = defaultControllerLabel
		} else {
			if (firstTestControllerRenamed === false) {
				firstTestController[1].label = firstTestController[0]
				firstTestControllerRenamed = true
			}
		}
		return testController
	}

	/** Initializes file system watchers for the workspace and checks for Pester files in open windows */
	async watch(cancelToken?: CancellationToken) {
		const watchers = await watchWorkspaceFolder(this.workspaceFolder)
		this.testFileWatchers = watchers

		this.log.info(`Watching for Pester file changes in ${this.workspaceFolder.uri.fsPath}`)
		this.registerDisposable(...Array.from(watchers.values()).flatMap(
			watcher => {
				return [
					watcher.onDidChange(this.onFileChanged, this),
					watcher.onDidCreate(this.onFileAdded, this),
					watcher.onDidDelete(this.onFileDeleted, this)
				]
			}
		))

		// Watch for new open documents and initiate a test refresh
		this.registerDisposable(
			workspace.onDidOpenTextDocument(this.refreshIfPesterTestDocument)
		)

		// Do a test discovery if a pester document is already open
		if (window.activeTextEditor?.document !== undefined) {
			this.refreshIfPesterTestDocument(window.activeTextEditor.document)
		}

		await this.findPesterFiles(cancelToken)
	}

	private async findPesterFiles(cancelToken?: CancellationToken) {
		this.log.info('Scanning workspace for Pester files:', this.workspaceFolder.uri.fsPath)
		const detectedPesterFiles = (await Promise.all(this.testFilePatterns.map(
			pattern => {
				this.log.debug('Scanning for files matching pattern:', pattern.baseUri, pattern.pattern)
				return workspace.findFiles(pattern, undefined, undefined, cancelToken)
			}
		))).flat()

		if (cancelToken?.isCancellationRequested) { return }

		detectedPesterFiles.forEach(uri => this.onFileAdded(uri))
	}

	refreshIfPesterTestDocument(
		doc: TextDocument,
		documentSelector: DocumentSelector = this.testFilePatterns
	) {
		if (
			// TODO: Support virtual pester test files by running them as a scriptblock
			doc.uri.scheme === 'file' &&
			languages.match(documentSelector, doc)
		) {
			this.refreshTests(doc.uri)
		}
	}

	onFileAdded(file: Uri) {
		this.log.info('Detected New Pester File: ', file.fsPath)
		TestFile.getOrCreate(this.testController, file)
	}
	onFileChanged(file: Uri) {
		this.log.info('Detected Pester File Change: ', file.fsPath)
		this.refreshTests(file)
	}
	onFileDeleted(file: Uri) {
		this.log.info('Detected Pester File Deletion: ', file.fsPath)
		const deletedTestItem = Array.from(getUniqueTestItems(this.testController.items)).find(item => item.uri === file)
		if (deletedTestItem) {
			this.testController.items.delete(deletedTestItem.id)
		} else {
			this.log.error('A file that matches the pester test item was deleted but could not find a match in the controller items. This is probably a bug: ', file.fsPath)
		}
	}

	/** The test controller API calls this whenever it needs to get the resolveChildrenHandler
	 * for Pester, this is only relevant to TestFiles as this is pester's lowest level of test resolution
	 * @param testItem - The test item to get the resolveChildrenHandler for
	 * @param force - If true, force the test to be re-resolved
	 */
	private async resolveHandler(
		testItem: TestItem | undefined,
		token?: CancellationToken,
		force?: boolean
	): Promise<void> {
		this.handleRunCancelled(token, 'resolveHandler')

		this.log.debug(`VSCode requested resolve for: ${testItem?.id}`)

		// If testitem is undefined, this is a signal to initialize the controller but not actually do anything, so we exit here.
		if (testItem === undefined) {
			this.log.debug('Received undefined testItem from VSCode, this is a signal to initialize the controller')
			return
		}

		// Reset any errors previously reported.
		testItem.error = undefined

		const testItemData = TestData.get(testItem)
		if (!testItemData) {
			throw new Error('No matching testItem data found. This is a bug')
		}

		// Test Definitions should never show up here, they aren't resolvable in Pester as we only do it at file level
		if (isTestItemOptions(testItemData)) {
			this.log.error(
				`Received a test definition ${testItemData.id} to resolve. Should not happen`
			)
		}

		if (
			(testItemData instanceof TestFile &&
				!testItemData.testsDiscovered &&
				!testItem.busy) ||
			(testItemData instanceof TestFile && force)
		) {
			// Indicate the start of a discovery, will cause the UI to show a spinner
			testItem.busy = true

			// We will use this to compare against the new test view so we can delete any tests that no longer exist
			const existingTests = new Set<TestItem>()
			await forAll(testItem, item => {
				existingTests.add(item)
			}, true)

			// Run Pester and get tests
			this.log.debug('Adding to Discovery Queue: ', testItem.id)
			this.discoveryQueue.add(testItem)
			// For discovery we don't care about the terminal output, thats why no assignment to var here

			// TODO: We shouldn't be injecting the newTests set like this but rather have a more functional approach
			const newAndChangedTests = new Set<TestItem>()
			await this.startTestDiscovery(this.testItemDiscoveryHandler.bind(this, newAndChangedTests))

			testItem.busy = false

			// If tests were changed that were marked for continuous run, we want to start a run for them
			const outdatedTests = new Set<TestItem>()


			//Get all children of the standing continuous run tests so that we make sure to run them if they are changed.
			const allContinuousRunTests = new Set<TestItem>(this.continuousRunTests)
			this.continuousRunTests.forEach(test =>
				getUniqueTestItems(test.children).forEach(
					child => allContinuousRunTests.add(child)
				)
			)

			newAndChangedTests.forEach(test => {
				if (allContinuousRunTests.has(test)) {
					outdatedTests.add(test)
				}
			})

			if (outdatedTests.size > 0) {
				this.log.info(
					`Continuous run tests changed. Starting a run for ${outdatedTests.size} outdated tests`
				)

				const outdatedTestRunRequest = new TestRunRequest(
					Array.from(outdatedTests),
					undefined,
					this.runProfile //TODO: Implement option to use debug profile instead
				)

				this.testHandler(outdatedTestRunRequest)
			}


		} else {
			this.log.warn(
				`Resolve requested for ${testItem.label} requested but it is already resolving/resolved. Skipping...`
			)
		}
	}

	/** Called when the refresh button is pressed in vscode. Should clear the handler and restart */
	private refreshHandler() {
		this.log.info("VSCode requested a refresh. Re-initializing the Pester Tests extension")
		this.stopPowerShell()
		clear(this.testController.items)
		this.testFileWatchers.forEach(watcher => {
			watcher.dispose()
			this.disposables.splice(this.disposables.indexOf(watcher), 1)
		})

		this.testFileWatchers = new Map<RelativePattern, FileSystemWatcher>()
		this.watch()
	}

	/**
	 * Raw test discovery result objects returned from Pester are processed by this function
	 */
	private testItemDiscoveryHandler(newTestItems: Set<TestItem>, t: TestDefinition) {
		// TODO: This should be done before onDidReceiveObject maybe as a handler callback?
		const testDef = t
		const testItems = this.testController.items
		this.log.trace("Received discovery item from PesterInterface: ", t)
		// If there was a syntax error, set the error and short circuit the rest
		if (testDef.error) {
			const existingTest = this.testController.items.get(testDef.id)
			if (existingTest) {
				existingTest.error = new MarkdownString(
					`$(error) ${testDef.error}`,
					true
				)
				return
			}
		}

		const duplicateTestItem = Array.from(newTestItems).find(item => item.id == testDef.id)
		if (duplicateTestItem !== undefined) {
			const duplicateTestItemMessage = `Duplicate test item ${testDef.id} detected. Two Describe/Context/It objects with duplicate names are not supported by the Pester Test Extension. Please rename one of them, use TestCases/ForEach, or move it to a separate Pester test file. The duplicate will be ignored. This includes ForEach and TestCases, you must use a variable (e.g. <name>) in your test title.`
			this.log.error(duplicateTestItemMessage)
			window.showErrorMessage(duplicateTestItemMessage, 'OK')
			return
		}

		const parent = findTestItem(testDef.parent, testItems)
		if (parent === undefined) {
			this.log.fatal(
				`Test Item ${testDef.label} does not have a parent or its parent was not sent by PesterInterface first. This is a bug and should not happen`
			)
			throw new Error(
				`Test Item ${testDef.label} does not have a parent or its parent was not sent by PesterInterface first. This is a bug and should not happen`
			)
		}

		const testItem = findTestItem(testDef.id, testItems)

		if (testItem !== undefined) {
			const newTestItemData = testDef
			const existingTestItemData = TestData.get(testItem) as TestDefinition

			if (existingTestItemData === undefined) {
				this.log.fatal(
					`Test Item ${testDef.label} exists but does not have test data. This is a bug and should not happen`
				)
				throw new Error(
					`Test Item ${testDef.label} exists but does not have test data. This is a bug and should not happen`
				)
			}

			if (isDeepStrictEqual(existingTestItemData, newTestItemData)) {
				this.log.trace(`Discovery: Test Exists but has not changed. Skipping: ${testDef.id}`)
				return
			}

			this.log.info(`Discovery: Test Moved Or Changed - ${testDef.id}`)

			// Update the testItem data with the updated data
			TestData.set(testItem, testDef)

			// TODO: Deduplicate the below logic with the new item creation logic into a applyTestItemMetadata function or something

			// If the range has changed, update it so the icons are in the correct location
			const foundTestRange = getRange(testDef)
			if (!(testItem.range?.isEqual(foundTestRange))) {
				this.log.debug(`${testDef.id} moved, updating range`)
				testItem.range = foundTestRange
			}

			// Update tags if changed
			if (testDef.tags !== undefined) {
				const newTestTags = testDef.tags?.map(tag => {
					return new TestTag(tag)
				})
				if (!isDeepStrictEqual(newTestTags, testItem.tags)) {
					this.log.debug(`New tags detected, updating: ${testDef.id}`)
					testItem.tags = newTestTags
					testItem.description = testDef.tags.join(', ')
				}

			}

			newTestItems.add(testItem)
		} else {
			this.log.trace(`Creating Test Item in controller: ${testDef.id} uri: ${parent.uri}`)

			const newTestItem = this.testController.createTestItem(
				testDef.id,
				testDef.label,
				parent.uri
			)
			newTestItem.range = getRange(testDef)

			if (testDef.tags !== undefined) {
				newTestItem.tags = testDef.tags.map(tag => {
					this.log.debug(`Adding tag ${tag} to ${newTestItem.label}`)
					return new TestTag(tag)
				})
				newTestItem.description = testDef.tags.join(', ')
			}

			if (testDef.error !== undefined) {
				newTestItem.error = testDef.error
			}

			TestData.set(newTestItem, testDef)
			this.log.debug(`Adding ${newTestItem.label} to ${parent.label}`)
			parent.children.add(newTestItem)
			newTestItems.add(newTestItem)
		}
	}

	/** Used to debounce multiple requests for test discovery at the same time to not overload the pester adapter */
	private startTestDiscovery = debounce(async testItemDiscoveryHandler => {
		this.log.info(`Test Discovery Start: ${this.discoveryQueue.size} files`)
		let result: void
		try {
			result = await this.startPesterInterface(
				Array.from(this.discoveryQueue),
				// TODO: Type this
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				testItemDiscoveryHandler as any,
				true,
				false
			)
		} catch (err) {
			if (err instanceof PowerShellError) {
				const errMessage = 'Test Discovery failed: ' + err.message
				window.showErrorMessage(errMessage, 'OK')
				this.log.fatal(errMessage)
			}
		}
		this.discoveryQueue.clear()
		return result
	}, workspace.getConfiguration('pester', this.workspaceFolder).get<number>('testChangeTimeout') ?? 100)

	/** The test controller API calls this when tests are requested to run in the UI. It handles both runs and debugging.
	 * @param cancelToken The cancellation token passed by VSCode
	*/
	private async testHandler(request: TestRunRequest, cancelToken?: CancellationToken) {

		if (request.continuous) {
			// Add each item in the request include to the continuous run list
			this.log.info(`Continuous run enabled for ${request.include?.map(i => i.id)}`)
			request.include?.forEach(testItem => {
				this.continuousRunTests.add(testItem)
			})

			/** This cancel will be called when the autorun button is disabled */
			const disableContinuousRunToken = cancelToken

			disableContinuousRunToken?.onCancellationRequested(() => {
				this.log.info(`Continuous run was disabled for ${request.include?.map(i => i.id)}`)
				request.include?.forEach(testItem => {
					this.continuousRunTests.delete(testItem)
				})
			})

			// Stop here, we don't actually run tests until discovered or refreshed, at which point continuous flag will not be present.
			return
		}

		// FIXME: This is just a placeholder to notify that a cancel was requested but it should actually do something.
		cancelToken?.onCancellationRequested(() => {
			this.log.warn(`RunRequest cancel initiated for ${request.include?.map(i => i.id)}`)
		})

		if (request.profile === undefined) {
			throw new Error('No profile provided. This is (currently) a bug.')
		}


		this.log.trace(`VSCode requested ${request.profile.label} [${TestRunProfileKind[request.profile.kind]}] for: `, request.include?.map(i => i.id))

		const isDebug = request.profile.kind === TestRunProfileKind.Debug
		// If nothing was included, assume it means "run all tests"
		const include = request.include ?? getTestItems(this.testController.items)

		const run = this.testController.createTestRun(request)

		// Will stop the run and reset the powershell process if the user cancels it
		this.handleRunCancelled(run.token, 'TestRun', run)

		// TODO: Make this cleaner and replace getRunRequestTestItems
		// If there are no excludes we don't need to do any fancy exclusion test filtering
		const testItems =
			request.exclude === undefined || request.exclude.length === 0
				? include
				: Array.from(this.getRunRequestTestItems(request))

		// Indicate that the tests are ready to run
		// Only mark actual tests as enqueued for better UI: https://github.com/microsoft/vscode-discussions/discussions/672
		for (const testItem of testItems) {
			forAll(testItem, item => {
				const testItemData = TestData.get(item)
				if (!testItemData) {
					this.log.error(`Test Item Data not found for ${testItem.id}, this should not happen`)
					return
				}
				if (isTestItemOptions(testItemData)) {
					if (testItemData.type === 'Test') {
						run.enqueued(item)
					}
				}
			}, true)
		}

		/** Takes the returned objects from Pester and resolves their status in the test controller **/
		const runResultHandler = (item: unknown) => {
			this.log.trace("Received run result from PesterInterface: ", item);
			const testResult = item as TestResult
			// Skip non-errored Test Suites for now, focus on test results
			if (testResult.type === 'Block' && !testResult.error) {
				return
			}

			const testRequestItem = findTestItem(
				testResult.id,
				this.testController.items
			)

			if (testRequestItem === undefined) {
				this.log.error(
					`${testResult.id} was returned from Pester but was not tracked in the test controller. This is probably a bug in test discovery.`
				)
				return
			}
			if (testResult.type === 'Block' && testResult.error !== undefined) {
				run.errored(
					testRequestItem,
					new TestMessage(testResult.error),
					testResult.duration
				)
				forAll(testRequestItem, run.skipped, true)
				return
			}
			const exclude = new Set<TestItem>(request.exclude)
			if (exclude.has(testRequestItem)) {
				this.log.warn(`${testResult.id} was run in Pester but excluded from results`)
				return
			}
			if (testResult.result === "Running") {
				run.started(testRequestItem)
				return
			}

			if (testResult.result === "Passed") {
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

				if (
					testResult.result === "Skipped" &&
					testResult.message === 'is skipped'
				) {
					return run.skipped(testRequestItem)
				} else if (
					testResult.result === "Skipped" &&
					testResult.message &&
					this.config.get<boolean>('hideSkippedBecauseMessages')
				) {
					// We use "errored" because there is no "skipped" message support in the vscode UI
					return run.errored(testRequestItem, message, testResult.duration)
				} else if (testResult.result === "Skipped") {
					return run.skipped(testRequestItem)
				}

				if (message.message) {
					return run.failed(testRequestItem, message, testResult.duration)
				}
			}
		}

		// testItems.forEach(run.started)
		// TODO: Adjust testItems parameter to a Set
		this.log.info(`Test ${isDebug ? 'Debug' : 'Run'} Start: ${testItems.length} test items`)
		await this.startPesterInterface(
			Array.from(testItems),
			runResultHandler.bind(this),
			false,
			isDebug,
			undefined,
			run
		)
	}

	/** Runs pester either using the nodejs powershell adapterin the PSIC. Results will be sent via a named pipe and handled as events. If a testRun is supplied, it will update the run information and end it when completed.
	 * Returns a promise that completes with the terminal output during the pester run
	 * returnHandler will run on each object that comes back from the Pester Interface
	 */
	// TODO: Mutex or otherwise await so that this can only happen one at a time?
	private async startPesterInterface(
		testItems: TestItem[],
		returnHandler: (event: unknown) => void,
		discovery?: boolean,
		debug?: boolean,
		usePSExtension?: boolean,
		testRun?: TestRun
	): Promise<void> {
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
						this.log.debug(
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

		// Debug should always use PSIC for now, so if it is not explicity set, use it
		usePSExtension ??= debug

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

		// Quotes are required when passing to integrated terminal if the test path has spaces
		scriptArgs.push(
			...testsToRun.map(testFilePath => {
				return `'${testFilePath}'`
			})
		)

		const pesterSettings = this.config
		let verbosity = debug
			? pesterSettings.get<string>('debugOutputVerbosity')
			: pesterSettings.get<string>('outputVerbosity')

		if (verbosity === 'FromPreference') {
			verbosity = undefined
		}
		if (verbosity) {
			scriptArgs.push('-Verbosity')
			scriptArgs.push(verbosity)
		}

		const pesterCustomModulePath = this.getPesterCustomModulePath()
		if (pesterCustomModulePath !== undefined) {
			scriptArgs.push('-CustomModulePath')
			scriptArgs.push(pesterCustomModulePath)
		}

		const configurationPath = this.config.get<string>('configurationPath')
		if (configurationPath !== undefined && configurationPath !== '') {
			scriptArgs.push('-ConfigurationPath')
			scriptArgs.push(configurationPath)
		}

		// Initialize the PSIC if we are using it
		if (usePSExtension) {
			// HACK: Calling this function indirectly starts/waits for PS Extension to be available
			await (await this.powerShellExtensionClientPromise).GetVersionDetails()
		}

		// If PSIC is running, we will connect the PowershellExtensionClient to be able to fetch info about it
		const psExtensionTerminalLoaded = window.terminals.find(
			t => t.name === 'PowerShell Extension'
		)
		if (!psExtensionTerminalLoaded) {
			this.log.fatal('PowerShell Extension Terminal should be started but was not found in VSCode. This is a bug')
		}

		const exePath = psExtensionTerminalLoaded
			? (await (await this.powerShellExtensionClientPromise).GetVersionDetails()).exePath
			: undefined

		const cwd = this.getPesterWorkingDirectory()

		// Restart PS to use the requested version if it is different from the current one
		if (
			this.ps === undefined ||
			this.ps.exePath !== exePath ||
			this.ps.cwd !== cwd
		) {
			if (this.ps !== undefined) {
				this.log.warn(
					`Detected PowerShell Session change from ${this.ps.exePath} to ${exePath}. Restarting Pester Runner.`
				)
				this.ps.reset()
			}
			const exePathDir = exePath
				? dirname(exePath)
				: '*DEFAULT POWERSHELL PATH*'
			this.log.debug(
				`Starting PowerShell Pester testing instance ${exePath} with working directory ${
					cwd ? cwd : exePathDir
				}`
			)
			this.ps = new PowerShell(exePath, cwd)
		}

		// Objects from the run will return to the success stream, which we then send to the return handler
		const psOutput = new PSOutput()
		psOutput.verbose.on('data', (message: string) => {
			this.log.info(`PesterInterface Verbose: ${message}`)
		})
		psOutput.debug.on('data', (message: string) => {
			this.log.debug(`PesterInterface Debug: ${message}`)
		})
		psOutput.warning.on('data', (message: string) => {
			this.log.warn(`PesterInterface Warning: ${message}`)
		})

		psOutput.success.on('data', returnHandler)
		psOutput.success.once('close', ((testRun: TestRun | undefined) => {
			if (testRun) {
				this.log.info(`Test Run End: PesterInterface stream closed`)
				this.testRunStatus.set(testRun, true)
				testRun.end()
			} else {
				this.log.info(`Discovery Run End (PesterInterface stream closed)`)
			}

			this.log.trace(`Removing returnHandler from PSOutput`)
			psOutput.success.removeListener('data', returnHandler)
		}).bind(this, testRun))
		psOutput.error.on('data', err => {
			window.showErrorMessage(`An error occured running Pester: ${err}`, 'OK')
			this.log.error(`PesterInterface Error: ${err}`)
			if (testRun) {
				this.testRunStatus.set(testRun, false)
				testRun.end()
			}
		})

		if (usePSExtension) {
			this.log.debug('Running Script in PSIC:', scriptPath, scriptArgs)
			const psListenerPromise = this.returnServer.waitForConnection()

			/** Handles situation where the debug adapter is stopped (usually due to user cancel) before the script completes. */
			const endSocketAtDebugTerminate = (testRun: TestRun | undefined) => {
				psListenerPromise.then(socket => socket.end())
				if (testRun && this.testRunStatus.get(testRun) === false) {
					this.log.warn("Test run ended due to abrupt debug session end such as the user cancelling the debug session.")
					testRun.end()
				}
			}

			scriptArgs.push('-PipeName')
			scriptArgs.push(this.returnServer.name)
			// TODO: Fix non-null assertion
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			const powershellExtensionClient = await this.powerShellExtensionClientPromise
			await powershellExtensionClient.RunCommand(
				scriptPath,
				scriptArgs,
				endSocketAtDebugTerminate.bind(this, testRun),
				this.workspaceFolder.uri.fsPath
			)
			await this.ps.listen(psOutput, await psListenerPromise)
		} else {
			const script = `& '${scriptPath}' ${scriptArgs.join(' ')}`
			this.log.debug('Running Script in PS Worker:', script)
			if (testRun) {
				psOutput.information.on('data', (data: string) => {
					testRun.appendOutput(data.trimEnd() + '\r\n')
				})
			}
			const useNewProcess = this.config.get<boolean>('runTestsInNewProcess')
			await this.ps.run(script, psOutput, undefined, true, useNewProcess)
		}
	}
	// Fetches the current working directory that Pester should use.
	getPesterWorkingDirectory() {
		const customCwd = this.config.get<string>('workingDirectory')
		return customCwd ?? this.workspaceFolder.uri.fsPath
	}

	/** Fetches the current pester module path if a custom path was defined, otherwise returns undefined */
	getPesterCustomModulePath() {
		const path = this.config.get<string>('pesterModulePath')

		// Matches both an empty string and undefined
		if (!path) {
			return undefined
		}

		this.log.info(`Using Custom Pester Module Path specified in settings: ${path}`)

		if (isAbsolute(path)) {
			return path
		}
		// If we make it this far, it's a relative path and we need to resolve that.
		if (workspace.workspaceFolders === undefined) {
			throw new Error(
				`A relative Pester custom module path "${path}" was defined, but no workspace folders were found in the current session. You probably set this as a user setting and meant to set it as a workspace setting`
			)
		}
		// TODO: Multi-workspace detection and support
		const resolvedPath = join(workspace.workspaceFolders[0].uri.fsPath, path)
		this.log.debug(`Resolved Pester CustomModulePath ${path} to ${resolvedPath}`)
		return resolvedPath
	}

	/** Triggered whenever new tests are discovered as the result of a document change */
	private refreshTests(changedFile: Uri) {
		const testFile = TestFile.getOrCreate(this.testController, changedFile)
		this.resolveHandler(testFile)
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

	/** stops the PowerShell Pester instance, it is expected another function will reinitialize it if needed. This function returns false if there was no instance to stop, and returns true otherwise */
	stopPowerShell(cancel?: boolean): boolean {
		if (this.ps !== undefined) {
			return cancel ? this.ps.cancel() : this.ps.reset()
		}
		return false
	}

	dispose() {
		this.log.info(`Disposing Pester Test Controller ${this.label}`)
		this.testController.dispose()
		this.returnServer.dispose()
		this.disposables.forEach(d => d.dispose())
	}

	/** Binds a disposable to this test controller so that it is disposed when the controller is disposed */
	private registerDisposable(...disposable: Disposable[]) {
		this.disposables.push(...disposable)
	}

	/** Registers to handle cancellation events. This mostly exists to hide the bind function and make the code easier to read */
	private handleRunCancelled(token?: CancellationToken, source?: string, testRun?: TestRun) {
		token?.onCancellationRequested(
			this.cancelRun.bind(this, source ?? 'Unspecified', testRun)
		)
	}

	//** This function will gracefully cancel the current pester process  */
	private cancelRun(source: string, testRun?: TestRun | undefined) {
		this.log.warn(`${source} Cancellation Detected`)
		this.log.warn(`Cancelling PowerShell Process`)
		this.stopPowerShell(true)
		if (testRun !== undefined) {
			this.log.warn(`Cancelling ${testRun?.name ?? 'Unnamed'} Test Run`)
			testRun.appendOutput(`\r\nTest Run was cancelled by user from VSCode\r\n`)
			testRun.end()
		}
		this.log.warn(`Test Run Cancelled`)
	}
}

