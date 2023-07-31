using namespace Pester
using namespace System.Management.Automation
using namespace System.Collections
using namespace System.Collections.Generic
using namespace System.IO
using namespace System.IO.Pipes
using namespace System.Text

function New-PesterTestAdapterPluginConfiguration {
	param(
		[string]$PipeName,
		[switch]$Discovery,
		[switch]$DryRun
	)

	$SCRIPT:PipeName = $PipeName
	$SCRIPT:Discovery = $Discovery
	$SCRIPT:DryRun = $DryRun

	@{
		Name                    = 'PesterVSCodeTestAdapter'
		Start                   = {
			$SCRIPT:__TestAdapterKnownParents = [HashSet[Pester.Block]]::new()
			if ($DryRun) {
				Write-Host -ForegroundColor Magenta "Dryrun Detected. Writing to file $PipeName"
			} else {
				if (-not (!$pipeName -or $pipeName -eq 'stdout')) {
					Write-Host -ForegroundColor Green "Connecting to pipe $PipeName"
					$SCRIPT:__TestAdapterNamedPipeClient = [NamedPipeClientStream]::new($PipeName)
					$__TestAdapterNamedPipeClient.Connect(5000)
					$SCRIPT:__TestAdapterNamedPipeWriter = [StreamWriter]::new($__TestAdapterNamedPipeClient)
				}
			}
		}
		DiscoveryEnd            = {
			param($Context)
			if (-not $Discovery) { continue }
			$discoveredTests = & (Get-Module Pester) { $Context.BlockContainers | View-Flat }
			[Array]$discoveredTests = & (Get-Module Pester) { $Context.BlockContainers | View-Flat }
			$failedBlocks = $Context.BlockContainers | Where-Object -Property ErrorRecord
			$discoveredTests += $failedBlocks
			$discoveredTests.foreach{
				if ($PSItem -is [Pester.Test]) {
					[Pester.Block[]]$testSuites = Get-TestItemParents -Test $PSItem -KnownParents $SCRIPT:__TestAdapterKnownParents
					$testSuites.foreach{
						Write-TestItem -TestDefinition $PSItem -PipeName $PipeName -DryRun:$DryRun
					}
				}
				Write-TestItem -TestDefinition $PSItem -PipeName $PipeName -DryRun:$DryRun
			}
		}
		EachTestSetup           = {
			param($Context)
			Write-TestItem -TestDefinition $Context.Test -PipeName $PipeName -DryRun:$DryRun
		}
		EachTestTeardownEnd     = {
			param($Context)
			if (-not $Context) { continue }
			Write-TestItem -TestDefinition $Context.Test -PipeName $PipeName -DryRun:$DryRun
		}
		OneTimeBlockTearDownEnd = {
			param($Context)
			if (-not $Context) { continue }
			[Pester.Block]$Block = $Context.Block
			# Report errors in the block itself. This should capture BeforeAll/AfterAll issues
			if ($Block.ErrorRecord) {
				Write-TestItem -TestDefinition $Block -PipeName $PipeName -DryRun:$DryRun
			}
		}
		End                     = {
			if (!$DryRun -and -not (!$pipeName -or $pipeName -eq 'stdout')) {
				$SCRIPT:__TestAdapterNamedPipeWriter.flush()
				$SCRIPT:__TestAdapterNamedPipeWriter.dispose()
				$SCRIPT:__TestAdapterNamedPipeClient.Close()
			}
		}
	}
}

filter Write-TestItem([Parameter(ValueFromPipeline)]$TestDefinition, [string]$PipeName, [switch]$DryRun) {
	$testItem = New-TestObject $TestDefinition
	[string]$jsonObject = ConvertTo-Json $testItem -Compress -Depth 1
	if (!$DryRun) {
		if (!$pipeName -or $pipeName -eq 'stdout') {
			[void][Console]::Out.WriteLineAsync($jsonObject)
		} else {
			$__TestAdapterNamedPipeWriter.WriteLine($jsonObject)
		}
	} else {
		$jsonObject >> $PipeName
	}
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
			[string]$path = $Test.BlockContainer.Item
			if ($IsWindows -or $PSEdition -eq 'Desktop') {
				return $path.ToUpper()
			} else {
				return $path
			}
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
					[MemoryStream]::new(
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

function Test-IsPesterObject {
	[Diagnostics.CodeAnalysis.SuppressMessageAttribute(
		'PSUseDeclaredVarsMoreThanAssignments',
		'',
		Justification = 'Scriptanalyzer bug: Reference is not tracked through callback',
		Scope = 'Function'
	)]
	param($Test)

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
	if ($p.Count -ge 2) {
		throw 'Multiple Pester modules found. Make sure to only have one Pester module imported in the session.'
	}
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
			# Better formatting of parsing errors
			if ($Test.ErrorRecord.Exception -is [ParseException]) {
				$FirstParseError = $Test.ErrorRecord.Exception.Errors[0]
				$firstParseMessage = "Line $($FirstParseError.Extent.StartScriptPosition.LineNumber): $($FirstParseError.Message)"
				$DiscoveryError = $firstParseMessage + ([Environment]::NewLine * 2) + $Test.ErrorRecord
			}
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
		result         = $(if (-not $Discovery) { $Test | Resolve-TestResult })
		duration       = $Test.UserDuration.TotalMilliseconds #I don't think anyone is doing sub-millisecond code performance testing in PowerShell :)
		durationDetail = Get-DurationString $Test
		message        = $Message
		expected       = $Expected
		actual         = $Actual
		targetFile     = $Test.ErrorRecord.TargetObject.File
		targetLine     = [int]$Test.ErrorRecord.TargetObject.Line - 1
		parent         = $Parent
		tags           = $Test.Tag.Where{ $PSItem }
		scriptBlock    = if ($Test -is [Pester.Test]) { $Test.Block.ScriptBlock.ToString().Trim() }
		#TODO: Severity. Failed = Error Skipped = Warning
	}
}

filter Resolve-TestResult ([Parameter(ValueFromPipeline)]$TestResult) {
	#This part borrowed from https://github.dev/pester/Pester/blob/7ca9c814cf32334303f7c506beaa6b1541554973/src/Pester.RSpec.ps1#L107-L122 because with the new plugin system it runs *after* our plugin unfortunately
	switch ($true) {
		($TestResult.Duration -eq 0 -and $TestResult.ShouldRun -eq $true) { return 'Running' }
		($TestResult.Skipped) { return 'Skipped' }
		($TestResult.Passed) { return 'Passed' }
		(-not $discoveryOnly -and $TestResult.ShouldRun -and (-not $TestResult.Executed -or -not $TestResult.Passed)) { return 'Failed' }
		($discoveryOnly -and 0 -lt $TestResult.ErrorRecord.Count) { return 'Running' }
		default { return 'NotRun' }
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
