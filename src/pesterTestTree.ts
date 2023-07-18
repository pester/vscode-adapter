/** Represents a test result returned from pester, serialized into JSON */

import { Range, TestController, TestItem, Uri } from 'vscode'
import log from './log'

/** Represents all types that are allowed to be present in a test tree. This can be a single type or a combination of
 * types and organization types such as suites
 */
export type TestTree = TestFile | TestDefinition

/** An association of test classes to their managed TestItem equivalents. Use this for custom data/metadata about a test
 * because we cannot store it in the managed objects we get from the Test API
 */
export const TestData = new WeakMap<TestItem, TestTree>()

/**
 * Possible states of tests in a test run.
 */
export type TestResultState = string
/** Represents an individual Pester .tests.ps1 file, or an active document in the editor. This is just a stub to be used
 * for type identification later, the real work is done in {@link PesterTestController.getOrCreateFile()}
 */
export class TestFile {
	// Indicates if a testfile has had Pester Discovery run at least once
	testsDiscovered = false
	private constructor(
		private readonly controller: TestController,
		private readonly uri: Uri
	) {}
	get file() {
		return this.uri.fsPath
	}
	get startLine() {
		return undefined
	}
	get testItem() {
		const testItem = this.controller.items.get(this.uri.toString())
		if (!testItem) {
			throw new Error(
				'No associated test item for testfile:' + this.uri + '. This is a bug.'
			)
		}
		return testItem
	}

	/** Creates a managed TestItem entry in the controller if it doesn't exist, or returns the existing object if it does already exist */
	static getOrCreate(controller: TestController, uri: Uri): TestItem {
		// Normalize paths to uppercase on windows due to formatting differences between Javascript and PowerShell
		const uriFsPath =
			process.platform === 'win32' ? uri.fsPath.toUpperCase() : uri.fsPath
		const existing = controller.items.get(uriFsPath)
		if (existing) {
			return existing
		}
		log.trace('Creating test item for file: ' + uriFsPath)
		const fileTestItem = controller.createTestItem(
			uriFsPath,
			// TODO: Fix non-null assertion
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			uri.path.split('/').pop()!,
			uri
		)
		TestData.set(fileTestItem, new TestFile(controller, uri))
		fileTestItem.canResolveChildren = true
		controller.items.add(fileTestItem)
		return fileTestItem
	}
}

/**
 * Options for calling the createTestItem function This is the minimum required for createTestItem.
 * @template TParent - What types this TestItem is allowed to have as a parent. TestFile should always have the controller root as a parent
 * @template TChild - What types this TestItem can have as a child. Leaf TestItems like test cases should specify 'never'
 */
export interface TestItemOptions {
	/** Uniquely identifies the test. Can be anything but must be unique to the controller */
	id: string
	/** A label for the testItem. This is how it will appear in the test, explorer pane */
	label: string
	/** Which test item is the parent of this item. You can specify the test controller root here */
	parent: string
	/** A resource URI that matches the physical location of this test */
	uri?: Uri
	/** TODO: A temporary type hint until I do a better serialization method */
	type?: string
}

/** Represents a test that has been discovered by Pester. TODO: Separate suite definition maybe? */
export interface TestDefinition extends TestItemOptions {
	startLine: number
	endLine: number
	file: string
	description?: string
	error?: string
	tags?: string[]
	scriptBlock?: string
}

/** The type used to represent a test run from the Pester runner, with additional status data */
export interface TestResult extends TestItemOptions {
	result: TestResultState
	error: string
	duration: number
	durationDetail: string
	message: string
	expected: string
	actual: string
	targetFile: string
	targetLine: number
	description?: string
}

/** Given a testdefinition, fetch the vscode range */
export function getRange(testDef: TestDefinition): Range {
	return new Range(testDef.startLine, 0, testDef.endLine, 0)
}
