using namespace System.Collections
using namespace System.Collections.Generic
using namespace Pester

[CmdletBinding(PositionalBinding = $false)]
param(
	#Path(s) to search for tests. Paths can also contain line numbers (e.g. /path/to/file:25)
	[Parameter(ValueFromRemainingArguments)][String[]]$Path = $PWD,
	#Only return the test information, don't actually run them. Also returns minimal output
	[Switch]$Discovery,
	#Only load the functions but don't execute anything. Used for testing.
	[Parameter(DontShow)][Switch]$LoadFunctionsOnly,
	#If specified, emit the output objects as a flattened json to the specified named pipe handle. Used for IPC to the extension host.
	#If this value is the special value 'stdout' or undefined, then the output object is written to stdout.
	[String]$PipeName,
	#The verbosity to pass to the system
	[String]$Verbosity,
	#If specified, the shim will write to a temporary file at Pipename path and this script will output what would have been written to the stream. Useful for testing.
	[Switch]$DryRun,
	#An optional custom path to the Pester module.
	[String]$CustomModulePath,
	#Include ANSI characters in output
	[Switch]$IncludeAnsi,
	#Specify the path to a PesterConfiguration.psd1 file. The script will also look for a PesterConfiguration.psd1 in the current working directory.
	[String]$ConfigurationPath
)

try {
    $modulePath = if ($CustomModulePath) { Resolve-Path $CustomModulePath -ErrorAction Stop } else { 'Pester' }
	Import-Module -Name $modulePath -MinimumVersion '5.2.0' -ErrorAction Stop
} catch {
	if ($PSItem.FullyQualifiedErrorId -ne 'Modules_ModuleWithVersionNotFound,Microsoft.PowerShell.Commands.ImportModuleCommand') { throw }

	throw [NotSupportedException]'Pester 5.2.0 or greater is required to use the Pester Tests extension but was not found on your system. Please install the latest version of Pester from the PowerShell Gallery.'
}

if ($psversiontable.psversion -ge '7.2.0') {
	if ($IncludeAnsi) {
		$PSStyle.OutputRendering = 'ANSI'
	} else {
		$PSStyle.OutputRendering = 'PlainText'
	}
}

if ($PSVersionTable.PSEdition -eq 'Desktop') {
	#Defaults to inquire
	$DebugPreference = 'continue'
}
Write-Debug "Home: $env:HOME"
Write-Debug "PSModulePath: $env:PSModulePath"
Write-Debug "OutputRendering: $($PSStyle.OutputRendering)"

filter Import-PrivateModule ([Parameter(ValueFromPipeline)][string]$Path) {
	<#
	.SYNOPSIS
	This function imports a module from a file into a private variable and does not expose it via Get-Module.
	.NOTES
	Thanks to @SeeminglyScience for the inspiration
	#>

	#We dont use namespaces here to keep things portable
	$absolutePath = Resolve-Path $Path -ErrorAction Stop
	[Management.Automation.Language.Token[]]$tokens = $null
	[Management.Automation.Language.ParseError[]]$errors = $null
	[Management.Automation.Language.ScriptBlockAst]$scriptBlockAST = [Management.Automation.Language.Parser]::ParseFile($absolutePath, [ref]$tokens, [ref]$errors)

	if ($errors) {
		$errors | ForEach-Object { Write-Error $_.Message }
		return
	}

	return [psmoduleinfo]::new($scriptBlockAst.GetScriptBlock())
}

function Register-PesterPlugin ([hashtable]$PluginConfiguration) {
	<#
	.SYNOPSIS
	Utilizes a private Pester API to register the plugin.
	#>
	$Pester = (Get-Command Invoke-Pester -ErrorAction Stop).Module
	& $Pester {
		param($PluginConfiguration)
		if ($null -ne $SCRIPT:additionalPlugins -and $testAdapterPlugin.Name -in $SCRIPT:additionalPlugins.Name) {
			Write-Debug "PesterInterface: $($testAdapterPlugin.Name) is already registered. Skipping..."
			return
		}

		if ($null -eq $SCRIPT:additionalPlugins) {
			$SCRIPT:additionalPlugins = @()
		}

		$testAdapterPlugin = New-PluginObject @PluginConfiguration
		$SCRIPT:additionalPlugins += $testAdapterPlugin
	} $PluginConfiguration
}

function Unregister-PesterPlugin ([hashtable]$PluginConfiguration) {
	<#
	.SYNOPSIS
	Utilizes a private Pester API to unregister the plugin.
	#>
	$Pester = (Get-Command Invoke-Pester -ErrorAction Stop).Module
	& $Pester {
		param($PluginConfiguration)
		if (-not $SCRIPT:additionalPlugins) {
			Write-Debug 'PesterInterface: No plugins are registered. Skipping...'
			return
		}

		$plugin = $SCRIPT:additionalPlugins | Where-Object Name -EQ $PluginConfiguration.Name
		if (-not $plugin) {
			Write-Debug "PesterInterface: $($PluginConfiguration.Name) is not registered. Skipping..."
			return
		}

		$SCRIPT:additionalPlugins = $SCRIPT:additionalPlugins | Where-Object Name -NE $PluginConfiguration.Name
	} $PluginConfiguration
}


#endregion Functions

#Main Function
function Invoke-Main {
	$pluginModule = Import-PrivateModule $PSScriptRoot/PesterTestPlugin.psm1

	$configArgs = @{
		Discovery = $Discovery
		PipeName  = $PipeName
		DryRun    = $DryRun
	}

	#This syntax may seem strange but it allows us to inject state into the plugin.
	$plugin = & $pluginModule {
		param($externalConfigArgs) New-PesterTestAdapterPluginConfiguration @externalConfigArgs
	} $configArgs

	try {
		Register-PesterPlugin $plugin

		# These should be unique which is why we use a hashset
		[HashSet[string]]$paths = @()
		[HashSet[string]]$lines = @()
		# Including both the path and the line speeds up the script by limiting the discovery surface
		# Specifying just the line will still scan all files
		$Path.foreach{
			if ($PSItem -match '(?<Path>.+?):(?<Line>\d+)$') {
				[void]$paths.Add($matches['Path'])
				[void]$lines.Add($PSItem)
			} else {
				[void]$paths.Add($PSItem)
			}
		}

		[PesterConfiguration]$config = if ($PesterPreference) {
			Write-Debug "$PesterPreference Detected, using for base configuration"
			$pesterPreference
		} elseif ($ConfigurationPath) {
			Write-Debug "-ConfigurationPath $ConfigurationPath was specified, looking for configuration"
			$resolvedConfigPath = Resolve-Path $ConfigurationPath -ErrorAction Stop
			Write-Debug "Pester Configuration found at $ConfigurationPath, using as base configuration."
			Import-PowerShellDataFile $resolvedConfigPath -ErrorAction Stop
		} elseif (Test-Path './PesterConfiguration.psd1') {
			Write-Debug "PesterConfiguration.psd1 found in test root directory $cwd, using as base configuration."
			Import-PowerShellDataFile './PesterConfiguration.psd1' -ErrorAction Stop
		} else {
			New-PesterConfiguration
		}

		$config.Run.SkipRun = [bool]$Discovery
		$config.Run.PassThru = $true

		#If Verbosity is $null it will use PesterPreference
		if ($Discovery) { $config.Output.Verbosity = 'None' }
		elseif ($Verbosity) { $config.Output.Verbosity = $Verbosity }

		if ($paths.Count) {
			$config.Run.Path = [string[]]$paths #Cast to string array is required or it will error
		}
		if ($lines.Count) {
			$config.Filter.Line = [string[]]$lines #Cast to string array is required or it will error
		}
		Invoke-Pester -Configuration $config | Out-Null
	} catch {
		throw
	} finally {
		Unregister-PesterPlugin $plugin
	}
}

#Run Main function
if (-not $LoadFunctionsOnly) { Invoke-Main }
