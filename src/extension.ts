import { type ExtensionContext, window, workspace, commands } from 'vscode'

import {
	autoRunStatusBarItem,
	autoRunStatusBarVisibleEvent,
	toggleAutoRunOnSaveCommand,
	updateAutoRunStatusBarOnConfigChange
} from './features/toggleAutoRunOnSaveCommand'
import { PesterTestController } from './pesterTestController'
import {
	getPowerShellExtension,
	PowerShellExtensionClient
} from './powershellExtensionClient'

export async function activate(context: ExtensionContext) {
// 	// PowerShell extension is a prerequisite, but we allow either preview or normal, which is why we do this instead of
// 	// leverage package.json dependencies
// 	const powershellExtension = getPowerShellExtension(context)

// 	// Short circuit this activate call if we didn't find a PowerShell Extension. Another activate will be triggered once
// 	// the powershell extension is available
// 	if (powershellExtension === undefined) {
// 		return
// 	}

// 	// Disable PowerShell codelens setting if present
// const config = PowerShellExtensionClient.GetPesterSettings()
// const psExtensionCodeLensSetting: boolean = config.codeLens

// const suppressCodeLensNotice = workspace.getConfiguration('pester').get<boolean>('suppressCodeLensNotice') ?? false


// 	if (psExtensionCodeLensSetting && !suppressCodeLensNotice) {
// 		void window.showInformationMessage(
// 			'The Pester Tests extension recommends disabling the built-in PowerShell Pester CodeLens. Would you like to do this?',
// 			'Yes',
// 			'Workspace Only',
// 			'No',
// 			'Dont Ask Again'
// 		).then(response => {
// 			switch (response) {
// 				case 'No': {
// 					return
// 				}
// 				case 'Yes': {
// 					void config.update('codeLens', false, true)
// 					break
// 				}
// 				case 'Workspace Only': {
// 					void config.update('codeLens', false, false)
// 					break
// 				}
// 				case 'Dont Ask Again': {
// 					void config.update('suppressCodeLensNotice', true, true)
// 					break
// 				}
// 			}
// 		})
// 	}

// 	const controller = new PesterTestController(powershellExtension, context)
// 	const stopPowerShellCommand = commands.registerCommand('pester.stopPowershell', () => {
// 		if (controller.stopPowerShell()) {
// 			void window.showInformationMessage('PowerShell background process stopped.')
// 		} else {
// 			void window.showWarningMessage('No PowerShell background process was running !')
// 		}
// 	})

// 	context.subscriptions.push(
// 		controller,
// 		toggleAutoRunOnSaveCommand,
// 		stopPowerShellCommand,
// 		autoRunStatusBarItem,
// 		autoRunStatusBarVisibleEvent,
// 		updateAutoRunStatusBarOnConfigChange
// 	)
}
