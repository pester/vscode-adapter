import { execSync } from 'child_process'
import { finished, pipeline, Readable } from 'stream'
import { promisify } from 'util'
import {
	createJsonParseTransform,
	PowerShell,
	PSOutput,
	PSOutputUnified
} from './powershell'

const pipelineWithPromise = promisify(pipeline)
const isFinished = promisify(finished)
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
	let ps: PowerShell
	beforeEach(() => {
		ps = new PowerShell()
	})
	afterEach(() => {
		ps.dispose()
	})
	it('success', done => {
		const streams = new PSOutput()
		streams.success.on('data', data => {
			expect(data).toBe('JEST')
			done()
		})
		ps.run(`'JEST'`, streams)
	})

	it('verbose', done => {
		const streams = new PSOutput()
		streams.verbose.on('data', data => {
			expect(data).toBe('JEST')
			done()
		})
		ps.run(`Write-Verbose -verbose 'JEST'`, streams)
	})

	it('cancel', done => {
		const streams = new PSOutputUnified()
		streams.success.on('close', () => {
			done()
		})
		ps.run(`'test';Start-Sleep -Seconds 2`, streams)
		ps.cancel()
	}, 2000)

	it('mixed', async () => {
		expect.assertions(3)
		const successResult = []
		const infoResult = []
		const streams = new PSOutput()
		streams.success
			.on('data', data => {
				successResult.push(data)
			})
			.on('close', () => {
				expect(successResult[0]).toBe('JEST')
			})
		streams.information
			.on('data', data => {
				infoResult.push(data)
			})
			.on('close', () => {
				expect(infoResult.length).toBe(32)
			})
		streams.error.on('data', data => {
			expect(data).toBe('oops!')
		})
		await ps.run(`1..32 | Write-Host;Write-Error 'oops!';'JEST';1..2`, streams)
	})
})

describe('exec', () => {
	let ps: PowerShell
	beforeEach(() => {
		ps = new PowerShell()
	})
	afterEach(() => {
		ps.dispose()
	})

	it('Get-Item', async () => {
		const result = await ps.exec(`Get-Item .`)
		expect(result[0].PSIsContainer).toBe(true)
	})

	/** Verify that if two commands are run at the same time, they queue and complete independently without interfering with each other */
	it('Parallel', async () => {
		const result = ps.exec(`'Item1';sleep 0.05`)
		const result2 = ps.exec(`'Item2'`)
		expect((await result2)[0]).toBe('Item2')
		expect((await result)[0]).toBe('Item1')
	})

	/** Verify that a terminating error is emitted within the context of an exec */
	it('TerminatingError', async () => {
		try {
			await ps.exec(`throw 'oops!'`)
		} catch (err) {
			expect(err.error).toBeInstanceOf(Error)
		}
	})

	/** If cancelExisting is used, ensure the first is closed quickly */
	it('CancelExisting', async () => {
		const result = ps.exec(`'Item';sleep 5;'ThisItemShouldNotEmit'`, true)
		await new Promise(r => setTimeout(r, 500))
		const result2 = ps.exec(`'Item'`, true)
		const awaitedResult = await result
		const awaitedResult2 = await result2
		// Any existing results should still be emitted after cancellation
		expect(awaitedResult).toEqual(['Item'])
		expect(awaitedResult2).toEqual(['Item'])
	})

	it('pwsh baseline', () => {
		const result = execSync('pwsh -nop -c "echo hello"')
		expect(result.toString()).toMatch('hello')
	})

	it('cancel', async () => {
		const result = ps.exec(`'Item1','Item2';sleep 2;'Item3'`)
		await new Promise(r => setTimeout(r, 1000))
		ps.cancel()
		const awaitedResult = await result
		expect(awaitedResult).toEqual(['Item1', 'Item2'])
	})
})
