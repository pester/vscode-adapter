import { doesNotMatch } from 'assert'
import { execSync, spawn } from 'child_process'
import { pipeline, Readable } from 'stream'
import { promisify } from 'util'
import { createJsonParseTransform, PowerShell } from './powershell'

const pipelineWithPromise = promisify(pipeline)
// jest.setTimeout(30000)

describe('jsonParseTransform', () => {
	interface TestObject {
		Test: number
	}

	it('object', async () => {
		const source = Readable.from(['{"Test": 5}'])
		const jsonPipe = createJsonParseTransform()

		await pipelineWithPromise(source, jsonPipe)
		const result = jsonPipe.read()
		expect(result).toStrictEqual<TestObject>({ Test: 5 })
	})

	it('empty', async () => {
		const source = Readable.from([''])
		const jsonPipe = createJsonParseTransform()

		try {
			await pipelineWithPromise(source, jsonPipe)
		} catch (err) {
			expect(err.message).toMatch('Unexpected end')
		}
	})

	it('syntaxError', async () => {
		const source = Readable.from(['"Test":5}'])
		const jsonPipe = createJsonParseTransform()

		try {
			await pipelineWithPromise(source, jsonPipe)
		} catch (err) {
			expect(err.message).toMatch('Unexpected token')
		}
	})
})

describe('run', () => {
	const pp = new PowerShell()

	test('Get-Item', async () => {
		const p = new PowerShell()
		const result = await p.run<any>(`Get-Item .`)
		expect(result.PSIsContainer).toBe(true)
		p.dispose()
	})

	test('Get-Item Preload', async () => {
		const pp = new PowerShell()
		const result = await pp.run<any>(`Get-Item .`)
		expect(result.PSIsContainer).toBe(true)
		pp.dispose()
	})

	/** Verify that if two commands are run at the same time, they complete independently without interfering with each other */
	test('Parallel', async () => {
		const p = new PowerShell()
		const result = p.run<any>(`'Item1';sleep 0.05`)
		const result2 = p.run<any>(`'Item2'`)
		expect(await result2).toBe('Item2')
		expect(await result).toBe('Item1')
		p.dispose()
	})

	test('pwsh baseline', () => {
		const result = execSync('pwsh -c "echo hello"')
		expect(result.toString()).toMatch('hello')
	})
})
