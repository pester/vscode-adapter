import NodePowershell = require('node-powershell');
import { randomBytes } from 'crypto'
import { DotnetNamedPipeServer } from './dotnetNamedPipeServer'


/** Represents the return result of a powershell script */
export class PowershellRunnerResult {
    constructor(
        public result?: Object[],
        public output?: string,
        public err?: string
    ) {}
}


/** Invokes a powershell script and provides the object outputs as JSON serialized objects */
export class PowerShellRunner {
    private constructor(
        private readonly shell = new NodePowershell({
            noProfile: true,
        }),
        private readonly pipeName = "nodePSRunner-" + randomBytes(21)
            .toString('base64')
            .slice(0, 10)
            .replace('[^A-Za-z0-9]',''),
        private readonly replyServerPromise = DotnetNamedPipeServer.create(pipeName),
        // It would be nice if we could use a file descriptor like fd3, doesn't appear possible in dotnet yet though: https://github.com/dotnet/runtime/issues/26559
        private replyServer: DotnetNamedPipeServer | undefined = undefined
    ){}

    /**
     * Initializes a new Powershell Runner that uses NodePowershell on the backend to run requests to a shared powershell instance
     * We do this to save memory on spawning a new pwsh process on every command, this should be faster
     *
     * @param psExePath - Path to the Powershell Executable to use for the runner. This is typically supplied from the PowerShellExtensionClient
     */
    static async create(psExePath:string) {
        // NPS environment variable is used as a workaround to specify which powershell to use since node-powershell doesn't provide a constructor
        process.env.NPS = psExePath
        const item = new PowerShellRunner()
        // TODO: Refactor this into a getter
        item.replyServer = await item.replyServerPromise
        await item.replyServer.listen()
        console.log(`Powershell runner listening on pipe ${item.pipeName}`)
        return item
    }

    /** Executes a Powershell Command and returns the output as objects */
    // TODO: Allow for a handler to handle the returned objects
    async execPwshCommand(command: string, args?: string[]) {
        const result = new Array<Object>()
        // The script will reply with objects to this pipe output. This is sort of like adding another stdout fd.
        // TODO: Move the pipe handling into this rather than require to script to implement it
        let receiveObjectEventHandler = this.replyServer!.onDidReceiveObject(
            returnObject => result.push(returnObject)
        )

        await this.shell.addCommand(command)
        if (args) {
            for (let arg of args) {
                await this.shell.addArgument(arg)
            }
        }
        await this.shell.addParameter({PipeName: this.pipeName})

        try {
            const output = await this.shell.invoke()
            if (output) {console.log("Pwsh Host Output: " + output)}
            receiveObjectEventHandler.dispose()
            return new PowershellRunnerResult(
                result,
                output,
                undefined
            )

        } catch (err) {
            // TODO: VSCode Error
            console.log(err)
            receiveObjectEventHandler.dispose()
            return new PowershellRunnerResult(
                undefined,
                undefined,
                err
            )
        }
    }

    /** Executes a Powershell Script and returns the script output as a string */
    async execPwshScriptFile(path: string, args?: string[]) {
        return this.execPwshCommand(`. ${path}`, args)
    }
    //
    // public async ExecPwshScriptFile(
    //     scriptFilePath: string,
    //     args?: string[],
    //     exePath?: string,
    //     workingDirectory?: string
    // ) {
    //     exePath ??= await this.fetchPowerShellExePath()

    //     const exeArgs = [
    //         '-NonInteractive',
    //         '-NoLogo',
    //         '-NoProfile',
    //         '-File',
    //         scriptFilePath
    //     ]
    //     if (args != undefined) {
    //         exeArgs.push(...args)
    //     }

    //     const execFileAsync = promisify(execFile)
    //     let options: ExecFileOptionsWithStringEncoding = { encoding: 'utf8'}
    //     if (workingDirectory) {options.cwd = workingDirectory}
    //     const psResult = await execFileAsync(exePath,exeArgs,options)

    //     return psResult.stdout
    // }

    // /** Executes a Powershell Script and streams the result. This is different from {@link PowershellRunner.ExecPwshScriptFile} as it allows results to be processed in real time */
    // public async InvokePwshScript(scriptPath: string = "$PWD", exePath?: string) : Promise<String> {
    //     if (!exePath) {
    //         exePath = await this.fetchPowerShellExePath();
    //     }
    //     const pwshExeArgs = [
    //         '-NonInteractive',
    //         '-NoLogo',
    //         '-NoProfile',
    //         '-Command', scriptPath
    //     ]
    //     const pwshRun = spawn(exePath, pwshExeArgs, {});

    //     let stdOutData: string = ""

    //     pwshRun.on('data', (data: Buffer) => {
    //         // this.log.debug(`stdout: ${data}`);
    //         stdOutData += data;
    //     });

    //     pwshRun.stderr.on('data', (data) => {
    //         const err: string = data.toString();
    //         // this.log.error(`stderr: ${err}`);
    //         if (err.includes("no valid module file")) {
    //             vscode.window.showErrorMessage("Pester version '5.0.0' or higher was not found in any module directory. Make sure you have Pester v5+ installed: Install-Module Pester -MinimumVersion 5.0")
    //         }
    //     });

    //     pwshRun.on('close', (code: number) => {
    //         console.log(`Exit code ${code}`)
    //         return stdOutData
    //     })

    //     return stdOutData
    // }
}
