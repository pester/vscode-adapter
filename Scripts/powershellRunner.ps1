#requires -version 5.1
using namespace System.Collections
using namespace System.Collections.Generic
using namespace System.Diagnostics
using namespace System.Management.Automation
using namespace System.Management.Automation.Runspaces
param(
	#The scriptblock to run
	[ScriptBlock]$ScriptBlock,
	#We typically emit simple messages for verbose/warning/debug streams. Specify this to get a full record object.
	[Switch]$FullMessages,
	#How many levels of an object to return, anything beyond this depth will attempt to be stringified instead. This can have serious performance implications.
	[int]$Depth = 1,
	#How often to check for script completion, in seconds. You should only need to maybe increase this if there is an averse performance impact.
	[double]$sleepInterval = 0.05,
	#Safety timeout in seconds. This avoids infinite loops. Increase for very long running scripts.
	[int]$timeout = 3600
)
Set-StrictMode -Version 3
[Console]::OutputEncoding = [Text.Encoding]::UTF8
#This is required to ensure dates get ISO8601 formatted during json serialization
Get-TypeData System.DateTime | Remove-TypeData


# $ScriptBlock = [ScriptBlock]::Create($script)
$psInstance = [powershell]::Create()
[void]$psInstance.AddScript($ScriptBlock)
$psInstance.Commands[0].Commands[0].MergeMyResults([PipeLineResultTypes]::All, [PipeLineResultTypes]::Output)
$psInput = [PSDataCollection[Object]]::new()
$psOutput = [PSDataCollection[Object]]::new()


function Add-StreamIdentifier ($inputObject) {
	switch ($true) {
		($inputObject -is [DebugRecord]) {
			Add-Member -InputObject $inputObject -NotePropertyName '__PSStream' -NotePropertyValue 'Debug'
			break
		}
		($inputObject -is [VerboseRecord]) {
			Add-Member -InputObject $inputObject -NotePropertyName '__PSStream' -NotePropertyValue 'Verbose'
			break
		}
		($inputObject -is [WarningRecord]) {
			Add-Member -InputObject $inputObject -NotePropertyName '__PSStream' -NotePropertyValue 'Warning'
			break
		}
		($inputObject -is [ErrorRecord]) {
			Add-Member -InputObject $inputObject -NotePropertyName '__PSStream' -NotePropertyValue 'Error'
			break
		}
		($inputObject -is [ProgressRecord]) {
			Add-Member -InputObject $inputObject -NotePropertyName '__PSStream' -NotePropertyValue 'Progress'
			break
		}
	}
}

function Test-IsPrimitive ($InputObject) {
	($InputObject.gettype().IsPrimitive -or $InputObject -is [string] -or $InputObject -is [datetime])
}

function Add-TypeIdentifier ($InputObject) {
	[string]$typeName = if ($InputObject -is [PSCustomObject]) {
		$InputObject.pstypenames[0]
	} else {
		$InputObject.GetType().FullName
	}
	Add-Member -InputObject $InputObject -NotePropertyName '__PSType' -NotePropertyValue $typeName
}

function Out-JsonToStdOut {
	[CmdletBinding()]
	param(
		[Parameter(ValueFromPipeline)]$InputObject,
		[int]$Depth
	)
	process {
		if (!(Test-IsPrimitive $InputObject)) {
			Add-TypeIdentifier $inputObject
		}
		Add-StreamIdentifier $inputObject
		$json = ConvertTo-Json -InputObject $InputObject -Compress -Depth $Depth -WarningAction SilentlyContinue
		[Console]::WriteLine($json)
	}
}

# InvokeAsync doesn't exist in 5.1
$psStatus = $psInstance.BeginInvoke($psInput, $psOutput)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
# $psOutput while enumerating will block the pipeline while waiting for a new item, and will release when script is finished.
$psOutput | Out-JsonToStdOut -Depth $Depth
$psInstance.EndInvoke($psStatus)

#Special event object to indicate the script is complete and the reader pipe can be closed.
[Console]::Error.Write('{"finished": true}')
