import { execSync } from 'child_process'
import ReadlineTransform from 'readline-transform'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import {
	createJsonParseTransform,
	PowerShell,
	PSOutput,
	defaultPowershellExePath,
	PowerShellError
} from './powershell'
import { expect } from 'chai'

describe('jsonParseTransform', () => {
	interface TestObject {
		Test: number
	}

	it('object', async () => {
		const source = Readable.from(['{"Test": 5}'])
		const jsonPipe = createJsonParseTransform()
		await pipeline(source, jsonPipe)
		const result = jsonPipe.read() as TestObject
		expect(result.Test).to.equal(5)
	})

	it('empty', async () => {
		const source = Readable.from(['']).pipe(
			new ReadlineTransform({ skipEmpty: false })
		)
		const jsonPipe = createJsonParseTransform()

		try {
			await pipeline(source, jsonPipe)
		} catch (err) {
			const result = err as Error
			expect(result.message).to.match(/Unexpected end/)
		}
	})

	it('syntaxError', async () => {
		const source = Readable.from(['"Test":5}']).pipe(
			new ReadlineTransform({ skipEmpty: false })
		)
		const jsonPipe = createJsonParseTransform()

		try {
			await pipeline(source, jsonPipe)
		} catch (err) {
			const result = err as Error
			expect(result.message).to.match(/Unexpected token :/)
		}
	})
})

describe('run', function () {
	this.slow(2500)
	let ps: PowerShell
	beforeEach(() => {
		ps = new PowerShell()
	})
	afterEach(() => {
		ps.dispose()
	})
	it('finished', async () => {
		const streams = new PSOutput()
		await ps.run(`'JEST'`, streams)
		// This test times out if it doesn't execute successfully
	})
	it('success', done => {
		const streams = new PSOutput()
		streams.success.on('data', data => {
			expect(data).to.equal('JEST')
			done()
		})
		void ps.run(`'JEST'`, streams)
	})

	it('verbose', done => {
		const streams = new PSOutput()
		streams.verbose.on('data', data => {
			expect(data).to.equal('JEST')
			done()
		})
		void ps.run(`Write-Verbose -verbose 'JEST'`, streams)
	})

	it('mixed', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const successResult: any[] = []
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const infoResult: any[] = []
		const streams = new PSOutput()
		streams.success
			.on('data', data => {
				successResult.push(data)
			})
			.on('close', () => {
				expect(successResult[0]).to.equal('JEST')
			})
		streams.information
			.on('data', data => {
				infoResult.push(data)
			})
			.on('close', () => {
				expect(infoResult.length).to.equal(32)
			})
		streams.error.on('data', data => {
			expect(data).to.equal('oops!')
		})

		await ps.run(`1..32 | Write-Host;Write-Error 'oops!';'JEST';1..2`, streams)
	})
})

describe('exec', function () {
	this.slow(2500)
	let ps: PowerShell
	beforeEach(() => {
		ps = new PowerShell()
	})
	afterEach(() => {
		ps.dispose()
	})

	it('Get-Item', async () => {
		const result = await ps.exec(`Get-Item .`)

		expect(result[0].PSIsContainer).to.be.true
	})

	/** Verify that if two commands are run at the same time, they queue and complete independently without interfering with each other */
	it('Parallel', async () => {
		const result = ps.exec(`'Item1';sleep 0.05`)
		const result2 = ps.exec(`'Item2'`)

		expect((await result2)[0]).to.equal('Item2')
		expect((await result)[0]).to.equal('Item1')
	})

	/** Verify that a terminating error is emitted within the context of an exec */
	it('TerminatingError', async () => {
		try {
			await ps.exec(`throw 'oops!'`)
		} catch (err) {
			expect(err).to.be.instanceOf(PowerShellError)
		}
	})

	/** If cancelExisting is used, ensure the first is closed quickly */
	it('CancelExisting', async () => {
		const result = ps.exec(`'Item';sleep 5;'ThisItemShouldNotEmit'`, true)
		// FIXME: This is a race condition on slower machines that makes this test fail intermittently
		// If Item hasn't been emitted yet from the pipeline
		// This should instead watch for Item and then cancel existing once received
		await new Promise(resolve => setTimeout(resolve, 600))
		const result2 = ps.exec(`'Item'`, true)
		const awaitedResult = await result
		const awaitedResult2 = await result2

		// Any existing results should still be emitted after cancellation
		expect(awaitedResult).to.be.an('array').that.includes('Item')
		expect(awaitedResult2).to.be.an('array').that.includes('Item')
	})

	it('pwsh baseline', () => {
		const result = execSync(`${defaultPowershellExePath} -nop -c "echo hello"`)

		expect(result.toString()).to.match(/hello/)
	})

	// TODO: Add a hook so that a cancel can be run without this test being performance-dependent. Currently this test is flaky depending on how fast the machine is
	it('cancel', async () => {
		const result = ps.exec(`'Item1','Item2';sleep 2;'Item3'`)
		await new Promise(resolve => setTimeout(resolve, 1000))
		ps.cancel()
		const awaitedResult = await result

		expect(awaitedResult)
			.to.be.an('array')
			.that.includes('Item1')
			.and.includes('Item2')
			.but.does.not.include('Item3')
	})
})
