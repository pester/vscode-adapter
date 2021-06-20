import * as vscode from 'vscode'
import { PesterTestController } from './pesterTestController'
import { TestController } from './testController'

export async function activate(context: vscode.ExtensionContext) {
  const powershellExtension = await getPowershellExtension(context)
  if (!powershellExtension) {return}

  context.subscriptions.push(
    vscode.test.registerTestController(new TestController()),
    vscode.test.registerTestController(await PesterTestController.create(context,powershellExtension)),
  );
}


/** Retrieves either the Powershell or Powershell Preview extension. This is used in place of a package.json extension dependency
 * because either/or is acceptable and there's no way to do this with an extension depenency.
 */
function findPowershellExtension() {
  return vscode.extensions.getExtension("ms-vscode.PowerShell-Preview")
    || vscode.extensions.getExtension("ms-vscode.PowerShell")
}

/** Looks for the powershell extension and if it is not present, wait for it to be installed */
async function getPowershellExtension(context: vscode.ExtensionContext) {
  const powershellExtension = findPowershellExtension()
  if (powershellExtension) {
    return powershellExtension
  } else {
    await vscode.window.showErrorMessage('Please install either the PowerShell or PowerShell Preview extension to use the Pester Test Explorer.');

    // Attempt a reactivation again after extensions have reloaded.
    const activatedEvent = vscode.extensions.onDidChange(() => {
      // Stay registered until Powershell is detected as installed
      if (findPowershellExtension()) {
        activate(context)
        activatedEvent.dispose()
      }
    })
  }
}
