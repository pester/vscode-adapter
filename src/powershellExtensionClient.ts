// Eventually something like this would go in an npm package

import { Extension, ExtensionContext, extensions, window } from 'vscode'
import { activate } from './extension'

export interface IPowerShellExtensionClient {
    registerExternalExtension(id: string, apiVersion?: string): string
    unregisterExternalExtension(uuid: string): boolean
    getPowerShellVersionDetails(uuid: string): Promise<IExternalPowerShellDetails>
}

export class PowerShellExtensionClient {

    static async create(context: ExtensionContext, powershellExtension: Extension<IPowerShellExtensionClient>) {
        const internalPowerShellExtensionClient = await powershellExtension.activate()
        const item = new PowerShellExtensionClient(context, internalPowerShellExtensionClient)
        item.RegisterExtension(item.context.extension.id)
        return item
    }

    constructor(private context: ExtensionContext, private internalPowerShellExtensionClient: IPowerShellExtensionClient) { }

    private _sessionId: string | undefined
    private get sessionId(): string | undefined {
        if (!this._sessionId) {
            throw new Error("Client is not registered. You must run client.RegisterExtension(extensionId) first before using any other APIs.")
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
    public RegisterExtension(extensionId: string) {
        this.sessionId = this.internalPowerShellExtensionClient.registerExternalExtension(extensionId)
    }

    /**
     * UnregisterExtension
     * https://github.com/PowerShell/vscode-powershell/blob/2d30df76eec42a600f97f2cc28105a9793c9821b/src/features/ExternalApi.ts#L42-L54
     */
    public UnregisterExtension() {
        this.internalPowerShellExtensionClient.unregisterExternalExtension(this.sessionId as string)
        this.sessionId = undefined
    }

    /**
     * GetVersionDetails
     * https://github.com/PowerShell/vscode-powershell/blob/master/src/features/ExternalApi.ts#L58-L76
     */
    public GetVersionDetails(): Thenable<IExternalPowerShellDetails> {
        return this.internalPowerShellExtensionClient.getPowerShellVersionDetails(this.sessionId as string)
    }
}

export interface IExternalPowerShellDetails {
    exePath: string
    version: string
    displayName: string
    architecture: string
}

export function getPowershellExtension(context: ExtensionContext) {
    const powershellExtension = findPowershellExtension()
    if (powershellExtension) {
        return powershellExtension as Extension<IPowerShellExtensionClient>
    } else {
        window.showWarningMessage('You must first install or enable the PowerShell or PowerShell Preview extension to '
            + 'use the Pester Test Adapter. It will be activated automatically.')
        // Register an event that watch for the Powershell Extension to show up
        const activatedEvent = extensions.onDidChange(() => {
            // Stay registered until Powershell is detected as installed
            if (findPowershellExtension()) {
                activate(context)
                activatedEvent.dispose()
            }
        })
    }
}

/** Retrieves either the Powershell or Powershell Preview extension. This is used in place of a package.json extension dependency
 * because either/or is acceptable and there's no way to do this with an extension depenency.
 */
function findPowershellExtension() {
    return extensions.getExtension("ms-vscode.PowerShell-Preview")
        || extensions.getExtension("ms-vscode.PowerShell")
}