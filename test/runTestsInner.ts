// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { globSync } from "glob"
import path from "path"
import Mocha from "mocha"

/**
 * This is the entrypoint into the standalone vscode instance that should be passed to the --extensionsTestPath
 * parameter of the test VSCode instance. The vscode instance will close once this function either completes or throws
 * an error and will return an appropriate exit code.
 * @returns A Promise that resolves when the tests have completed.
 * @throws An error if the environment variable __TEST_EXTENSION_DEVELOPMENT_PATH is missing, if no tests are found for the specified glob pattern, or if the test run has one or more failures
 */
export async function run(): Promise<void> {
	/** Allow tools like Mocha Test Explorer to inject their own Mocha worker, overriding the default behavior */
	if (process.env.MOCHA_WORKER_PATH) {
		return require(process.env.MOCHA_WORKER_PATH)
	}

	/** Passed from RunTests */
	const rootDir = process.env.__TEST_EXTENSION_DEVELOPMENT_PATH
	if (!rootDir) {
		throw new Error("Missing environment variable __TEST_EXTENSIONDEVELOPMENTPATH, this is probably a bug in runTests.ts")
	}

	interface MochaOptionsWithFiles extends Mocha.MochaOptions {
		spec?: string
	}

	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const config: MochaOptionsWithFiles = require(path.resolve(rootDir, ".mocharc.json"))
	if (config.spec === undefined) {
		throw new Error("spec must be specified in the config options when running vscode launch tests")
	}

	// Only run E2E tests in the test runner
	if (config.grep === 'vscode-e2e') {
		console.log("Running vscode-e2e tests only")
		config.invert = false
	}

	const mocha = new Mocha(config)

	// Test if files is empty
	const files = globSync(config.spec, { cwd: rootDir })
	if (files.length === 0) {
		console.log("No tests found for glob pattern: test.ts in directory: " + rootDir)
		throw new Error("No tests found for glob pattern: test.ts in directory: " + rootDir)
	}

	// Add files to the test suite
	for (const file of files) {
		const testFile = path.resolve(rootDir, file)
		mocha.addFile(testFile)
	}

	mocha.reporter("mocha-multi-reporters", {
		reporterEnabled: "spec, xunit",
		xunitReporterOptions: {
			output: path.resolve(rootDir, "test-results.xml"),
		}
	})

	return runMochaAsync(mocha)
}

/**
 * Runs the given Mocha instance asynchronously and returns a Promise that resolves when all tests have completed.
 * @param mocha The Mocha instance to run.
 * @returns A Promise that resolves when all tests have completed successfully, or rejects with an error if any tests fail.
 */
async function runMochaAsync(mocha: Mocha): Promise<void> {
	return new Promise((resolve, reject) => {
		mocha.run(failures => {
			if (failures > 0) {
				reject(new Error(`${failures} tests failed.`))
			} else {
				resolve()
			}
		})
	})
}
