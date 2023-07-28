import { FileChangeEvent, FileChangeType, FileSystemWatcher, RelativePattern, Uri, WorkspaceFolder, workspace } from "vscode"
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
		newTestControllers.forEach(controller => controller.watch())
	})

	const watchers = new Set<FileSystemWatcher>()

	// Register for current workspaces
	if (workspace.workspaceFolders !== undefined) {
		const newTestControllers = workspace.workspaceFolders.map(
			folder => new PesterTestController(folder)
		)
		registerDisposables(newTestControllers)
		newTestControllers.forEach(controller => controller.watch())
	}

	return watchers
}

/**
 * Starts up a filewatcher for each workspace and initialize a test controller for each workspace.
 * @param folder The workspace folder to watch
 * @param cb A callback to be called when a file change is detected
 */
export async function watchWorkspaceFolder(folder: WorkspaceFolder) {
	const testWatchers = new Set<FileSystemWatcher>

	for (const pattern of getPesterRelativePatterns(folder)) {
		// Register a filewatcher for each workspace's patterns
		const testWatcher = workspace.createFileSystemWatcher(pattern)
		registerDisposable(testWatcher)
		testWatchers.add(testWatcher)
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
