import { createStream } from 'byline'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { resolve } from 'path'
import { finished, pipeline, Readable, Transform, Writable } from 'stream'
import { promisify } from 'util'

// TODO: Use native promise API in NodeJS 16.x when it becomes avalable in vscode
const pipelineWithPromise = promisify(pipeline)
const isFinished = promisify(finished)

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

/** Streams for Powershell Output: https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_output_streams?view=powershell-7.1
 *
 * You can either extend this interface and use custom streams to handle the incoming objects, or use the default
 * implementation and subscribe to data events on the streams
 */
export interface IPSOutput {
	success: Readable
	error: Readable
	warning: Readable
	verbose: Readable
	debug: Readable
	information: Readable
	progress: Readable
}

/** A simple Readable that emits events when new objects are pushed from powershell.
 * read() does nothing and generally should not be called, you should subscribe to the events instead
 */
export function createPSReadableStream() {
	return new Readable({
		objectMode: true,
		read() {
			return
		}
	})
}

export class PSOutput implements IPSOutput {
	constructor(
		public success: Readable = createPSReadableStream(),
		public error: Readable = createPSReadableStream(),
		public warning: Readable = createPSReadableStream(),
		public verbose: Readable = createPSReadableStream(),
		public debug: Readable = createPSReadableStream(),
		public information: Readable = createPSReadableStream(),
		public progress: Readable = createPSReadableStream()
	) {}
}

/** An implementation of IPSOutput that takes all result objects and collects them to a single stream */
export class PSOutputUnified implements IPSOutput {
	constructor(
		public success: Readable = createPSReadableStream(),
		public error: Readable = success,
		public warning: Readable = success,
		public verbose: Readable = success,
		public debug: Readable = success,
		public information: Readable = success,
		public progress: Readable = success
	) {}
	read<T>() {
		return this.success.read() as T
	}
}

/** takes a unified stream of PS Objects and splits them into their appropriate streams */
export function createSplitPSOutputStream(streams: IPSOutput) {
	return new Writable({
		objectMode: true,
		write(chunk, _, done) {
			const record = chunk.value ?? chunk
			switch (chunk.__PSStream) {
				// Unless a stream is explicitly set, the default is to use the success stream
				case undefined:
					streams.success.push(chunk)
					break
				case 'Success':
					streams.success.push(chunk)
					break
				case 'Error':
					streams.error.push(record)
					break
				case 'Warning':
					streams.warning.push(record)
					break
				case 'Verbose':
					streams.verbose.push(record)
					break
				case 'Debug':
					streams.debug.push(record)
					break
				case 'Information':
					streams.information.push(record)
					break
				case 'Progress':
					streams.progress.push(record)
					break
				default:
					throw new Error(`Unknown PSStream Reported: ${chunk.__PSStream}`)
			}
			done()
		},
		final(done) {
			streams.success.destroy()
			streams.error.destroy()
			streams.warning.destroy()
			streams.verbose.destroy()
			streams.debug.destroy()
			streams.information.destroy()
			streams.progress.destroy()
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

	/** Run a PowerShell script asynchronously, result objects will arrive via the provided PSOutput streams
	 * the returned Promise will complete when the script has finished running
	 */
	async run(script: string, psOutput: IPSOutput) {
		if (this.currentInvocation) {
			await this.currentInvocation
		}
		const jsonResultStream = createStream(this.psProcess.stdout)
		const pipelineCompleted = pipelineWithPromise([
			jsonResultStream,
			createJsonParseTransform(),
			createSplitPSOutputStream(psOutput)
		])

		this.psProcess.stderr.once('data', (data: Buffer) => {
			const message: PSResult = JSON.parse(data.toString())
			if (message.finished) {
				jsonResultStream.end()
			} else {
				throw new Error(data.toString())
			}
		})

		const runnerScript = resolve(
			__dirname,
			'..',
			'Scripts',
			'powershellRunner.ps1'
		)
		this.currentInvocation = pipelineCompleted
		this.psProcess.stdin.write(`${runnerScript} {${script}}\n`)
		return pipelineCompleted
	}

	/** Runs a script and returns all objects generated by the script. This is a simplified interface to run */
	async exec<T>(script: string, successOutputOnly?: boolean) {
		const psOutput = successOutputOnly ? new PSOutputUnified() : new PSOutput()
		await this.run(script, psOutput)
		await isFinished(psOutput.success)
		return psOutput.success.read() as T
	}

	dispose() {
		this.psProcess.kill()
	}
}
