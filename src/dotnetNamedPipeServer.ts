import { createServer, type Server, type Socket } from 'net'
import { platform, tmpdir } from 'os'
import { join } from 'path'
import { type Disposable } from 'vscode'

/** Provides a simple server listener to a .NET named pipe. This is useful as a IPC method to child processes like a PowerShell Script */
export class DotnetNamedPipeServer implements Disposable {
	private readonly server: Server
	constructor(
		public name: string = 'NodeNamedPipe-' + Math.random().toString(36)
	) {
		this.server = createServer()
	}

	/** Starts the server listening on the specified named pipe */
	async listen() {
		return new Promise<void>((resolve, reject) => {
			this.server
				.listen(DotnetNamedPipeServer.getDotnetPipePath(this.name))
				.once('listening', resolve)
				.once('error', reject)
		})
	}

	/** Will return a socket once a connection is provided. WARNING: If you set multiple listeners they will all get the
	 * same socket, it is not sequential
	 */
	async waitForConnection() {
		if (!this.server.listening) {
			await this.listen()
		}
		return new Promise<Socket>((resolve, reject) => {
			this.server.once('connection', resolve)
			this.server.once('error', reject)
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
			return join(tmpdir(), `CoreFxPipe_${pipeName}`)
		}
	}

	dispose() {
		this.server.close()
	}
}
