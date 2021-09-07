import { execSync } from 'child_process'
import { pipeline, Readable } from 'stream'
import { promisify } from 'util'
import { createJsonParseTransform, PowerShell, PSOutput } from './powershell'

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
	it('success', done => {
		const streams = new PSOutput()
		const p = new PowerShell()
		streams.success.on('data', data => {
			expect(data).toBe('JEST')
			p.dispose()
			done()
		})
		p.run(`'JEST'`, streams)
	})

	it('verbose', done => {
		const streams = new PSOutput()
		const p = new PowerShell()
		streams.verbose.on('data', data => {
			expect(data.Message).toBe('JEST')
			p.dispose()
			done()
		})
		p.run(`Write-Verbose -verbose 'JEST'`, streams)
	})
})

describe('exec', () => {
	it('Get-Item', async () => {
		const p = new PowerShell()
		const result = await p.exec<any>(`Get-Item .`)
		expect(result.PSIsContainer).toBe(true)
		p.dispose()
	})

	it('Get-Item Preload', async () => {
		const p = new PowerShell()
		const result = await p.exec<any>(`Get-Item .`)
		expect(result.PSIsContainer).toBe(true)
		p.dispose()
	})

	/** Verify that if two commands are run at the same time, they queue and complete independently without interfering with each other */
	it('Parallel', async () => {
		const p = new PowerShell()
		const result = p.exec<any>(`'Item1';sleep 0.05`)
		const result2 = p.exec<any>(`'Item2'`)
		expect(await result2).toBe('Item2')
		expect(await result).toBe('Item1')
		p.dispose()
	})

	it('pwsh baseline', () => {
		const result = execSync('pwsh -c "echo hello"')
		expect(result.toString()).toMatch('hello')
	})
})
