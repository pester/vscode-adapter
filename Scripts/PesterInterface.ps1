#Requires -Modules @{ ModuleName="Pester";ModuleVersion="5.2.0" }
using namespace System.Collections
using namespace System.Collections.Generic
using namespace Pester

[CmdletBinding()]
param(
    #Path(s) to search for tests. Paths can also contain line numbers (e.g. /path/to/file:25)
    [Parameter(Mandatory,ValueFromRemainingArguments)][String[]]$Path,
    #Only return "It" Test Results and not the resulting hierarcy
    [Switch]$TestsOnly,
    #Only return the test information, don't actually run them
    [Switch]$Discovery,
    #Only load the functions but don't execute anything. Used for testing.
    [Parameter(DontShow)][Switch]$LoadFunctionsOnly,
    #If specified, emit the output objects as a flattened json to the specified named pipe handle. Used for IPC to the extension
    [String]$PipeName
)

$VerbosePreference = 'Ignore'
$WarningPreference = 'Ignore'
$DebugPreference = 'Ignore'

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

function New-SuiteObject ([Block]$Block) {
    [PSCustomObject]@{
        type = 'suite'
        id = $Block.ScriptBlock.File + ':' + $Block.StartLine
        file = $Block.ScriptBlock.File
        line = $Block.StartLine - 1
        label = $Block.Name
        children = [List[Object]]@()
    }
}

function Merge-TestData () {
    #Produce a unified test Data object from this object and its parents
    #Merge the local data and block data. Local data takes precedence.
    #Used in Test ID creation
    [CmdletBinding()]
    param(
        [Parameter(Mandatory,ValueFromPipeline)]
        [ValidateScript({
            [bool]($_.PSTypeNames -match '^(Pester\.)?Test$')
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
    $Data = [SortedDictionary[string,object]]::new()

    #This will merge the block data, with the lowest level data taking precedence
    $DataSources = $Test.Block.Data,$Test.Data
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
        [Parameter(Mandatory,ValueFromPipeline)]
        [ValidateScript({
            [bool]($_.PSTypeNames -match '^(Pester\.)?Test$')
        })]$Test
    )
    process {
        [String]$Name = $Test.Name.ToString()

        $Data = Merge-TestData $Test

        # Array value was stored as _ by Merge-TestData
        $Data.GetEnumerator().ForEach{
            $Name = $Name -replace ('<{0}>' -f $PSItem.Key),$PSItem.Value
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
        [Parameter(Mandatory,ValueFromPipeline)]
        [ValidateScript({
            $null -ne ($_.PSTypeNames -match '^(Pester\.)?Test$')
        })]$Test,
        $TestIdDelimiter = '>>',
        [Parameter(DontShow)][Switch]$AsString
    )
    process {
        if ($Test.Path -match $TestIdDelimiter) {
            throw [NotSupportedException]"The pipe character '|' is not supported in test names with this adapter. Please remove all pipes from test/context/describe names"
        }


        $Data = Merge-TestData $Test

        #Add a suffix of the testcase/foreach info that should uniquely identify the etst
        #TODO: Maybe use a hash of the serialized object if it is not natively a string?
        #TODO: Or maybe just hash the whole thing. The ID would be somewhat useless for troubleshooting
        $Data.GetEnumerator() | Foreach-Object {
            $Test.Path += [String]([String]$PSItem.Key + '=' + [String]$PSItem.Value)
        }

        #Prepend the filename to the path
        $Test.Path = ,$Test.ScriptBlock.File + $Test.Path
        $TestID = $Test.Path.where{$_} -join $TestIdDelimiter


        if ($AsString) {
            return $TestID
        }

        #Clever: https://www.reddit.com/r/PowerShell/comments/dr3taf/does_powershell_have_a_native_command_to_hash_a/
        #TODO: This should probably be a helper function
        Write-Debug "Non-Hashed Test ID for $($Test.ExpandedPath): $TestID"
        return (Get-FileHash -InputStream (
            [IO.MemoryStream]::new(
                [Text.Encoding]::UTF8.GetBytes($TestID)
            )
        ) -Algorithm SHA256).hash

    }
}

function New-TestObject ([Test]$Test) {
    if ($Test.ErrorRecord) {
        #TODO: Better handling once pester adds support
        #Reference: https://github.com/pester/Pester/issues/1993
        $Message = [string]$Test.ErrorRecord
        if ([string]$Test.ErrorRecord -match 'Expected (?<Expected>.+?), but (got )?(?<actual>.+?)\.$') {
            $Expected = $matches['Expected']
            $Actual = $matches['Actual']
        }
    }
    # TypeScript does not validate these data types, so numbers must be expressly stated so they don't get converted to strings
    [PSCustomObject]@{
        type = 'test'
        id = New-TestItemId $Test
        file = $Test.ScriptBlock.File
        startLine = [int]($Test.StartLine - 1) #Lines are zero-based in vscode
        endLine = [int]($Test.ScriptBlock.StartPosition.EndLine - 1) #Lines are zero-based in vscode
        label = Expand-TestCaseName $Test
        result = [ResultStatus]$Test.Result
        duration = $Test.UserDuration.TotalMilliseconds #I don't think anyone is doing sub-millisecond code performance testing in Powershell :)
        message = $Message
        expected = $Expected
        actual = $Actual
        targetFile = $Test.ErrorRecord.TargetObject.File
        targetLine = [int]$Test.ErrorRecord.TargetObject.Line -1
        #TODO: Severity. Failed = Error Skipped = Warning
    }
}

function fold ($children, $Block) {
    foreach ($b in $Block.Blocks) {
        $o = (New-SuiteObject $b)
        $children.Add($o)
        fold $o.children $b
    }

    $hashset = [HashSet[string]]::new()
    foreach ($t in $Block.Tests) {
        $key = "$($t.ExpandedPath):$($t.StartLine)"
        if ($hashset.Contains($key)) {
            continue
        }
        $children.Add((New-TestObject $t))
        $hashset.Add($key) | Out-Null
    }
    $hashset.Clear() | Out-Null
}

#endregion Functions
if ($LoadFunctionsOnly) {return}

# These should be unique which is why we use a hashset
$paths = [HashSet[string]]::new()
$lines = [HashSet[string]]::new()

# Including both the path and the line speeds up the script by limiting the discovery surface
$Path.foreach{
    if ($PSItem -match '(?<Path>.+?):(?<Line>\d+)$') {
        [void]$paths.Add($matches['Path'])
        [void]$lines.Add($PSItem)
    } else {
        [void]$paths.Add($PSItem)
    }
}

$config = New-PesterConfiguration @{
    Run = @{
        SkipRun = [bool]$Discovery
        PassThru = $true
    }
    Output = @{
        Verbosity = 'Detailed'
    }
}
if ($paths.Count) {
    $config.Run.Path = [string[]]$paths #Cast to string array is required or it will error
}
if ($lines.Count) {
    $config.Filter.Line = [string[]]$lines #Cast to string array is required or it will error
}

$runResult = Invoke-Pester -Configuration $config

if ($TestsOnly) {
    $testResult = $runResult.Tests
    $testFilteredResult = if (-not $Discovery) {
        #If discovery was not run, its easy to filter the results
        $testResult | Where-Object Executed
    } elseif ($lines.count) {
        #A more esoteric filter is required because
        #BUG: Pester still returns all test discovery results in the file even if you only specify a particular line filter
        #TODO: File an issue on this
        #Returns true if the id matches. The ID is not a native property in pester, we have to construct it.
        $testResult | Where-Object {
            $Test = $PSItem
            $location = $Test.ScriptBlock.File + ':' + $Test.StartLine
            $location -in $lines
        }
    } else {
        $testResult
    }
    [Array]$testObjects = $testFilteredResult | ForEach-Object {
        New-TestObject $PSItem
    }

try {
    # This will replace the standard Out-Default and allow us to tee json results to a named pipe for the extension to pick up.
    $SCRIPT:client = [IO.Pipes.NamedPipeClientStream]::new($PipeName)
    $client.Connect(5000)
    $client.IsConnected
    Write-Host -Fore Magenta "IsConnected: $($client.IsConnected) ServerInstances: $($client.NumberOfServerInstances)"
    $writer = [System.IO.StreamWriter]::new($client)
    $testObjects.foreach{
        [string]$jsonObject = ConvertTo-Json $PSItem -Compress -Depth 1
        if ($PipeName) {
            $writer.WriteLine($jsonObject)
        }
    }
    # DO NOT USE THE PIPELINE, it will unwrap the array and cause a problem with single-item results

} catch {throw} finally {
    $writer.flush()
    $writer.dispose()
    $client.Close()
}


} else {

    #Build a hierarchy in reverse, first looping through tests, then building
}

# TODO: Hierarchical return
# if ($lines) {
#     #Only return the tests that were filtered
#     $lines.foreach{
#         if ($PSItem -match '(?<Path>.+?):(?<Line>\d+)$') { #Should always be true for lines
#             $runResult.tests
#         } else {
#             throw "An incorrect line specification was provided: $PSItem"
#         }
#     }
# }

# $testSuiteInfo = [PSCustomObject]@{
#     type = 'suite'
#     id = 'root'
#     label = 'Pester'
#     children = [Collections.Generic.List[Object]]@()
# }

# foreach ($file in $runResult.Containers.Blocks) {
#     $fileSuite = [PSCustomObject]@{
#         type = 'suite'
#         id = $file.BlockContainer.Item.FullName
#         file = $file.BlockContainer.Item.FullName
#         label = $file.BlockContainer.Item.Name
#         children = [Collections.Generic.List[Object]]@()
#     }
#     $testSuiteInfo.children.Add($fileSuite)
#     fold $fileSuite.children $file
# }

# $testSuiteInfo | ConvertTo-Json -Depth 100