import { createStream } from 'byline'
import { PassThrough, pipeline, Writable } from 'stream'
import { ILogObject, Logger, TTransportLogger } from 'tslog'
import { promisify } from 'util'
import { OutputChannel, window } from 'vscode'

const pipelineAsPromise = promisify(pipeline)

/**
 * Writes TSLog Pretty Print messages to the supplied stream
 *
 * @class PrettyPrintTransport
 * @param outStream Provide a writable stream that the pretty print log messages will be emitted to
 * @param colorize Whether ANSI formatting characters should be included in the output
 */
class PrettyPrintTransport
	implements TTransportLogger<(logObject: ILogObject) => void>
{
	readonly prettyLogInput = new PassThrough()
	readonly logger: Logger
	constructor(outStream: Writable, colorize = false) {
		// we need a new "internal" logger to control the pretty print formatting since printPrettyLog isn't a static method
		this.logger = new Logger({
			colorizePrettyLogs: colorize,
			displayFilePath: 'hidden',
			dateTimeTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			dateTimePattern: 'hour:minute:second.millisecond'
		})

		pipelineAsPromise(
			this.prettyLogInput,
			createStream(), //Breaks the stream into new lines
			outStream
		).catch(err => {
			throw new Error(err)
		})
	}
	log(logObject: ILogObject): void {
		this.logger.printPrettyLog(this.prettyLogInput, logObject)
	}

	silly = this.log
	debug = this.log
	trace = this.log
	info = this.log
	warn = this.log
	error = this.log
	fatal = this.log
}

class VSCodeOutputChannelStream extends Writable {
	private outputChannel: OutputChannel
	constructor(title: string, public appendLine: boolean = false) {
		super()
		this.outputChannel = window.createOutputChannel(title)
	}
	_write(chunk: Buffer, encoding: string, callback: () => any) {
		this.appendLine
			? this.outputChannel.appendLine(chunk.toString())
			: this.outputChannel.append(chunk.toString())
		callback()
	}
}
export class VSCodeOutputChannelTransport extends PrettyPrintTransport {
	constructor(title: string) {
		super(new VSCodeOutputChannelStream(title, true))
	}
}

export class ConsoleLogTransport extends PrettyPrintTransport {
	constructor() {
		super(
			new Writable({
				write: (chunk: Buffer, encoding: string, callback: () => any) => {
					console.log(chunk.toString())
					callback()
				}
			})
		)
	}
}

/** A global logger using tslog to use within the extension. You must attach transports to enable logging
* Logging Examples:
* Log to nodejs console when debugging

if (process.env.VSCODE_DEBUG_MODE === 'true') {
	log.attachTransport(new ConsoleLogTransport())
}

Log to vscode output channel

log.attachTransport(new VSCodeOutputChannelTransport('Pester'))
 */
const log = new Logger({ type: 'hidden' })
export default log
