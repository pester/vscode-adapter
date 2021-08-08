import { createServer, Server } from 'net'
import { platform, tmpdir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { Disposable, EventEmitter } from 'vscode'

/** Provides a simple server listener to a .NET named pipe. This is useful as a IPC method to child processes like a Powershell Script */
export class DotnetNamedPipeServer implements Disposable {
	// We will use this emitter to notify any subscribers of new objects to process
	// TODO: Tighten up the types here
	// TODO: Optionally skip the json processing?
	// TODO: Make this not depend on vscode and use a general eventEmitter, then make an inherited class that is vscode specific
	private readonly _onDidReceiveObject = new EventEmitter<unknown>()
	get onDidReceiveObject() {
		return this._onDidReceiveObject.event
	}

	private readonly listener: Server
	constructor(
		public name: string = 'NodeNamedPipe-' + Math.random().toString(36)
	) {
		this.listener = createServer(stream => {
			const readLineClient = createInterface(stream)
			readLineClient.on('line', line => {
				const returnedObject = JSON.parse(line)
				this._onDidReceiveObject.fire(returnedObject)
			})
		})
	}

	async listen() {
		return new Promise<void>((resolve, reject) => {
			this.listener
				.listen(DotnetNamedPipeServer.getDotnetPipePath(this.name))
				.once('listening', resolve)
				.once('error', reject)
		})
	}

	/** Takes the name of a pipe and translates it to the common location it would be found if created with that same
	 * name using the .NET NamedPipeServer class. The path is different depending on the OS.
	 */
	static getDotnetPipePath(pipeName: string) {
		if (platform() === 'win32') {
			return '\\\\.\\pipe\\' + pipeName
		} else {
			// Windows uses NamedPipes where non-Windows platforms use Unix Domain Sockets.
			// This requires connecting to the pipe file in different locations on Windows vs non-Windows.
			return join(tmpdir(), pipeName)
		}
	}

	dispose() {
		this.listener.close()
	}
}
