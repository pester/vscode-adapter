Welcome! There are many ways you can contribute to the extension

# Documentation / Non-Code Changes

I recommend you use the Remote Repositories extension to check this repository out in VSCode, make adjustments, and
submit a pull request, all without ever having to clone the repository locally.

TODO: "Peek with VSCode Remote Repositories" button

# Running Tests
This project uses the Jest test framework with the esbuild-jest plugin to quickly compile the typescript for testing.

# Development

The extension is broken into the following abstraction layers:

1. **Extension** - The main extension, verifies prerequisites and registers the test controller
1. **PesterTestController** - An implementation of the vscode test controller
1. **PesterTestTree** - A "live object" model that represents the tests to run and their organization. For now they follow
   the Pester hierarchy (File/Describe/Context/It) though additional hierarchies (Group by Tag/Function/etc) are planned
1. **PesterTestRunner** - Contains methods for running pester tests, used by Pester Test Controller
1. **PowershellRunner** - Contains methods for running powershell scripts, used by PesterTestRunner
