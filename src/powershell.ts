import { createStream } from 'byline'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { pipeline, Transform } from 'stream'
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

	dispose() {
		this.psProcess.kill()
	}
}
