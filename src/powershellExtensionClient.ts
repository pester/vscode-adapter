// Eventually something like this would go in an npm package

import {
	debug,
	DebugConfiguration,
	Extension,
	ExtensionContext,
	extensions,
	window,
	workspace
} from 'vscode'
import { activate } from './extension'

export interface IPowerShellExtensionClient {
	registerExternalExtension(id: string, apiVersion?: string): string
	unregisterExternalExtension(uuid: string): boolean
	getPowerShellVersionDetails(uuid: string): Promise<IExternalPowerShellDetails>
}

export class PowerShellExtensionClient {
	static async create(
		context: ExtensionContext,
		powershellExtension: Extension<IPowerShellExtensionClient>
	) {
		const internalPowerShellExtensionClient =
			await powershellExtension.activate()
		const item = new PowerShellExtensionClient(
			context,
			internalPowerShellExtensionClient
		)
		item.RegisterExtension(item.context.extension.id)
		return item
	}

	private constructor(
		private context: ExtensionContext,
		private internalPowerShellExtensionClient: IPowerShellExtensionClient
	) {}

	private _sessionId: string | undefined
	private get sessionId(): string | undefined {
		if (!this._sessionId) {
			throw new Error(
				'Client is not registered. You must run client.RegisterExtension(extensionId) first before using any other APIs.'
			)
		}

		return this._sessionId
	}

	private set sessionId(id: string | undefined) {
		this._sessionId = id
	}

	public get IsConnected() {
		return this._sessionId != null
	}

	/**
	 * RegisterExtension
	 * https://github.com/PowerShell/vscode-powershell/blob/2d30df76eec42a600f97f2cc28105a9793c9821b/src/features/ExternalApi.ts#L25-L38
	 */
	// We do this as part of the constructor so it doesn't have to be public anymore
	private RegisterExtension(extensionId: string) {
		this.sessionId =
			this.internalPowerShellExtensionClient.registerExternalExtension(
				extensionId
			)
	}

	/**
	 * UnregisterExtension
	 * https://github.com/PowerShell/vscode-powershell/blob/2d30df76eec42a600f97f2cc28105a9793c9821b/src/features/ExternalApi.ts#L42-L54
	 */
	public UnregisterExtension() {
		this.internalPowerShellExtensionClient.unregisterExternalExtension(
			this.sessionId as string
		)
		this.sessionId = undefined
	}

	/**
	 * GetVersionDetails
	 * https://github.com/PowerShell/vscode-powershell/blob/master/src/features/ExternalApi.ts#L58-L76
	 */
	public GetVersionDetails(): Thenable<IExternalPowerShellDetails> {
		return this.internalPowerShellExtensionClient.getPowerShellVersionDetails(
			this.sessionId as string
		)
	}

	/**
	 * Lazily fetches the current terminal instance of the PowerShell Integrated Console or starts it if not present
	 */
	public static GetPowerShellIntegratedConsole() {
		return window.terminals.find(
			t => t.name === 'PowerShell Integrated Console'
		)
	}

	public static GetPowerShellSettings() {
		return workspace.getConfiguration('powershell')
	}
	public static GetPesterSettings() {
		return workspace.getConfiguration('powershell.pester')
	}

	public async RunCommand(
		command: string,
		args?: string[],
		isDebug?: boolean,
		onComplete?: (terminalData: string) => void
	) {
		// This indirectly loads the PSES extension and console
		await this.GetVersionDetails()
		PowerShellExtensionClient.GetPowerShellIntegratedConsole()

		const debugConfig: DebugConfiguration = {
			request: 'launch',
			type: 'PowerShell',
			name: 'PowerShell Launch Pester Tests',
			script: command,
			args: args,
			// We use the PSIC, not the vscode native debug console
			internalConsoleOptions: 'neverOpen',
			// TODO: Update this deprecation to match with the paths in the arg?
			cwd: workspace.rootPath!,
			// FIXME: Temporary Test
			noDebug: !isDebug
			// createTemporaryIntegratedConsole: settings.debugging.createTemporaryIntegratedConsole,
			// cwd:
			//     currentDocument.isUntitled
			//         ? vscode.workspace.rootPath
			//         : path.dirname(currentDocument.fileName),
		}

		const terminalData = ''
		// FIXME: Figure out another way to capture terminal data, this is a proposed API that will never go stable
		// const terminalDataEvent = window.onDidWriteTerminalData(e => {
		//     if (e.terminal !== psic) {return}
		//     terminalData += e.data
		// })
		if (!(await debug.startDebugging(debugConfig.cwd, debugConfig)))
			throw new Error('Debug Session did not start as expected')

		// TODO: Figure out how to "await" this and return it as a string
		const stopDebugEvent = debug.onDidTerminateDebugSession(e => {
			// FIXME: Figure out another way to capture terminal data, this is a proposed API that will never go stable
			// terminalDataEvent.dispose()
			stopDebugEvent.dispose()
			if (onComplete) {
				onComplete(terminalData)
			}
		})
	}
}

export interface IExternalPowerShellDetails {
	exePath: string
	version: string
	displayName: string
	architecture: string
}

export function getPowerShellExtension(context: ExtensionContext) {
	const powershellExtension = findPowerShellExtension()
	if (powershellExtension) {
		return powershellExtension as Extension<IPowerShellExtensionClient>
	} else {
		window.showWarningMessage(
			'You must first install or enable the PowerShell or PowerShell Preview extension to ' +
				'use the Pester Test Adapter. It will be activated automatically.'
		)
		// Register an event that watch for the PowerShell Extension to show up
		const activatedEvent = extensions.onDidChange(() => {
			// Stay registered until PowerShell is detected as installed
			if (findPowerShellExtension()) {
				activate(context)
				activatedEvent.dispose()
			}
		})
	}
}

/** Retrieves either the PowerShell or PowerShell Preview extension. This is used in place of a package.json extension dependency
 * because either/or is acceptable and there's no way to do this with an extension depenency.
 */
function findPowerShellExtension() {
	return (
		extensions.getExtension('ms-vscode.PowerShell-Preview') ||
		extensions.getExtension('ms-vscode.PowerShell')
	)
}
