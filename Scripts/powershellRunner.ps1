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
	[int]$timeout = 3600,
	#Include ANSI characters in the output. This is only supported on 7.2 or above.
	[Switch]$IncludeAnsi,
	#Do not reuse a previously found session, useful for pester tests or environments that leave a dirty state.
	[Switch]$NoSessionReuse,
	#Specify an invocation ID to track individual invocations. This will be supplied in the finish message.
	[string]$Id = (New-Guid)
)
Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

#This is required to ensure dates get ISO8601 formatted during json serialization
Get-TypeData System.DateTime | Remove-TypeData

if ($psversiontable.psversion -ge '7.2.0') {
	if ($IncludeAnsi) {
		$PSStyle.OutputRendering = 'ANSI'
	} else {
		$PSStyle.OutputRendering = 'PlainText'
	}
}
# $ScriptBlock = [ScriptBlock]::Create($script)
[PowerShell]$psinstance = if (!$NoSessionReuse -and (Test-Path Variable:__NODEPSINSTANCE)) {
	$GLOBAL:__NODEPSINSTANCE
} else {
	[powershell]::Create()
}

[void]$psInstance.AddScript($ScriptBlock)
$psInstance.Commands[0].Commands[0].MergeMyResults([PipeLineResultTypes]::All, [PipeLineResultTypes]::Output)
$psInput = [PSDataCollection[Object]]::new()
$psOutput = [PSDataCollection[Object]]::new()



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

function Add-StreamIdentifier ($inputObject) {
	$streamObjectTypes = @(
		[DebugRecord],
		[VerboseRecord],
		[WarningRecord],
		[ErrorRecord],
		[InformationRecord],
		[ProgressRecord]
	)
	if ($inputObject.gettype() -in $StreamObjectTypes) {
		# Generate 'simple' records for these types by converting them to strings
		# The record types know how to adjust their messaging accordingly
		$streamName = $inputObject.getType().Name -replace 'Record$', ''
		if (!$FullMessages) {
			# The pscustomobject is required for PS 7.2+
			$InputObject = [PSCustomObject]@{
				value = [String]$inputObject
			}
		}

		Add-Member -InputObject $inputObject -NotePropertyName '__PSStream' -NotePropertyValue $streamName -PassThru
	} else {
		$inputObject
	}
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
		$finalObject = Add-StreamIdentifier $inputObject
		$json = ConvertTo-Json -InputObject $finalObject -Compress -Depth $Depth -WarningAction SilentlyContinue
		[void][Console]::WriteLineAsync($json)
	}
}

# InvokeAsync doesn't exist in 5.1
$psStatus = $psInstance.BeginInvoke($psInput, $psOutput)
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# $psOutput while enumerating will block the pipeline while waiting for a new item, and will release when script is finished.
$psOutput | Out-JsonToStdOut -Depth $Depth
$psInstance.EndInvoke($psStatus)
$psInstance.Commands.Clear()

# Store the runspace where it can be reused for performance
$GLOBAL:__NODEPSINSTANCE = $psInstance

#Special event object to indicate the script is complete and the reader pipe can be closed.
$finishedMessage = [PSCustomObject]@{
	__PSINVOCATIONID = $Id
	finished         = $true
} | ConvertTo-Json -Compress -Depth 1
[void][Console]::WriteLineAsync($finishedMessage)
