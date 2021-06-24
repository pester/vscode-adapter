
/** Represents a test result returned from pester, serialized into JSON */

import { join } from "path"
import { Extension, ExtensionContext, TestController, TestItem, TestResultState, Uri } from "vscode"
import { IExternalPowerShellDetails, IPowerShellExtensionClient, PowerShellExtensionClient } from "./powershellExtensionClient"
import { PowerShellRunner } from "./powershellRunner"
/** Represents all types that are allowed to be present in a test tree. This can be a single type or a combination of
 * types and organization types such as suites
 */
export type TestTree = CreateTestOptions | TestRunResult | TestDefinition | TestRootContext

/** The type used to represent a test run from the Pester runner, with additional status data */
export interface TestRunResult extends TestItem {
    result: TestResultState
    duration: number
    message: string
    expected: string
    actual: string
    targetFile: string
    targetLine: number
}

export interface TestDefinition extends CreateTestOptions {
    startLine: number
    endLine: number
    file: string
    description?: string
    error?: string
}

/**
 * Options for creating a managed test item
 *
 */
export interface CreateTestOptions {
    /** Uniquely identifies the test. Can be anything but must be unique to the controller */
    id: string
    /** A label for the testItem. This is how it will appear in the test explorer pane */
    label: string
    /** Which test item is the parent of this item. You can specify the test controller root here */
    parent: TestItem<any>
    /** A resource URI that matches the physical location of this test */
    uri?: Uri
    /** Custom data that never leaves this test */
    data?: any
}

/** A union that represents all types of TestItems related to Pester */
export type TestData = TestDefinition

/** Stores data for the test root, such as the shared Powershell Runner. It will derive all needed info from the Powershell Extension */
export class TestRootContext {
    private constructor(
        public testExtensionContext: ExtensionContext,
        public powerShellExtension: Extension<IPowerShellExtensionClient>,
        public powerShellExtensionClient: PowerShellExtensionClient,
        public powerShellRunner: Promise<PowerShellRunner>,
        public psVersionDetails: IExternalPowerShellDetails,
        public testController: TestController
    ) {}

    public static async create(testController: TestController,testExtensionContext: ExtensionContext, powerShellExtension: Extension<IPowerShellExtensionClient>) {
        const pseClient = await PowerShellExtensionClient.create(testExtensionContext,powerShellExtension)
        const psVersionDetails = await pseClient.GetVersionDetails()
        //HACK: We need to remove .exe from the path because Node-Powershell will add it on
        const psExePath = psVersionDetails.exePath.replace(new RegExp('\.exe$'), '')
        const pseRunner = PowerShellRunner.create(psExePath)
        return new TestRootContext(
            testExtensionContext,
            powerShellExtension,
            pseClient,
            pseRunner,
            psVersionDetails,
            testController
        )
    }


    /** Fetch the Pester Test json information for a particular path(s) */
    async getPesterTests<T extends TestTree>(path: string[], discoveryOnly?: boolean, testsOnly?: boolean) {
        const scriptFolderPath = join(this.testExtensionContext.extension.extensionPath, 'Scripts')
        const scriptPath = join(scriptFolderPath, 'PesterInterface.ps1')
        let scriptArgs = Array<string>()
        if (testsOnly) {scriptArgs.push('-TestsOnly')}
        if (discoveryOnly) {scriptArgs.push('-Discovery')}
        // Add remaining search paths as arguments, these will be rolled up into the path parameter of the script
        scriptArgs.push(...path)

        // Lazy initialize the powershell runner so the filewatcher-based test finder works quickly
        try {
            const runner = await this.powerShellRunner
            // TODO: Need validation here
            const runnerResult = await runner.execPwshScriptFile(scriptPath,scriptArgs)
            console.log('Objects received from Pester',runnerResult.result)
            const result:T[] = runnerResult.result as T[]

            // TODO: Refactor this using class-transformer https://github.com/typestack/class-transformer

            // Coerce null/undefined into an empty arrayP
            if (result == null || result == undefined) {return new Array<T>()}

            // BUG: ConvertTo-Json in PS5.1 doesn't have a "-AsArray" and can return single objects which typescript doesn't catch.
            if (!Array.isArray(result)) {throw 'Powershell script returned a single object that is not an array. This is a bug. Make sure you did not pipe to Convert-Json!'}
            return result
        } catch (err) {
            throw new Error(err)
        }
    }

    /** Retrieve Pester Test information without actually running them */
    async discoverPesterTests(path: string[], testsOnly?: boolean) {
        return this.getPesterTests<TestTree>(path, false, testsOnly)
    }
    /** Run Pester Tests and retrieve the results */
    async runPesterTests(path: string[], testsOnly?: boolean) {
        return this.getPesterTests<TestRunResult>(path, false, testsOnly)
    }

}


// /**
//  * Represents a Pester Test file, typically named .tests.ps1.
//  * Its resolveHandler will run the DiscoverTests.ps1 script on the file it represents to discover the Context/Describe/It blocks within.
//  * */
// TODO: Should be an interface to implement from the controller side
export class TestFile {
    constructor(
        private readonly uri: Uri,
        private readonly testController: TestController
    ) {

    }
    async discoverTests() {
        return await this.testController.root.data.discoverPesterTests([this.uri.fsPath], true)
    }

    // public static create(testFilePath: Uri, ps: PesterTestController) {
    //     const item = test.createTestItem<TestFile, TestData>({
    //         id: testFilePath.toString(),
    //         label: testFilePath.path.split('/').pop()!,
    //         uri: testFilePath
    //     })
    //     item.resolveHandler = async token => {
    //         token.onCancellationRequested(() => {
    //             item.status = vscode.TestItemStatus.Pending
    //         })
    //         const fsPath = testFilePath.fsPath
    //         const fileTests = await ps.discoverPesterTests([fsPath], true)
    //         for (const testItem of fileTests) {
    //             try {
    //                 item.addChild(
    //                     TestIt.create(testItem)
    //                 )
    //             } catch (err) {
    //                 vscode.window.showErrorMessage(err.message)
    //             }
    //         }
    //         item.status = vscode.TestItemStatus.Resolved
    //     }
    //     // TODO: Populate Test Data with an object that makes this runnable
    //     item.debuggable = false
    //     item.runnable = true
    //     item.status = vscode.TestItemStatus.Pending
    //     return item
    // }
}

// /** Represents an "It" statement block in Pester which roughly correlates to a Test Case or set of Cases */
// export class TestIt {
//     public static create(
//         ctrl: TestController
//         info: TestDefinition
//     ) {
//         info.uri = Uri.file(info.file)
//         const item = createTestItem<TestIt>(ctrl info)

//         // There are no child items here so we don't need a resolve handler
//         item.status = vscode.TestItemStatus.Resolved

//         item.debuggable = false
//         item.runnable = true
//         item.range = new vscode.Range(info.startLine, 0, info.endLine, 0)
//         return item
//     }
// }
