import { TestItem, TestItemCollection } from 'vscode'

/** Returns a Set of all TestItems and their children recursively in the collection. This assumes all your test IDs are unique, duplicates will be replaced **/
export function getUniqueTestItems(collection: TestItemCollection) {
	const TestItems = new Set<TestItem>()
	const addTestItem = (TestItem: TestItem) => {
		TestItems.add(TestItem)
		TestItem.children.forEach(addTestItem)
	}
	collection.forEach(addTestItem)
	return TestItems
}

/** Returns an array of TestItems at the root of the TestItemConnection. This does not fetch children */
export function getTestItems(collection: TestItemCollection) {
	const TestItems = new Array<TestItem>()
	const addTestItem = (TestItem: TestItem) => {
		TestItems.push(TestItem)
	}
	collection.forEach(addTestItem)
	return TestItems
}

/** Performs a breadth-first search for a test item in a given collection. It assumes your test IDs are unique and will only return the first one it finds **/
export function findTestItem(id: string, collection: TestItemCollection) {
	const queue = new Array<TestItemCollection>(collection)

	let match: TestItem | undefined
	while (queue.length) {
		const currentCollection = queue.shift()
		currentCollection!.forEach(item => {
			if (item.id === id) {
				match = item
			}
			if (item.children.size) {
				queue.push(item.children)
			}
		})
		if (match) {
			return match
		}
	}
}

/** Runs the specified function on this item and all its children, if present */
export async function forAll(parent: TestItem, fn: (child: TestItem) => void) {
	fn(parent)
	parent.children.forEach(child => {
		forAll(child, fn)
	})
}
