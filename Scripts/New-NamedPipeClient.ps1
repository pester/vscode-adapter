#Stolen and modified with love from: https://www.powershellgallery.com/packages/PSNamedPipe/1.0.0.19/Content/Public%5CNew-PSNamedPipeServer.ps1
using namespace System.IO.Pipes
using namespace System.IO

function New-PSNamedPipeClient {
    [CmdletBinding()]
    Param (
        # Param1 help description
        [Parameter(ValueFromPipelineByPropertyName)]
        [string]$Name = 'testPipe',

        # Param2 help description
        [Parameter(ValueFromPipelineByPropertyName)]
        [string]$ComputerName = '.',

        # Param3 help description
        [ValidateSet("In", "Out", "InOut")]
        [string]$Direction = 'InOut',

        [int]
        $MaxInstances = 1,

        [ValidateSet("Byte", "Message")]
        $Mode = 'Byte'
    )

    try {
        $pipeServer = [NamedPipeClientStream]::new('testPipe')
            # $Name, $Direction, $MaxInstances, $Mode
        # )
    }
    catch {
        Write-Error -ErrorRecord $Error[0]
    }

    Write-Debug -Message 'Waiting for connection to NamedPipe server'
    $pipeServer.Connect()

    # Write data to the pipe, to be read by the client.
    $writer = [StreamWriter]::new($pipeServer)
    $writer.AutoFlush = $true   #Flush buffer to stream after every Write().
    $writer.WriteLine('{"Test" = "Test"}')
    $writer.WriteLine('{"Test" = "Test"}')
    $writer.WriteLine('{"Test2" = "Test2"}')
    # Now remove the named pipe and clean up.
    $pipeServer.Close()
}