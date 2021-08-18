#Requires -version 5.1 -Modules @{ ModuleName="Pester";ModuleVersion="5.2.0" }
using namespace System.Collections
using namespace System.Collections.Generic
using namespace Pester

[CmdletBinding()]
param(
	#Path(s) to search for tests. Paths can also contain line numbers (e.g. /path/to/file:25)
	[Parameter(ValueFromRemainingArguments)][String[]]$Path = $PWD,
	#Only return the test information, don't actually run them. Also returns minimal output
	[Switch]$Discovery,
	#Only load the functions but don't execute anything. Used for testing.
	[Parameter(DontShow)][Switch]$LoadFunctionsOnly,
	#If specified, emit the output objects as a flattened json to the specified named pipe handle. Used for IPC to the extension
	[String]$PipeName,
	#The verbosity to pass to the system
	[String]$Verbosity,
	#If specified, the shim will write to a temporary file at Pipename path and this script will output what would have been written to the stream. Useful for testing.
	[Switch]$DryRun
)

$VerbosePreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'

#region Functions
# Maps pester result status to vscode result status
enum ResultStatus {
	Unset
	Queued
	Running
	Passed
	Failed
	Skipped
	Errored
	NotRun #Pester Specific, this should be ignored
}

function Merge-TestData () {
	#Produce a unified test Data object from this object and its parents
	#Merge the local data and block data. Local data takes precedence.
	#Used in Test ID creation
	[CmdletBinding()]
	param(
		[Parameter(Mandatory, ValueFromPipeline)]
		[ValidateScript( {
				[bool]($_.PSTypeNames -match '(Pester\.)?(Test|Block)$')
			})]$Test
	)
	#TODO: Nested Describe/Context Foreach?
	#TODO: Edge cases
	#Non-String Object
	#Non-String Hashtable
	#Other dictionaries
	#Nested Hashtables
	#Fancy TestCases, maybe just iterate them as TestCaseN or exclude


	#If data is not iDictionary array, we will store it as _ to standardize this is a bit
	$Data = [SortedDictionary[string, object]]::new()

	#Block and parent are interchangeable
	if ($Test -is [Pester.Test]) {
		Add-Member -InputObject $Test -NotePropertyName 'Parent' -NotePropertyValue $Test.Block -Force
	}

	#This will merge the block data, with the lowest level data taking precedence
	#TODO: Use a stack to iterate this
	$DataSources = ($Test.Parent.Parent.Data, $Test.Parent.Data, $Test.Data).where{ $PSItem }
	foreach ($DataItem in $DataSources) {
		if ($DataItem) {
			if ($DataItem -is [IDictionary]) {
				$DataItem.GetEnumerator().foreach{
					$Data.$($PSItem.Name) = $PSItem.Value
				}
			} else {
				#Save to the "_" key if it was an array input since that's what Pester uses for substitution
				$Data._ = $DataItem
			}
		}
	}
	return $Data
}

function Expand-TestCaseName {
	[CmdletBinding()]
	param(
		[Parameter(Mandatory, ValueFromPipeline)]
		$Test
	)
	begin {
		Test-IsPesterObject $Test
	}
	process {
		[String]$Name = $Test.Name.ToString()

		$Data = Merge-TestData $Test

		# Array value was stored as _ by Merge-TestData
		$Data.GetEnumerator().ForEach{
			$Name = $Name -replace ('<{0}>' -f $PSItem.Key), $PSItem.Value
		}

		return $Name
	}
}

function New-TestItemId {
	<#
    .SYNOPSIS
    Create a string that uniquely identifies a test or test suite
    .NOTES
    Can be replaced with expandedpath if https://github.com/pester/Pester/issues/2005 is fixed
    #>
	[CmdletBinding()]
	param(
		[Parameter(Mandatory, ValueFromPipeline)]
		[ValidateScript( {
				$null -ne ($_.PSTypeNames -match '(Pester\.)?(Block|Test)$')
			})]$Test,
		$TestIdDelimiter = '>>',
		[Parameter(DontShow)][Switch]$AsString,
		[Parameter(DontShow)][Switch]$AsHash
	)
	process {

		if ($Test.Path -match $TestIdDelimiter) {
			throw [NotSupportedException]"The delimiter $TestIdDelimiter is not supported in test names with this adapter. Please remove all pipes from test/context/describe names"
		}

		$Data = Merge-TestData $Test

		#Add a suffix of the testcase/foreach info that should uniquely identify the etst
		#TODO: Maybe use a hash of the serialized object if it is not natively a string?
		#TODO: Or maybe just hash the whole thing. The ID would be somewhat useless for troubleshooting
		$DataItems = $Data.GetEnumerator() | Sort-Object Key | ForEach-Object {
			[String]([String]$PSItem.Key + '=' + [String]$PSItem.Value)
		}

		# If this is a root container, just return the file path, since root containers can only be files (for now)
		if ($Test -is [Pester.Block] -and $Test.IsRoot) {
			return $Test.BlockContainer.Item.ToString().ToUpper()
		}

		[String]$TestID = @(
			# Javascript uses lowercase drive letters
			$Test.ScriptBlock.File
			# Can NOT Use expandedPath here, because when test runs it extrapolates
			$Test.Path
			$DataItems
		).Where{ $PSItem } -join '>>'

		if (-not $TestID) { throw 'A test ID was not generated. This is a bug.' }

		if ($AsHash) {
			#Clever: https://www.reddit.com/r/PowerShell/comments/dr3taf/does_powershell_have_a_native_command_to_hash_a/
			#TODO: This should probably be a helper function
			Write-Debug "Non-Hashed Test ID for $($Test.ExpandedPath): $TestID"
			return (Get-FileHash -InputStream (
					[IO.MemoryStream]::new(
						[Text.Encoding]::UTF8.GetBytes($TestID)
					)
				) -Algorithm SHA256).hash
		}

		# -AsString is now the default, keeping for other existing references

		# ToUpper is used to normalize windows paths to all uppercase
		if ($IsWindows -or $PSEdition -eq 'Desktop') {
			$TestID = $TestID.ToUpper()
		}
		return $TestID

	}
}

function Test-IsPesterObject($Test) {
	#We don't use types here because they might not be loaded yet
	$AllowedObjectTypes = [String[]]@(
		'Test'
		'Block'
		'Pester.Test'
		'Pester.Block'
		'Deserialized.Pester.Test'
		'Deserialized.Pester.Block'
	)
	$AllowedObjectTypes.foreach{
		if ($PSItem -eq $Test.PSTypeNames[0]) {
			$MatchesType = $true
			return
		}
	}
	if (-not $MatchesType) { throw 'Provided object is not a Pester Test or Pester Block' }
}

function Get-DurationString($Test) {
	if (-not ($Test.UserDuration -and $Test.FrameworkDuration)) { return }
	$p = Get-Module Pester
	& ($p) {
		$Test = $args[0]
		'({0}|{1})' -f (Get-HumanTime $Test.UserDuration), (Get-HumanTime $Test.FrameworkDuration)
	} $Test
}

function New-TestObject ($Test) {
	Test-IsPesterObject $Test

	#HACK: Block and Parent are equivalent so this simplifies further code
	if ($Test -is [Pester.Test]) {
		Add-Member -InputObject $Test -NotePropertyName 'Parent' -NotePropertyValue $Test.Block -Force
	}

	if (-not $Test.Parent -and ($Test -is [Pester.Test])) {
		throw "Item $($Test.Name) is a test but doesn't have an ancestor. This is a bug."
	}

	[String]$Parent = if ($Test.IsRoot) {
		$null
	} else {
		New-TestItemId $Test.Parent
	}

	if ($Test.ErrorRecord) {
		if ($Test -is [Pester.Block]) {
			[String]$DiscoveryError = $Test.ErrorRecord
		} else {
			#TODO: Better handling once pester adds support
			#Reference: https://github.com/pester/Pester/issues/1993
			$Message = [string]$Test.ErrorRecord
			if ([string]$Test.ErrorRecord -match 'Expected (?<Expected>.+?), but (got )?(?<actual>.+?)\.$') {
				$Expected = $matches['Expected']
				$Actual = $matches['Actual']
			}
		}
	}

	# TypeScript does not validate these data types, so numbers must be expressly stated so they don't get converted to strings
	[PSCustomObject]@{
		type           = $Test.ItemType
		id             = New-TestItemId $Test
		error          = $DiscoveryError
		file           = $Test.ScriptBlock.File
		startLine      = [int]($Test.StartLine - 1) #Lines are zero-based in vscode
		endLine        = [int]($Test.ScriptBlock.StartPosition.EndLine - 1) #Lines are zero-based in vscode
		label          = Expand-TestCaseName $Test
		result         = [ResultStatus]$(if ($null -eq $Test.Result) { 'NotRun' } else { $Test.Result })
		duration       = $Test.UserDuration.TotalMilliseconds #I don't think anyone is doing sub-millisecond code performance testing in Powershell :)
		durationDetail = Get-DurationString $Test
		message        = $Message
		expected       = $Expected
		actual         = $Actual
		targetFile     = $Test.ErrorRecord.TargetObject.File
		targetLine     = [int]$Test.ErrorRecord.TargetObject.Line - 1
		parent         = $Parent
		tags           = $Test.Tag.Where{ $PSItem } -join ', '
		#TODO: Severity. Failed = Error Skipped = Warning
	}
}


function Get-TestItemParents {
	<#
    .SYNOPSIS
    Returns any parents not already known, top-down first, so that a hierarchy can be created in a streaming manner
  #>
	param (
		#Test to fetch parents of. For maximum efficiency this should be done one test at a time and then stack processed
		[Parameter(Mandatory, ValueFromPipeline)][Pester.Test[]]$Test,
		[HashSet[Pester.Block]]$KnownParents = [HashSet[Pester.Block]]::new()
	)

	begin {
		[Stack[Pester.Block]]$NewParents = [Stack[Pester.Block]]::new()
	}
	process {
		# Output all parents that we don't know yet (distinct parents), in order from the top most
		# to the child most.
		foreach ($TestItem in $Test) {
			$NewParents.Clear()
			$parent = $TestItem.Block

			while ($null -ne $parent -and -not $parent.IsRoot) {
				if (-not $KnownParents.Add($parent)) {
					# We know this parent, so we must know all of its parents as well.
					# We don't need to go further.
					break
				}

				$NewParents.Push($parent)
				$parent = $parent.Parent
			}

			# Output the unknown parent objects from the top most, to the one closest to our test.
			foreach ($p in $NewParents) { $p }
		}
	}
}

$MyPlugin = @{
	Name                = 'TestPlugin'
	Start               = {
		$SCRIPT:__TestAdapterKnownParents = [HashSet[Pester.Block]]::new()
		if ($DryRun) {
			Write-Host -ForegroundColor Magenta "Dryrun Detected. Writing to file $PipeName"
		} else {
			Write-Host -ForegroundColor Green "Connecting to pipe $PipeName"
		}
		if (!$DryRun) {
			$SCRIPT:__TestAdapterNamedPipeClient = [IO.Pipes.NamedPipeClientStream]::new($PipeName)
			$__TestAdapterNamedPipeClient.Connect(5000)
			$SCRIPT:__TestAdapterNamedPipeWriter = [System.IO.StreamWriter]::new($__TestAdapterNamedPipeClient)
		}
	}
	DiscoveryEnd        = {
		param($Context)
		if (-not $Discovery) { continue }
		$discoveredTests = & (Get-Module Pester) { $Context.BlockContainers | View-Flat }
		$Context.BlockContainers
		$discoveredTests.foreach{
			[Pester.Block[]]$testSuites = Get-TestItemParents -Test $PSItem -KnownParents $SCRIPT:__TestAdapterKnownParents
			$testSuites.foreach{
				$testItem = New-TestObject $PSItem
				[string]$jsonObject = ConvertTo-Json $testItem -Compress -Depth 1
				if (!$DryRun) {
					$__TestAdapterNamedPipeWriter.WriteLine($jsonObject)
				} else {
					$jsonObject >> $PipeName
				}
			}
			$testItem = New-TestObject $PSItem
			[string]$jsonObject = ConvertTo-Json $testItem -Compress -Depth 1
			if (!$DryRun) {
				$__TestAdapterNamedPipeWriter.WriteLine($jsonObject)
			} else {
				$jsonObject >> $PipeName
			}
		}
	}

	EachTestTeardownEnd = {
		param($Context)
		if (-not $Context) { continue }
		$testItem = New-TestObject $context.test
		[string]$jsonObject = ConvertTo-Json $testItem -Compress -Depth 1
		if (!$DryRun) {
			$__TestAdapterNamedPipeWriter.WriteLine($jsonObject)
		} else {
			$jsonObject >> $PipeName
		}
	}

	End                 = {
		if (!$DryRun) {
			$SCRIPT:__TestAdapterNamedPipeWriter.flush()
			$SCRIPT:__TestAdapterNamedPipeWriter.dispose()
			$SCRIPT:__TestAdapterNamedPipeClient.Close()
		}
	}
}

function Add-PesterPluginShim([Hashtable]$PluginConfiguration) {
	<#
.SYNOPSIS
A dirty hack that parasitically infects another plugin function and generates this function in addition to that one
.NOTES
Warning: This only works once, not designed for repeated plugin injection
#>
	$Pester = Import-Module Pester -PassThru
	& $Pester {
		param($SCRIPT:PluginConfiguration)
		if ($SCRIPT:ShimmedPlugin) { return }
		[ScriptBlock]$SCRIPT:ShimmedPlugin = (Get-Item 'Function:\Get-RSpecObjectDecoratorPlugin').ScriptBlock
		function SCRIPT:Get-RSpecObjectDecoratorPlugin {
			# Our plugin must come first because teardowns are done in reverse and we need the RSpec to add result status
			New-PluginObject @SCRIPT:PluginConfiguration
			. $ShimmedPlugin $args
		}
	} $PluginConfiguration
}

#endregion Functions

#Main Function
function Invoke-Main {
	# These should be unique which is why we use a hashset
	$paths = [HashSet[string]]::new()
	$lines = [HashSet[string]]::new()
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

	$config = New-PesterConfiguration @{
		Run    = @{
			SkipRun  = [bool]$Discovery
			PassThru = $true
		}
		Output = @{
			Verbosity = if ($Discovery) { 'None' } else { $Verbosity }
		}
	}
	if ($paths.Count) {
		$config.Run.Path = [string[]]$paths #Cast to string array is required or it will error
	}
	if ($lines.Count) {
		$config.Filter.Line = [string[]]$lines #Cast to string array is required or it will error
	}

	Add-PesterPluginShim $MyPlugin
	Invoke-Pester -Configuration $config | Out-Null
}

#Run Main function
if (-not $LoadFunctionsOnly) { Invoke-Main }
