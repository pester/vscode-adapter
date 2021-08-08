import { ILogObject, IStd, Logger, TTransportLogger } from 'tslog'

/** ASCII Section Break character */
// const delimiter = String.fromCharCode(31)

class DebugConsoleOutput implements IStd {
	private readonly buffer = new Array<string>()
	write(message: string) {
		// BUG: If a log sends a newline this will break, but the delimiters are currently inconsistent to be effective
		// https://github.com/fullstack-build/tslog/issues/115
		if (!message.endsWith('\n')) {
			this.buffer.push(message)
			return
		}

		this.buffer.push(message)
		const output = this.buffer.join('').replace(/\n$/, '')
		console.log(output)
		// Flush the buffer
		this.buffer.length = 0
	}
}

/**
 * Writes TSLog Pretty Print messages to the vscode debug console. It requires the logger during construction to import
 * its pretty print preferences
 *
 * @param {ILogObject} logger - Provide a {@link Logger} with custom pretty print formatting
 */
class DebugConsoleTransport
	implements TTransportLogger<(logObject: ILogObject) => void>
{
	private readonly debugConsoleOutput = new DebugConsoleOutput()
	// we need a new logger to control the pretty print format
	constructor(
		private readonly logger = new Logger({
			displayFilePath: 'hidden',
			dateTimeTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			dateTimePattern: 'hour:minute:second.millisecond'
		})
	) {}

	log(logObject: ILogObject): void {
		this.logger.printPrettyLog(this.debugConsoleOutput, logObject)
	}

	silly = this.log
	debug = this.log
	trace = this.log
	info = this.log
	warn = this.log
	error = this.log
	fatal = this.log
}

const log = new Logger()
log.attachTransport(new DebugConsoleTransport())
export default log
