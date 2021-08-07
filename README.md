## 🧪 Pester Test Adapter for Visual Studio Code
[![Latest](https://img.shields.io/github/v/release/pester/vscode-adapter?label=latest&sort=semver&style=flat-square)](https://github.com/pester/vscode-adapter/releases)![Downloads](https://img.shields.io/github/downloads/pester/vscode-adapter/latest/total?sort=semver&style=flat-square)
[![License: MIT](https://img.shields.io/npm/l/tslog?logo=tslog&style=flat-square)](https://tldrlegal.com/license/mit-license)

[![Build](https://github.com/pester/vscode-adapter/actions/workflows/ci.yml/badge.svg)](https://github.com/pester/vscode-adapter/actions/workflows/ci.yml)
[![Build](https://github.com/pester/vscode-adapter/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/pester/vscode-adapter/actions/workflows/codeql-analysis.yml)

This extension provides the ability to run [Pester](https://pester.dev/) tests utilizing the native
[Testing functionality](https://code.visualstudio.com/updates/v1_59#_testing-apis) first introduced in Visual Studio Code 1.49

### Highlights
🔍 **Pester Test Browser**<br>
🐞 **Debugging Support**<br>
👩‍💻 **Uses Powershell Integrated Terminal** <br>
👨‍👧‍👦 **Expands Test Cases** <br>

### Extension Prerequisites
- Pester 5.2.0 or later (sorry, no Pester 4 support)
- Powershell 7+ or Windows Powershell 5.1

### Installing the latest beta VSIX
Beta VSIX extension packages are generated upon every commit to master and every pull request update. To install a beta build:
1. Click the green checkmark next to the latest commit
1. Click `Details` next to the `👷‍♂️ Build Visual Studio Code Extension` task
1. Click `Artifacts` in the upper right of the window
1. Download the latest artifact zip, it should be named `vsix-{version}`
1. Unzip the artifact and open the related folder
1. Open the folder in vscode, right click the `.vsix` file, and choose `Install Extension VSIX` near the bottom.
1. Alternatively in vscode you can hit F1 and choose `Extensions: Install from VSIX` and browse for the vsix file.

### Configuration
This extension will use the Powershell Extension Pester verbosity settings for the output.