import { ExtensionContext, window, workspace, commands } from 'vscode'
import {
	autoRunStatusBarItem,
	autoRunStatusBarVisibleEvent,
	toggleAutoRunOnSaveCommand,
	updateAutoRunStatusBarOnConfigChange
} from './features/toggleAutoRunOnSaveCommand'
import { VSCodeOutputChannelTransport } from './log'
import { PesterTestController } from './pesterTestController'
import {
	getPowerShellExtension,
	PowerShellExtensionClient
} from './powershellExtensionClient'
export async function activate(context: ExtensionContext) {
	// PowerShell extension is a prerequisite, but we allow either preview or normal, which is why we do this instead of
	// leverage package.json dependencies
	const powershellExtension = getPowerShellExtension(context)

	// Short circuit this activate call if we didn't find a PowerShell Extension. Another activate will be triggered once
	// the powershell extension is available
	if (!powershellExtension) {
		return
	}

	// Disable PowerShell codelens setting if present
	const psExtensionCodeLensSetting =
		PowerShellExtensionClient.GetPesterSettings().codeLens
	const suppressCodeLensNotice = workspace
		.getConfiguration('pester')
		.get<boolean>('suppressCodeLensNotice')

	if (psExtensionCodeLensSetting && !suppressCodeLensNotice) {
		window
			.showInformationMessage(
				'The Pester Tests extension recommends disabling the built-in PowerShell Pester CodeLens. Would you like to do this?',
				'Yes',
				'Workspace Only',
				'No',
				'Dont Ask Again'
			)
			.then(response => {
				switch (response) {
					case 'No': {
						return
					}
					case 'Yes': {
						workspace
							.getConfiguration('powershell.pester')
							.update('codeLens', false, true)
						break
					}
					case 'Workspace Only': {
						workspace
							.getConfiguration('powershell.pester')
							.update('codeLens', false, false)
						break
					}
					case 'Dont Ask Again': {
						workspace
							.getConfiguration('pester')
							.update('suppressCodeLensNotice', true, true)
						break
					}
				}
			})
	}

	const controller = new PesterTestController(powershellExtension, context)
	const stopPowerShellCommand = commands.registerCommand(
		'pester.stopPowershell',
		() => {
			if (controller.stopPowerShell()) {
				window.showInformationMessage('PowerShell background process stopped.')
			} else {
				window.showWarningMessage(
					'No PowerShell background process was running !'
				)
			}
		}
	)

	context.subscriptions.push(
		controller,
		toggleAutoRunOnSaveCommand,
		stopPowerShellCommand,
		autoRunStatusBarItem,
		autoRunStatusBarVisibleEvent,
		updateAutoRunStatusBarOnConfigChange
	)
}
