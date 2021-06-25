
/** Represents a test result returned from pester, serialized into JSON */

import { join } from "path"
import { Extension, ExtensionContext, TestController, TestItem, TestResultState, Uri } from "vscode"
import { IExternalPowerShellDetails, IPowerShellExtensionClient, PowerShellExtensionClient } from "./powershellExtensionClient"
import { PowerShellRunner } from "./powershellRunner"
/** Represents all types that are allowed to be present in a test tree. This can be a single type or a combination of
 * types and organization types such as suites
 */
export type TestTree = TestFile | TestDefinition

/** Represents an individual Pester .tests.ps1 file, or an active document in the editor. This is just a stub to be used
 * for type identification later, the real work is done in {@link PesterTestController.getOrCreateFile()}
*/
export class TestFile {

    private constructor(private readonly controller: TestController<TestFile>, private readonly uri: Uri) {}
    get file() {return this.uri.fsPath}
    get startLine() {return undefined}

    /** Creates a managed TestItem entry in the controller if it doesn't exist, or returns the existing object if it does already exist */
    static getOrCreate(controller: TestController<TestFile>, uri: Uri): TestItem<TestFile> {
        const existing = controller.root.children.get(uri.toString())
        if (existing) {
            return existing
        }
        const file = controller.createTestItem<TestFile>(
            uri.toString(),
            uri.path.split('/').pop()!,
            controller.root,
            uri,
            new TestFile(controller, uri) //Mostly a stub for type identification and methods
        );
        file.canResolveChildren = true
        return file;
    }

    async discoverTests() {
        // HACK: Because the managed controller data type is returned as an <any>, we need to type assert it back to a TestRootContext
        // so that the return type is inferred correctly
        const testRootContext: TestRootContext = this.controller.root.data
        return await testRootContext.discoverPesterTests([this.uri.fsPath], false)
    }
}

/**
 * Options for calling the createTestItem function This is the minimum required for createTestItem.
 * @template TParent - What types this TestItem is allowed to have as a parent. TestFile should always have the controller root as a parent
 * @template TChild - What types this TestItem can have as a child. Leaf TestItems like test cases should specify 'never'
 */
export interface TestItemOptions<T, TParent = any> {
    /** Uniquely identifies the test. Can be anything but must be unique to the controller */
    id: string
    /** A label for the testItem. This is how it will appear in the test, explorer pane */
    label: string
    /** Which test item is the parent of this item. You can specify the test controller root here */
    parent: string
    /** A resource URI that matches the physical location of this test */
    uri?: Uri
    /** Custom data that never leaves this test */
    data?: T
}

/** Represents a test that has been discovered by Pester. TODO: Separate suite definition maybe? */
export interface TestDefinition extends TestItemOptions<TestTree, TestTree> {
    startLine: number
    endLine: number
    file: string
    description?: string
    error?: string
    tags?: string
}

/** The type used to represent a test run from the Pester runner, with additional status data */
export interface TestResult extends TestItemOptions<TestTree, TestTree> {
    result: TestResultState
    duration: number
    durationDetail: string
    message: string
    expected: string
    actual: string
    targetFile: string
    targetLine: number
    description?: string
}

/** Stores data for the test root, such as the shared Powershell Runner. It will derive all needed info from the Powershell Extension */
export class TestRootContext {
    private constructor(
        public testExtensionContext: ExtensionContext,
        public powerShellExtension: Extension<IPowerShellExtensionClient>,
        public powerShellExtensionClient: PowerShellExtensionClient,
        public powerShellRunner: Promise<PowerShellRunner>,
        public psVersionDetails: IExternalPowerShellDetails,
        public testController: TestController<TestRootContext>
    ) {}

    public static async create(testController: TestController,testExtensionContext: ExtensionContext, powerShellExtension: Extension<IPowerShellExtensionClient>) {
        //TODO: Lazy load this at Pester Test Invocation
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
    async getPesterTests<T>(path: string[], discoveryOnly?: boolean, testsOnly?: boolean) {
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
        return this.getPesterTests<TestDefinition>(path, true, testsOnly)
    }
    /** Run Pester Tests and retrieve the results */
    async runPesterTests(path: string[], testsOnly?: boolean) {
        return this.getPesterTests<TestResult>(path, false, testsOnly)
    }

}