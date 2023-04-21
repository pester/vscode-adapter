import * as path from 'path'
import { runCLI } from 'jest'
import { runTests } from '@vscode/test-electron'
import { existsSync } from 'fs'

const JestEnvVarName = 'JESTARGS'

/** The entrypoint to testing that VSCode will call after it starts up a new debug session instance */
export async function run() {
	console.log("=== JEST INNER TEST START ===")
	console.log("Dirname: ", __dirname)
	const projectDir = process.env.extensionDevelopmentPath
	if (projectDir === undefined) {
		throw new Error('Env var extensionDevelopmentPath not set')
	}

	// Re-hydrate any extra passed args to Jest
	const jestArgs = process.env[JestEnvVarName]
	let args: string[] = []
	if (jestArgs !== undefined) {
		// We were passed args from the extensionTestsEnv variable
		args = JSON.parse(Buffer.from(jestArgs, 'base64').toString('utf-8')) as string[]
	}

	console.log('Jest Args: ', args)
	console.log("Project Dir: ", projectDir)

	// runCLI will pick up the config as normal from packages.json and jest.config.ts
	try {
		await runCLI({} as any, [projectDir])
	} catch (err) {
		console.log("RunCLI Failed: ", err)
	}
}
