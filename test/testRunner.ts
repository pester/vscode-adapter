import * as path from 'path'
import { runTests } from '@vscode/test-electron'
import { existsSync } from 'fs'

const JestEnvVarName = 'JESTARGS'

/** Called when running tests directly using node, for example in CI builds */
// eslint-disable-next-line
async function main() {
	console.log("===TESTRUNNER MAIN START===")
	console.log(process.execPath)
	console.log(process.argv)
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = findProjectRoot(__dirname)

		// The path to the extension test script
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.join(extensionDevelopmentPath, 'dist/test/TestRunnerInner')

		// Convert any args passed to this script to an environment variable
		const jestArgs = process.argv.slice(2)

		const extensionTestsEnv: Record<string, string> = { extensionDevelopmentPath }

		if (jestArgs.length > 0) {
			extensionTestsEnv[JestEnvVarName] = Buffer.from(JSON.stringify(jestArgs)).toString('base64')
		}

		// Download VS Code, unzip it and run the integration test
		const testResult = await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			version: 'insiders',
			extensionTestsEnv,
			launchArgs: [
				'--profile-temp',
				extensionDevelopmentPath
			]
		})

		console.log('Tests run result: ', testResult)
	} catch (err) {
		console.log('Failed to run tests', err)
	}
}

/**
 * Forward writes to process.stdout and process.stderr to console.log.
 *
 * For some reason this seems to be required for the Jest output to be streamed
 * to the Debug Console.
 */
function forwardStdoutStderrStreams() {
	const logger = (line: string) => {
		console.log(line)
		return true
	}
	process.stdout.write = logger
	process.stderr.write = logger
}

/** Find package.json in parent directory or higher */
function findProjectRoot(startDir: string): string {
	let currentDir = startDir
	while (currentDir !== '/') {
		const packageJsonPath = path.join(currentDir, 'package.json')
		if (existsSync(packageJsonPath)) {
			return path.dirname(packageJsonPath)
		}
		currentDir = path.dirname(currentDir)
	}
	throw new Error('Could not find package.json')
}


void main()
