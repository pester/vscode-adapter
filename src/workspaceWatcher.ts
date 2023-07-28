import { FileSystemWatcher, RelativePattern, WorkspaceFolder, workspace } from "vscode"
import log from "./log"
import { registerDisposable, registerDisposables } from "./extension"
import { PesterTestController } from "./pesterTestController"

/** Watches the workspace for changes in workspace folders */
export async function watchWorkspace() {
	// Create a test controller for each workspace folder
	workspace.onDidChangeWorkspaceFolders(async changedFolders => {
		const newTestControllers = changedFolders.added.map(
			folder => new PesterTestController(folder)
		)
		registerDisposables(newTestControllers)
	})

	const watchers = new Set<FileSystemWatcher>()

	// Register for current workspaces
	if (workspace.workspaceFolders !== undefined) {
		const newTestControllers = workspace.workspaceFolders.map(
			folder => new PesterTestController(folder)
		)
		registerDisposables(newTestControllers)
	}

	return watchers
}

/**
 * Starts up a filewatcher for each workspace and initialize a test controller for each workspace.
 */
export async function watchWorkspaceFolder(folder: WorkspaceFolder) {
	const testWatchers = new Set<FileSystemWatcher>

	for (const pattern of getPesterRelativePatterns(folder)) {

		// Register a filewatcher for each workspace's patterns
		const testWatcher = workspace.createFileSystemWatcher(pattern)
		testWatcher.onDidCreate(uri => {
			log.info(`File created: ${uri.toString()}`)
			// tests.add(TestFile.getOrCreate(testController, uri))
		})
		testWatcher.onDidDelete(uri => {
			log.info(`File deleted: ${uri.toString()}`)
			// tests.delete(TestFile.getOrCreate(testController, uri).id)
		})
		testWatcher.onDidChange(uri => {
			log.info(`File saved: ${uri.toString()}`)
			// const savedFile = TestFile.getOrCreate(testController, uri)
			// this.resolveHandler(savedFile, undefined, true)
		})

		registerDisposable(testWatcher)

		testWatchers.add(testWatcher)

		// Add the filewatcher to the set of watchers to be returned
		const files = await workspace.findFiles(pattern)

		for (const file of files) {
			log.info('Detected Pester File: ', file.fsPath)
			// TestFile.getOrCreate(testController, file)
		}
	}
	return testWatchers
}

/** Returns a list of relative patterns based on user configuration for matching Pester files in the workspace */
function getPesterRelativePatterns(workspaceFolder: WorkspaceFolder): RelativePattern[] {
	const pathsToWatch = workspace
		.getConfiguration('pester')
		.get<string[]>('testFilePath')

	if (!pathsToWatch) {
		throw new Error('No paths to watch found in user configuration')
	}

	return pathsToWatch.map(path => new RelativePattern(workspaceFolder, path))
}
