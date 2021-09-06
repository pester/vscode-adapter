import { createStream } from 'byline'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { pipeline, Readable, Transform, Writable } from 'stream'
import { promisify } from 'util'

const pipelineWithPromise = promisify(pipeline)

/** Takes JSON string from the input stream and generates objects */
export function createJsonParseTransform() {
	return new Transform({
		objectMode: true,
		write(chunk: string, encoding: string, done) {
			this.push(JSON.parse(chunk))
			done()
		}
	})
}

/** Streams for Powershell Output: https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_output_streams?view=powershell-7.1 */
export interface PSOutputStreams {
	success: Readable
	error: Readable
	warning: Readable
	verbose: Readable
	debug: Readable
	information: Readable
	progress: Readable
}

/** takes a unified stream of PS Objects and splits them into their appropriate streams */
export function createSplitPSOutputStream(streams: PSOutputStreams) {
	return new Writable({
		objectMode: true,
		write(chunk, _, done) {
			switch (chunk.__PSStream) {
				case undefined:
					streams.success.push(chunk)
					break
				case 'Error':
					streams.error.push(chunk)
					break
				case 'Warning':
					streams.warning.push(chunk)
					break
				case 'Verbose':
					streams.verbose.push(chunk)
					break
				case 'Debug':
					streams.debug.push(chunk)
					break
				case 'Information':
					streams.information.push(chunk)
					break
				case 'Progress':
					streams.information.push(chunk)
					break
				default:
					throw new Error(`Unknown PSStream Reported: ${chunk.__PSStream}`)
			}
			done()
		}
	})
}

/** A message sent via stderr by the powerShellRunner to indicate script completion */
interface PSResult {
	finished: boolean
}

export class PowerShell {
	private readonly psProcess: ChildProcessWithoutNullStreams
	private currentInvocation: Promise<any> | undefined
	constructor(private exePath: string = 'pwsh') {
		this.psProcess = spawn(exePath, [
			'-NoProfile',
			'-NonInteractive',
			'-NoExit',
			'-Command',
			'-'
		])
		if (!this.psProcess.pid) {
			throw new Error(`Failed to start PowerShell process.`)
		}
	}

	/** Runs the specified powershell script and returns objects representing the results. Includes all streams.
	 * The promise will resolve when the script completes.
	 */
	async run<T>(script: string) {
		// We can only currently run one script at a time.
		if (this.currentInvocation) {
			await this.currentInvocation
		}
		const jsonResultStream = createStream(this.psProcess.stdout)
		const jsonParseTransform = createJsonParseTransform()
		const streams = new Array<NodeJS.ReadWriteStream | NodeJS.ReadableStream>(
			jsonResultStream,
			jsonParseTransform
		)

		this.psProcess.stderr.once('data', (data: Buffer) => {
			const message: PSResult = JSON.parse(data.toString())
			if (message.finished) {
				jsonResultStream.end()
			} else {
				throw new Error(data.toString())
			}
		})

		const pipelineCompleted = pipelineWithPromise(streams)
		const runnerScript = './Scripts/powershellRunner.ps1'
		this.currentInvocation = pipelineCompleted
		this.psProcess.stdin.write(`${runnerScript} {${script}}\n`)
		await pipelineCompleted
		return jsonParseTransform.read() as T
	}

	async stream(script: string, psOutputStreams: PSOutputStreams) {
		if (this.currentInvocation) {
			await this.currentInvocation
		}
		const jsonResultStream = createStream(this.psProcess.stdout)
		const jsonParseTransform = createJsonParseTransform()
		const streams = new Array<NodeJS.ReadWriteStream | NodeJS.ReadableStream>(
			jsonResultStream,
			jsonParseTransform
		)

		this.psProcess.stderr.once('data', (data: Buffer) => {
			const message: PSResult = JSON.parse(data.toString())
			if (message.finished) {
				jsonResultStream.end()
			} else {
				throw new Error(data.toString())
			}
		})

		const pipelineCompleted = pipelineWithPromise(
			jsonResultStream,
			jsonParseTransform,
			createSplitPSOutputStream(psOutputStreams)
		)
		const runnerScript = './Scripts/powershellRunner.ps1'
		this.currentInvocation = pipelineCompleted
		this.psProcess.stdin.write(`${runnerScript} {${script}}\n`)
		await pipelineCompleted
	}

	dispose() {
		this.psProcess.kill()
	}
}
