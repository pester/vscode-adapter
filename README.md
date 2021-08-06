# Pester Test Adapter for Visual Studio Code
This extension provides the ability to run [Pester](https://pester.dev/) tests utilizing the native
[Testing functionality](https://code.visualstudio.com/updates/v1_59#_testing-apis) first introduced in version 1.49 of
Visual Studio Code

## Extension Prerequisites
- Pester 5.2.0 or later (sorry, no Pester 4 support)
- Windows Powershell 5.1 or Powershell 7+

## Installing the latest beta VSIX
Beta VSIX extension packages are generated upon every commit to master. To install a beta build:
1. Click the green checkmark next to the latest commit
1. Click `Details` next to the `👷‍♂️ Build Visual Studio Code Extension task`
1. Click `Artifacts` in the upper right of the window
1. Download the latest artifact zip, it should be named `vsix-{version}`
1. Unzip the artifact

# Configuration
This extension will use the Powershell pester verbosity settings for the output