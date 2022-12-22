import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { lookpath } from 'lookpath'
import { resolve } from 'path'
import { Readable, Transform, Writable } from 'stream'
import { pipeline, finished } from 'stream/promises'
import ReadlineTransform from 'readline-transform'

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

/** Takes JSON string from the input stream and generates objects. Is exported for testing purposes */
export function createJsonParseTransform() {
	return new Transform({
		objectMode: true,
		transform(chunk: string, encoding: string, done) {
			const obj = JSON.parse(chunk)
			this.push(obj)
			done()
		}
	})
}

/** Awaits the special finshed message object and ends the provided stream, which will gracefully end the upstream pipeline after all
 * objects are processed.
 * We have to gracefully end the upstream pipeline so as not to generate errors. If we do this.end() it wont
 * work because the upstream pipe is still open. If we do this.destroy() it wont work without handling an error
 * And the pipeline promise will not resolve.
 * More: https://nodejs.org/es/docs/guides/backpressuring-in-streams/#lifecycle-of-pipe
 * */
function createWatchForScriptFinishedMessageTransform(streamToEnd: Writable) {
	return new Transform({
		objectMode: true,
		transform(chunk: any, encoding: string, done) {
			// If special message from PowerShell Invocation Script
			// TODO: Handle this as a class?
			if (chunk.__PSINVOCATIONID && chunk.finished === true) {
				streamToEnd.end()
			} else {
				this.push(chunk)
			}
			done()
		}
	})
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
 * @param exePath The path to the powershell executable to use. If not specified, the default will be used.
 * @param cwd The current working directory of the process. All paths will be relative to this. Defaults to the folder where pwsh.exe resides.
 */
export class PowerShell {
	psProcess: ChildProcessWithoutNullStreams | undefined
	private currentInvocation: Promise<void> | undefined
	private resolvedExePath: string | undefined
	constructor(public exePath?: string, public cwd?: string) {}

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
			this.psProcess = spawn(
				this.resolvedExePath,
				['-NoProfile', '-NonInteractive', '-NoExit', '-Command', '-'],
				{ cwd: this.cwd }
			)
			// Warn if we have more than one listener set on a process
			this.psProcess.stdout.setMaxListeners(1)
			this.psProcess.stderr.setMaxListeners(1)

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
	 * If not specified, it will read stdout from a new powershell process.
	 * @param script
	 * The PowerShell script to run
	 * If script is null then it will simply listen and process objects incoming on the stream until it closes
	 */
	async run(
		script: string,
		psOutput: IPSOutput,
		inputStream?: Readable,
		cancelExisting?: boolean,
		useNewProcess?: boolean
	) {
		if (useNewProcess) {
			this.reset()
		}

		// We only run one command at a time for now
		// TODO: Use a runspace pool and tag each invocation with a unique ID
		if (this.currentInvocation) {
			if (cancelExisting) {
				this.cancel()
			} else await this.currentInvocation
		}

		await this.initialize()
		if (this.psProcess === undefined) {
			throw new Error('PowerShell initialization failed')
		}
		// If an input stream wasn't specified, use stdout by default. This will be the most common path.
		inputStream ??= this.psProcess.stdout

		// FIXME: There should only be one end listener from the readlineTransform pipe, currently there are two, why?
		inputStream.setMaxListeners(2)

		// Wire up a listener for terminating errors that will reject a promise we will race with the normal operation
		// TODO: RemoveAllListeners should be more specific
		this.psProcess.stderr.removeAllListeners()
		const errorWasEmitted = new Promise((_, reject) => {
			// Read error output one line at a time
			function handleError(jsonSerializedError: string) {
				reject({
					error: new Error(
						'A terminating error occured while running the script'
					),
					errorObject: JSON.parse(jsonSerializedError)
				})
			}

			if (this.psProcess !== undefined) {
				const errorStream = this.psProcess.stderr.pipe(
					new ReadlineTransform({ skipEmpty: false })
				)
				errorStream.once('data', handleError)
			}
		})

		// We dont want inputStream to be part of our promise pipeline because we want it to stay open to be resused
		// And the promise won't resolve if it stays open and is part of the pipeline
		const readlineTransform = inputStream.pipe(
			new ReadlineTransform({ skipEmpty: false })
		)

		// Workaround for https://github.com/nodejs/node/issues/40191
		const pipelineCompleted = pipeline<
			ReadlineTransform,
			Transform,
			Transform,
			Writable
		>(
			readlineTransform,
			createJsonParseTransform(),
			createWatchForScriptFinishedMessageTransform(readlineTransform),
			createSplitPSOutputStream(psOutput)
		)

		const runnerScriptPath = resolve(
			__dirname,
			'..',
			'Scripts',
			'powershellRunner.ps1'
		)
		// Start the script, the output will be processed by the above events
		if (script) {
			const fullScript = `${runnerScriptPath} {${script}}\n`
			this.psProcess.stdin.write(fullScript)
		}

		// Either the script completes or a terminating error occured
		this.currentInvocation = Promise.race([
			pipelineCompleted,
			errorWasEmitted
		]).then(() => {
			// Reset the current invocation status
			this.currentInvocation = undefined
		})

		// Indicate the result is complete
		return this.currentInvocation
	}

	/** Runs a script and returns all objects generated by the script. This is a simplified interface to run */
	async exec(script: string, cancelExisting?: boolean) {
		const psOutput = new PSOutputUnified()
		await this.run(script, psOutput, undefined, cancelExisting)
		await finished(psOutput.success)
		const result: Record<string, unknown>[] = []
		for (;;) {
			const output = psOutput.success.read() as Record<string, unknown>
			if (output === null) {
				break
			}
			result.push(output)
		}
		return result
	}

	/** Cancel an existing pipeline in progress by emitting a finished object and then killing the process */
	cancel() {
		if (this.psProcess !== undefined) {
			this.psProcess?.stdout.push(
				'{"__PSINVOCATIONID": "CANCELLED", "finished": true}'
			)
		}
		this.reset()
	}

	/** Kill any existing invocations and reset the state */
	reset(): boolean {
		let result = false
		if (this.psProcess !== undefined) {
			// We use SIGKILL to keep the behavior consistent between Windows and Linux (die immediately)
			this.psProcess.kill('SIGKILL')
			result = true
		}
		// Initialize will reinstate the process upon next call
		this.psProcess = undefined
		return result
	}

	dispose() {
		this.reset()
	}
}
