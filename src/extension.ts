import { type ExtensionContext, window, workspace, Disposable, WorkspaceConfiguration, Extension } from 'vscode'
import {
	waitForPowerShellExtension,
	PowerShellExtensionClient,
	IPowerShellExtensionClient
} from './powershellExtensionClient'
import { watchWorkspace } from './workspaceWatcher'
import log, { VSCodeLogOutputChannelTransport } from './log'

export async function activate(context: ExtensionContext) {

	log.attachTransport(new VSCodeLogOutputChannelTransport('Pester').transport)

	subscriptions = context.subscriptions

	// PowerShell extension is a prerequisite
	const powershellExtension = await waitForPowerShellExtension()
	pesterExtensionContext = {
		extensionContext: context,
		powerShellExtension: powershellExtension,
		powershellExtensionPesterConfig: PowerShellExtensionClient.GetPesterSettings()
	}

	promptForPSLegacyCodeLensDisable()

	await watchWorkspace()

	// TODO: Rig this up for multiple workspaces
	// const stopPowerShellCommand = commands.registerCommand('pester.stopPowershell', () => {
	// 	if (controller.stopPowerShell()) {
	// 		void window.showInformationMessage('PowerShell background process stopped.')
	// 	} else {
	// 		void window.showWarningMessage('No PowerShell background process was running !')
	// 	}
	// })

	// context.subscriptions.push(
	// 	controller,
	// 	stopPowerShellCommand,
	// )

}

/** Register a Disposable with the extension so that it can be cleaned up if the extension is disabled */
export function registerDisposable(disposable: Disposable) {
	if (subscriptions == undefined) {
		throw new Error('registerDisposable called before activate. This should never happen and is a bug.')
	}
	subscriptions.push(disposable)
}

export function registerDisposables(disposables: Disposable[]) {
	subscriptions.push(Disposable.from(...disposables))
}

let subscriptions: Disposable[]

type PesterExtensionContext = {
	extensionContext: ExtensionContext
	powerShellExtension: Extension<IPowerShellExtensionClient>
	powershellExtensionPesterConfig: WorkspaceConfiguration
}

/** Get the activated extension context */
export function getPesterExtensionContext() {
	if (pesterExtensionContext == undefined) {
		throw new Error('Pester Extension Context attempted to be fetched before activation. This should never happen and is a bug')
	}

	return pesterExtensionContext
}
let pesterExtensionContext: PesterExtensionContext

function promptForPSLegacyCodeLensDisable() {
	// Disable PowerShell codelens setting if present
	const powershellExtensionConfig = PowerShellExtensionClient.GetPesterSettings()

	const psExtensionCodeLensSetting: boolean = powershellExtensionConfig.codeLens

	const suppressCodeLensNotice = workspace.getConfiguration('pester').get<boolean>('suppressCodeLensNotice') ?? false

	if (psExtensionCodeLensSetting && !suppressCodeLensNotice) {
		void window.showInformationMessage(
			'The Pester Tests extension recommends disabling the built-in PowerShell Pester CodeLens. Would you like to do this?',
			'Yes',
			'Workspace Only',
			'No',
			'Dont Ask Again'
		).then(async response => {
			switch (response) {
				case 'No': {
					return
				}
				case 'Yes': {
					await powershellExtensionConfig.update('codeLens', false, true)
					break
				}
				case 'Workspace Only': {
					await powershellExtensionConfig.update('codeLens', false, false)
					break
				}
				case 'Dont Ask Again': {
					await workspace.getConfiguration('pester').update('suppressCodeLensNotice', true, true)
					break
				}
			}
		})
	}
}
