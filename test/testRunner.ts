import * as path from 'path'
import { runCLI } from 'jest'
import { run as runJest } from 'jest'
import { runTests } from '@vscode/test-electron'

/** The entrypoint to testing that VSCode will call after it starts up a new debug session instance */
export async function run() {
	const projectDir = path.resolve(__dirname, '..')
	// runCLI will pick up the config as normal from packages.json and jest.config.ts
	const result = (await runCLI({} as any, [projectDir])).results

	if (!result.success) {
		throw new Error(`Failed ${result.numFailedTests} tests`)
	} else {
		console.log('🎉 All tests passed!')
	}

	forwardStdoutStderrStreams()
	const result2 = runJest()
	console.log('Done!')
	return result2
}

/** Called when running tests directly using node, for example in CI builds */
async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '..')

		// The path to the extension test script
		// Passed to --extensionTestsPath
		const extensionTestsPath = __filename

		// Download VS Code, unzip it and run the integration test
		const exitCode = await runTests({
			extensionDevelopmentPath,
			extensionTestsPath
		})
		if (exitCode !== 0) {
			console.error(
				`VSCode Test Run failed with non-zero exit code: ${exitCode}`
			)
			process.exit(exitCode)
		}
	} catch (err) {
		console.error('Failed to run tests')
		process.exit(1)
	}
}

// run main() if called directly from node. Useful if running tests from CLI
if (require.main === module) {
	main()
}

/**
 * Forward writes to process.stdout and process.stderr to console.log.
 *
 * For some reason this seems to be required for the Jest output to be streamed
 * to the Debug Console.
 */
function forwardStdoutStderrStreams() {
	const logger = (line: string) => {
		console.log(line) // tslint:disable-line:no-console
		return true
	}

	process.stdout.write = logger
	process.stderr.write = logger
}
