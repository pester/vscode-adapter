import { execSync } from 'child_process'
import { finished, pipeline, Readable } from 'stream'
import { promisify } from 'util'
import { createJsonParseTransform, PowerShell, PSOutput } from './powershell'

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
		const result = await ps.exec<any>(`Get-Item .`)
		expect(result.PSIsContainer).toBe(true)
	})

	it('Get-Item Preload', async () => {
		const result = await ps.exec<any>(`Get-Item .`)
		expect(result.PSIsContainer).toBe(true)
	})

	/** Verify that if two commands are run at the same time, they queue and complete independently without interfering with each other */
	it('Parallel', async () => {
		const result = ps.exec<any>(`'Item1';sleep 0.05`)
		const result2 = ps.exec<any>(`'Item2'`)
		expect(await result2).toBe('Item2')
		expect(await result).toBe('Item1')
	})

	it('pwsh baseline', () => {
		const result = execSync('pwsh -nop -c "echo hello"')
		expect(result.toString()).toMatch('hello')
	})
})
