Welcome! There are many ways you can contribute to the extension

# Documentation / Non-Code Changes

I recommend you use the Remote Repositories extension to check this repository out in VSCode, make adjustments, and
submit a pull request, all without ever having to clone the repository locally.

TODO: "Peek with VSCode Remote Repositories" button

# Development

The extension is broken into the following abstraction layers:

1. **Extension** - The main extension, verifies prerequisites and registers the test controller
1. **PesterTestController** - An implementation of the vscode test controller
1. **PesterTestTree** - A "live object" model that represents the tests to run and their organization. For now they follow
   the Pester hierarchy (File/Describe/Context/It) though additional hierarchies (Group by Tag/Function/etc) are planned
1. **PesterTestRunner** - Contains methods for running pester tests, used by Pester Test Controller
1. **PowerShellRunner** - Contains methods for running powershell scripts, used by PesterTestRunner

## Resolve dependencies

In the local repository install the dependencies by running the following (answer _yes_  on all questions):

```bash
npm run install
```

This needs to be repeated everytime the packages in the `package.json` is modified, those packages under the names `devDependencies` and `dependencies`.

## Build project

There is normally no need to manually build the project (see [Running Tests](#running-test) instead), but it is posisble from command line or from
Visual Studio code.

In both scenarios, answer _yes_ on the question about creating a license.

### Using command line

```bash
# Generates version 0.0.0
npm run build
```

```bash
# Generates version 12.0.0
npm run build v12.0.0
```

The version number of the extension. Can be any version number for testing to install and
use the extension in VS Code.

### Using Visual Studio Code

Open the Command Palette, then choose _Task: Run Task_. In the drop down list choose _npm: build_. Faster yet, choose the _Task: Run Build Task_ in the Command Palette.

## Start debug session

To start a debug session just press the key **F5**, or in Visual Studio Code go to _Run and Debug_ and click on the green arrow to the left of _Run Extension_.

This will build, start the _watch_ task, and run a new _second_ instance of Visual Studio Code side-by-side, and have the extension loaded. It will also open the 'sample' folder
in the workspace. The 'sample' is part of the Pester Test Adapter project. Once the second instance of Visual Studio Code is started it is possible to close the default folder
and open another workspace or folder. When the second instance of Visual Studio Code is closed the debug session ends.

This project uses the Jest test framework with the esbuild-jest plugin to quickly compile the typescript for testing.
The task `watch` will start (`npm run watch`) in the background that watches for code changes (saved files) an does a rebuild.

### Setting breakpoints

During the debug session you can set breakpoints in the code as per usual, and you can step through the code.

### Debug logging

Debug logging from the extension can be found in the _Debug Console_ in the first instance of Visual Studio Code.

### Debug PowerShell scripts

It is not possible to debug the PowerShell scripts that the extension runs in the debug session (explained above). Instead the scripts have to be manually run in the PSIC, for
example copy the "one-liner" to be run from the _Debug Console_ window and run it manually. Before running the scripts manully it is possible to set breakpoints in the PowerShell
scripts which then will be hit.

## Running Tests

There are also test that can be run from the command line using:

```bash
npm run tests
```
