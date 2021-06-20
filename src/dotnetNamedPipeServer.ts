
import { createServer, Server } from 'net'
import { platform, tmpdir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'

/** Provides a simple client listener to a .NET named pipe. This is useful as a IPC method to child processes like a Powershell Script */
export class DotnetNamedPipeServer {
    private listener!: Server
    constructor(
        public name: string,
    ) {}

    /** Initialize a named pipe with the specified name. Returns a promise that completes when the server is ready */
    static async create(name: string) {
        const item = new DotnetNamedPipeServer(name)
        item.listener = createServer(stream => {
            const readLineClient = createInterface(stream)
            readLineClient.on("line", line => {
                // TODO: Wire back into json processor
                console.log(line)
            })
        })
        return item
    }

    async listen() {
        return new Promise<void>((resolve, reject) => {
            this.listener.listen(
                DotnetNamedPipeServer.getDotnetPipePath(this.name)
            )
            .once('listening', resolve)
            .once('error', reject);
        })
    }

    /** Takes the name of a pipe and translates it to the common location it would be found if created with that same
     * name using the .NET NamedPipeServer class. The path is different depending on the OS.
    */
    static getDotnetPipePath(pipeName: string) {
        if (platform() === "win32") {
            return "\\\\.\\pipe\\" + pipeName;
        } else {
            // Windows uses NamedPipes where non-Windows platforms use Unix Domain Sockets.
            // This requires connecting to the pipe file in different locations on Windows vs non-Windows.
            return join(tmpdir(), pipeName);
        }
    }
}