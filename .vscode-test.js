// .vscode-test.js
const { defineConfig } = require('@vscode/test-cli')

module.exports = defineConfig({
	files: 'dist/test/**/*.vscode.test.js',
	launchArgs: ['--profile=vscode-pester-test'],
	mocha: {
		ui: 'bdd',
		timeout: 600000 // 10 minutes to allow for debugging
	}
})
