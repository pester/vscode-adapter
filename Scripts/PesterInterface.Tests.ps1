$OutputEncoding = [Text.Encoding]::UTF8
Describe 'PesterInterface' {
    BeforeAll{
        $SCRIPT:testScript = Resolve-Path "$PSScriptRoot/PesterInterface.ps1"
        $SCRIPT:testDataPath = Resolve-Path "$PSScriptRoot/../sample"
        $SCRIPT:Mocks = Resolve-Path $testDataPath/Tests/Mocks
    }

    Context 'VerifyResults' {
        BeforeAll {
            function shouldReturnTestCount($ShouldHaveCount,$Paths) {
                $result = & $testScript -TestsOnly -Discovery $Paths
                $result | ConvertFrom-Json | Should -HaveCount $ShouldHaveCount
            }
        }
        It 'Sample1 Single File' {
            shouldReturnTestCount 31 @(
                Resolve-Path "$testDataPath/Tests/Basic.Tests.ps1"
            )
        }
    }

    Context "New-TestItemId" {
        BeforeAll {
            . $testScript 'fakepath' -LoadFunctionsOnly
        }
        BeforeEach {
            $SCRIPT:baseMock = [PSCustomObject]@{
                PSTypeName = 'Test'
                ScriptBlock = @{
                    File = $null
                }
                Path = @()
                Data = $null
            }
        }
        It 'basic path' {
            $baseMock.Path = 'Describe','Context','It'
            New-TestItemId -AsString $baseMock |
                Should -Be 'Describe>>Context>>It'
        }
        It 'Array testcase' {
            $baseMock.Path = 'Describe','Context','It <_>'
            $baseMock.Data = @('test')
            New-TestItemId -AsString $baseMock |
                Should -Be 'Describe>>Context>>It <_>>>_=test'
        }
        It 'Hashtable testcase one key' {
            $baseMock.Path = 'Describe','Context','It <Name>'
            $baseMock.Data = @{Name='Pester'}
            New-TestItemId -AsString $baseMock | Should -Be 'Describe>>Context>>It <Name>>>Name=Pester'
        }
        It 'Hashtable testcase multiple key' {
            $baseMock.Path = 'Describe','Context','It <Name> <Data>'
            $baseMock.Data = @{Name='Pester';Data='Something'}
            New-TestItemId -AsString $baseMock | Should -Be 'Describe>>Context>>It <Name> <Data>>>Data=Something>>Name=Pester'
        }
        It 'Works with file' {
            $baseMock.Scriptblock.File = 'C:\my\test'
            $baseMock.Path = 'Describe','Context','It <Name>'
            $baseMock.Data = @{Name='Pester'}
            New-TestItemId -AsString $baseMock | Should -Be 'C:\my\test>>Describe>>Context>>It <Name>>>Name=Pester'
        }

        It 'Works with Pester.Block' {
            $Block = Import-Clixml $Mocks/Block.clixml
            New-TestItemId $Block -AsString | Should -Be 'Describe Nested Foreach <name>>>Kind=Animal>>Name=giraffe>>Symbol=🦒'
        }
    }

    Context "Expand-TestCaseName" {
        BeforeAll {
            . $testScript 'fakepath' -LoadFunctionsOnly
        }
        BeforeEach {
            $SCRIPT:baseMock = [PSCustomObject]@{
                PSTypeName = 'Test'
                Name = 'Pester'
                Data = $null
            }
        }
        It 'Fails with wrong type' {
            $fake = [PSCustomObject]@{Name='Pester';PSTypeName='NotATest'}
            {Expand-TestCaseName -Test $fake} | Should -Throw '*did not return a result of true*'
        }
        It 'Works with Array testcase' {
            $baseMock.Name = 'Array TestCase <_>'
            $baseMock.Data = @('pester')
            Expand-TestCaseName $baseMock | Should -Be 'Array TestCase pester'
        }
        It 'Works with Single Hashtable testcase' {
            $baseMock.Name = 'Array TestCase <Name>'
            $baseMock.Data = @{Name='pester'}
            Expand-TestCaseName $baseMock | Should -Be 'Array TestCase pester'
        }
        It 'Works with Multiple Hashtable testcase' {
            $baseMock.Name = 'Array <Data> TestCase <Name>'
            $baseMock.Data = @{Name='pester';Data='aCoolTest'}
            Expand-TestCaseName $baseMock | Should -Be 'Array aCoolTest TestCase pester'
        }

        It 'Works with Pester.Block' {
            $Block = Import-Clixml $Mocks/Block.clixml
            Expand-TestCaseName $Block | Should -Be 'Describe Nested Foreach giraffe'
        }
    }
}