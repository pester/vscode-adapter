
import { Logger, ILogObj } from 'tslog'
import { ILogObjMeta } from 'tslog/dist/types/BaseLogger'
import { LogOutputChannel, window } from 'vscode'

interface DefaultLog extends ILogObj {
	args: unknown[]
}

/** Represents the default TS Log levels. This is not explicitly provided by tslog */
type DefaultTSLogLevel =
	"SILLY"
	| "TRACE"
	| "DEBUG"
	| "INFO"
	| "WARN"
	| "ERROR"
	| "FATAL"

export class VSCodeLogOutputChannelTransport {
	/** Used to ensure multiple registered transports that request the same name use the same output window. NOTE: You can still get duplicate windows if you register channels outside this transport */
	private static readonly channels = new Map<string, LogOutputChannel>()
	private readonly name: string
	constructor(name: string) {
		this.name = name
	}

	get channel() {
		const newChannel = VSCodeLogOutputChannelTransport.channels.has(this.name)
			? VSCodeLogOutputChannelTransport.channels.get(this.name)
			: (
				VSCodeLogOutputChannelTransport.channels
					.set(this.name, window.createOutputChannel(this.name, { log: true }))
					.get(this.name)
			)
		if (newChannel === undefined) {
			throw new Error("Failed to create output channel. This is a bug and should never happen.")
		}
		return newChannel
	}

	/** Wire this up to Logger.AttachTransport
	 *
	 * @example
	 * ```
	 * logger.attachTransport((new VSCodeLogOutputChannelTransport('myExtensionName')).transport)
	 * ```
	 */
	public transport = <T extends DefaultLog & ILogObjMeta>(log: T) => {
		const message = typeof log.args[0] === "string"
			? log.args[0]
			: JSON.stringify(log.args[0])
		const args = log.args.slice(1)
		switch (log._meta.logLevelName as DefaultTSLogLevel) {
			case 'SILLY': this.channel.trace(message, ...args); break
			case 'TRACE': this.channel.trace(message, ...args); break
			case 'DEBUG': this.channel.debug(message, ...args); break
			case 'INFO': this.channel.info(message, ...args); break
			case 'WARN': this.channel.warn(message, ...args); break
			case 'ERROR': this.channel.error(message, ...args); break
			case 'FATAL': this.channel.error(message, ...args); break
			default: throw new Error(`Unknown log level: ${log._meta.logLevelName}`)
		}
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
const log = new Logger<DefaultLog>({
	name: 'default',
	type: 'pretty',
	prettyErrorLoggerNameDelimiter: "-",
	prettyErrorParentNamesSeparator: "-",
	stylePrettyLogs: true,
	argumentsArrayName: "args",
	overwrite: {
		transportFormatted: () => { return } 		// We want pretty formatting but no default output
	}
})

export default log
