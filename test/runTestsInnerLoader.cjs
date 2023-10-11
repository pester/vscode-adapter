/* eslint-disable @typescript-eslint/no-var-requires */
// This shim is needed because you cannot inject the transpiler via NODE_OPTIONS into a packaged electron app like

// code.exe and vscode-test starts the test runner as a packaged app
exports.run = async () => {
	// This allows us to dynamically load typescript files without first compiling them with tsc/esbuild
	require('@swc-node/register')

	// eslint-disable-next-line @typescript-eslint/no-var-requires
	return require('./runTestsInner.ts').run()
}
