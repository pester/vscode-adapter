import { createStream } from 'byline'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { lookpath } from 'lookpath'
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
			const obj = JSON.parse(chunk)
			this.push(obj)
			done()
		}
	})
}

/** Awaits the special finshed message object and ends the provided stream, which will gracefully end the pipeline after all
 * objects are processed */
export function watchForScriptFinishedMessage(streamToEnd: Writable) {
	return new Transform({
		objectMode: true,
		write(chunk: any, encoding: string, done) {
			// If special message
			if (chunk.__PSINVOCATIONID && chunk.finished === true) {
				streamToEnd.end()
			} else {
				this.push(chunk)
			}
			done()
		}
	})
}

/** Streams for PowerShell Output: https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_output_streams?view=powershell-7.1
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

/** Represents an instance of a PowerShell process. By default this will use pwsh if installed, and will fall back to PowerShell on Windows,
 * unless the exepath parameter is specified. Use the exePath parameter to specify specific powershell executables
 * such as pwsh-preview or a pwsh executable not located in the PATH
 */
export class PowerShell {
	private psProcess: ChildProcessWithoutNullStreams | undefined
	private currentInvocation: Promise<any> | undefined
	private resolvedExePath: string | undefined
	constructor(public exePath?: string) {}

	/** lazy-start a pwsh instance. If pwsh is not found but powershell is present, it will silently use that instead. */
	private async initialize() {
		if (this.psProcess === undefined) {
			const pathToResolve = this.exePath ?? 'pwsh'
			const path = await lookpath(pathToResolve)
			if (path !== undefined) {
				this.resolvedExePath = path
			} else if (process.platform === 'win32') {
				this.resolvedExePath = 'powershell'
			} else {
				throw new Error(
					'pwsh not found in your path and you are not on Windows so PowerShell 5.1 is not an option. Did you install PowerShell first?'
				)
			}
			this.psProcess = spawn(this.resolvedExePath, [
				'-NoProfile',
				'-NonInteractive',
				'-NoExit',
				'-Command',
				'-'
			])
			// Warn if we have more than one listener set on a process
			this.psProcess.stdout.setMaxListeners(2)
			this.psProcess.stderr.setMaxListeners(1)
			// TODO: More robust stderr handling
			this.psProcess.stderr.once('data', (data: Buffer) => {
				throw new Error(
					`Error Received on stderr from pwsh: ` + data.toString()
				)
			})

			if (!this.psProcess.pid) {
				throw new Error(`Failed to start PowerShell process.`)
			}
		}
	}

	/** Similar to {@link run} but doesn't execute anything, rather listens on a particular stream for JSON objects to arrive */
	async listen(psOutput: IPSOutput, inputStream?: Readable) {
		await this.run('', psOutput, inputStream)
	}

	/** Run a PowerShell script asynchronously, result objects will arrive via the provided PSOutput streams
	 * the returned Promise will complete when the script has finished running
	 * @param inputStream
	 * Specify a Readable (such as a named pipe stream) that supplies single-line JSON objects from a PowerShell execution.
	 * If script is null then it will simply listen and process objects incoming on the stream until it closes
	 */
	async run(script: string, psOutput: IPSOutput, inputStream?: Readable) {
		await this.initialize()
		if (this.psProcess === undefined) {
			throw new Error('PowerShell initialization failed')
		}
		// We only run one command at a time for now
		// TODO: Use a runspace pool and tag each invocation with a unique ID
		if (this.currentInvocation) {
			await this.currentInvocation
		}
		const jsonResultStream = createStream(inputStream ?? this.psProcess.stdout)
		const pipelineCompleted = pipelineWithPromise([
			jsonResultStream,
			createJsonParseTransform(),
			watchForScriptFinishedMessage(jsonResultStream),
			createSplitPSOutputStream(psOutput)
		])

		const runnerScriptPath = resolve(
			__dirname,
			'..',
			'Scripts',
			'powershellRunner.ps1'
		)
		this.currentInvocation = pipelineCompleted

		if (!inputStream) {
			const fullScript = `${runnerScriptPath} {${script}}\n`
			this.psProcess.stdin.write(fullScript)
		}

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
		if (this.psProcess !== undefined) {
			this.psProcess.kill()
		}
	}
}
