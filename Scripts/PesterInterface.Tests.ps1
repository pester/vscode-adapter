Describe 'PesterInterface' {
    BeforeAll{
        $SCRIPT:testScript = Resolve-Path "$PSScriptRoot/PesterInterface.ps1"
        $SCRIPT:testDataPath = Resolve-Path "$PSScriptRoot/../sample"
        $SCRIPT:Mocks = Resolve-Path $testDataPath/Tests/Mocks
    }

    Context 'VerifyResults' {
        BeforeAll {
            function shouldReturnTestCount($ShouldHaveCount,$Paths) {
                $result = & $testScript -TestsOnly -PassThru -Discovery $Paths -PipeName 'fake'
                $result | ConvertFrom-Json | Should -HaveCount $ShouldHaveCount
            }
        }
        It 'Sample1 Single File' {
            shouldReturnTestCount 39 @(
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
                ExpandedPath = $null
                ScriptBlock = @{
                    File = 'C:\Path\To\Pester\File'
                }
                Data = $null
            }
        }
        It 'basic path' {
            $baseMock.ExpandedPath = 'Describe.Context.It'
            New-TestItemId -AsString $baseMock |
                Should -Be $($baseMock.ScriptBlock.File,$baseMock.ExpandedPath -join '>>')
        }
        It 'Array testcase' {
            $baseMock.ExpandedPath = 'Describe.Context.It'
            $baseMock.Data = @('test')
            New-TestItemId -AsString $baseMock |
                Should -Be $($baseMock.ScriptBlock.File,$baseMock.ExpandedPath,'_=test' -join '>>')
        }
        It 'Hashtable testcase one key' {
            $baseMock.ExpandedPath = 'Describe.Context.It'
            $baseMock.Data = @{Name='Pester'}
            New-TestItemId -AsString $baseMock |
                Should -Be $($baseMock.ScriptBlock.File,$baseMock.ExpandedPath,'Name=Pester' -join '>>')
        }
        It 'Hashtable testcase multiple key' {
            $baseMock.ExpandedPath = 'Describe.Context.It'
            $baseMock.Data = @{Name='Pester';Data='Something'}
            New-TestItemId -AsString $baseMock |
                Should -Be $($baseMock.ScriptBlock.File,$baseMock.ExpandedPath,'Data=Something>>Name=Pester' -join '>>')
        }
        It 'Works without file' {
            $baseMock.Scriptblock.File = $null
            $baseMock.ExpandedPath = 'Describe.Context.It'
            $baseMock.Data = @{Name='Pester';Data='Something'}
            New-TestItemId -AsString $baseMock |
                Should -Be $($baseMock.ExpandedPath,'Data=Something>>Name=Pester' -join '>>')
        }
        It 'Works with Pester.Block' {
            $Block = Import-Clixml $Mocks/Block.clixml
            New-TestItemId $Block -AsString | Should -Be 'Describe Nested Foreach giraffe>>Kind=Animal>>Name=giraffe>>Symbol=🦒'
        }
    }

    Context "Expand-TestCaseName" {
        BeforeAll {
            . $testScript 'fakepath' -LoadFunctionsOnly
        }
        BeforeEach {
            $SCRIPT:baseMock = New-MockObject -Type Pester.Test
            $BaseMock.Name = 'Pester'
        }
        It 'Fails with wrong type' {
            $fake = [PSCustomObject]@{Name='Pester';PSTypeName='NotATest'}
            {Expand-TestCaseName -Test $fake} | Should -Throw '*is not a Pester Test or Pester Block*'
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