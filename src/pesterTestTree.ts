
/** Represents a test result returned from pester, serialized into JSON */

import { TestItem, TestResultState, Uri } from "vscode"

/** Represents all types that are allowed to be present in a test tree. This can be a single type or a combination of
 * types and organization types such as suites
 */
export type TestTree = TestItemOptions | TestRunResult | TestDefinition

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

export interface TestDefinition extends TestItemOptions {
    startLine: number
    endLine: number
    file: string
    description?: string
    error?: string
    parent?: string
}

export interface TestItemOptions {
    id: string
    uri?: Uri
}

/** A union that represents all types of TestItems related to Pester */
export type TestData = TestDefinition


// /**
//  * Represents a Pester Test file, typically named .tests.ps1.
//  * Its resolveHandler will run the DiscoverTests.ps1 script on the file it represents to discover the Context/Describe/It blocks within.
//  * */
export class TestFile {


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
//         info: TestDefinition
//     ) {
//         info.uri = vscode.Uri.file(info.file)
//         const item = vscode.test.createTestItem<TestDefinition, never>(info, info)

//         // There are no child items here so we don't need a resolve handler
//         item.status = vscode.TestItemStatus.Resolved

//         item.debuggable = false
//         item.runnable = true
//         item.range = new vscode.Range(info.startLine, 0, info.endLine, 0)
//         return item
//     }
// }
