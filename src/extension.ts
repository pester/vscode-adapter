import { ExtensionContext } from 'vscode'
import { PesterTestController } from './pesterTestController'
import { getPowershellExtension } from './powershellExtensionClient'
export async function activate(context: ExtensionContext) {
	// Powershell extension is a prerequisite, but we allow either preview or normal, which is why we do this instead of
	// leverage package.json dependencies
	const powershellExtension = getPowershellExtension(context)

	// Short circuit this activate call if we didn't find a Powershell Extension. Another activate will be triggered once
	// the powershell extension is available

	if (!powershellExtension) {
		return
	}
	context.subscriptions.push(
		new PesterTestController(powershellExtension, context)
	)
}
