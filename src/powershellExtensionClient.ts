// Eventually something like this would go in an npm package

import { randomInt } from 'crypto'
import {
	debug,
	DebugConfiguration,
	DebugSession,
	Extension,
	ExtensionContext,
	extensions,
	window,
	workspace
} from 'vscode'

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
		onComplete?: (terminalData: DebugSession) => void,
		cwd?: string,
	) {
		// This indirectly loads the PSES extension and console
		await this.GetVersionDetails()
		PowerShellExtensionClient.GetPowerShellIntegratedConsole()

		// RandomUUID is not available in vscode 1.62, this is a simple substitute
		// I couldn't find this defined in Javascript/NodeJs anywhere. https://stackoverflow.com/questions/33609404/node-js-how-to-generate-random-numbers-in-specific-range-using-crypto-randomby
		const maxRandomNumber = 281474976710655

		const debugId = randomInt(maxRandomNumber)
		const debugConfig: DebugConfiguration = {
			request: 'launch',
			type: 'PowerShell',
			name: 'PowerShell Launch Pester Tests',
			script: command,
			args: args,
			// We use the PSIC, not the vscode native debug console
			internalConsoleOptions: 'neverOpen',
			// TODO: Update this deprecation to match with the paths in the arg?
			cwd: cwd,
			__Id: debugId
			// createTemporaryIntegratedConsole: settings.debugging.createTemporaryIntegratedConsole,
			// cwd:
			//     currentDocument.isUntitled
			//         ? vscode.workspace.rootPath
			//         : path.dirname(currentDocument.fileName),
		}

		// FIXME: Figure out another way to capture terminal data, this is a proposed API that will never go stable
		// const terminalDataEvent = window.onDidWriteTerminalData(e => {
		//     if (e.terminal !== psic) {return}
		//     terminalData += e.data
		// })

		const debugStarted = await debug.startDebugging(
			debugConfig.cwd,
			debugConfig
		)
		// HACK: Ideally startDebugging would return the ID of the session
		const thisDebugSession = debug.activeDebugSession
		if (!debugStarted || !thisDebugSession) {
			throw new Error('Debug Session did not start as expected')
		}
		const stopDebugEvent = debug.onDidTerminateDebugSession(debugSession => {
			if (debugSession.configuration.__Id !== debugId) {
				return
			}
			// This is effectively a "once" operation
			stopDebugEvent.dispose()
			if (onComplete) {
				onComplete(debugSession)
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

export function waitForPowerShellExtension() {
	return new Promise<Extension<IPowerShellExtensionClient>>(resolve => {
		const powershellExtension = extensions.getExtension('ms-vscode.PowerShell')
		if (powershellExtension) {
			return resolve(powershellExtension)
		}

		window.showWarningMessage(
			'You must first install or enable the PowerShell or PowerShell Preview extension to ' +
			'use the Pester Test Adapter. It will be activated automatically once the required extension is installed'
		)
		// Register an event that watch for the PowerShell Extension to show up
		const activatedEvent = extensions.onDidChange(() => {
			const powershellExtension = extensions.getExtension('ms-vscode.PowerShell')
			if (powershellExtension) {
				activatedEvent.dispose()
				return resolve(powershellExtension)
			}
		})
	})
}
