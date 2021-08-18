Describe 'PesterInterface' {
	BeforeAll {
		$SCRIPT:PesterInterface = Resolve-Path "$PSScriptRoot/PesterInterface.ps1"
		$SCRIPT:testDataPath = Resolve-Path "$PSScriptRoot/../sample"
		$SCRIPT:Mocks = Resolve-Path $testDataPath/Tests/Mocks
	}

	Context 'PesterInterface' {
		BeforeEach {
			Import-Module Pester -Force
			$SCRIPT:pipeOutPath = New-Item "Temp:\PesterInterfaceOutput-$(New-Guid).txt" -ItemType File -Force
		}
		AfterEach {
			Remove-Item $SCRIPT:pipeOutPath
			Remove-Module Pester
		}
		It 'Basic.Tests Discovery' {
			$paths = "$testDataPath/Tests/Basic.Tests.ps1"
			& $PesterInterface -Path $paths -Discovery -PipeName $PipeOutPath -DryRun
			Get-Content $PipeOutPath | ConvertFrom-Json | ForEach-Object label | Should -HaveCount 53
		}
		It 'Syntax Error' {
			$paths = "$testDataPath/Tests/SyntaxError.Tests.ps1"
			& $PesterInterface -Path $paths -Discovery -PipeName $PipeOutPath -DryRun
			Get-Content $PipeOutPath | ConvertFrom-Json | ForEach-Object label | Should -HaveCount 1
		}
	}

	Context 'New-TestItemId' {
		BeforeAll {
			. $PesterInterface -LoadFunctionsOnly
		}
		BeforeEach {
			$SCRIPT:baseMock = [PSCustomObject]@{
				PSTypeName  = 'Test'
				Path        = 'Describe', 'Context', 'It'
				ScriptBlock = @{
					File = 'C:\Path\To\Pester\File'
				}
				Data        = $null
			}
		}
		It 'basic path' {
			New-TestItemId -AsString $baseMock |
				Should -Be $($baseMock.ScriptBlock.File, ($baseMock.Path -join '>>') -join '>>')
		}
		It 'Array testcase' {
			$baseMock.Data = @('test')
			New-TestItemId -AsString $baseMock |
				Should -Be $($baseMock.ScriptBlock.File, ($baseMock.Path -join '>>'), '_=test' -join '>>')
		}
		It 'Hashtable testcase one key' {
			$baseMock.Data = @{Name = 'Pester' }
			New-TestItemId -AsString $baseMock |
				Should -Be $($baseMock.ScriptBlock.File, ($baseMock.Path -join '>>'), 'Name=Pester' -join '>>')
		}
		It 'Hashtable testcase multiple key' {
			$baseMock.Data = @{Name = 'Pester'; Data = 'Something' }
			New-TestItemId -AsString $baseMock |
				Should -Be $($baseMock.ScriptBlock.File, ($baseMock.Path -join '>>'), 'Data=Something>>Name=Pester' -join '>>')
		}
		It 'Works without file' {
			$baseMock.Scriptblock.File = $null
			$baseMock.Data = @{Name = 'Pester'; Data = 'Something' }
			New-TestItemId -AsString $baseMock |
				Should -Be $(($baseMock.Path -join '>>'), 'Data=Something>>Name=Pester' -join '>>')
		}
		It 'Works with Pester.Block' {
			$Block = Import-Clixml $Mocks/Block.clixml
			New-TestItemId $Block -AsString | Should -Be 'Describe Nested Foreach <name>>>Kind=Animal>>Name=giraffe>>Symbol=🦒'
		}
	}

	Context 'Expand-TestCaseName' {
		BeforeAll {
			. $PesterInterface -LoadFunctionsOnly
		}
		BeforeEach {
			$SCRIPT:baseMock = New-MockObject -Type Pester.Test
			$BaseMock.Name = 'Pester'
		}
		It 'Fails with wrong type' {
			$fake = [PSCustomObject]@{Name = 'Pester'; PSTypeName = 'NotATest' }
			{ Expand-TestCaseName -Test $fake } | Should -Throw '*is not a Pester Test or Pester Block*'
		}
		It 'Works with Array testcase' {
			$baseMock.Name = 'Array TestCase <_>'
			$baseMock.Data = @('pester')
			Expand-TestCaseName $baseMock | Should -Be 'Array TestCase pester'
		}
		It 'Works with Single Hashtable testcase' {
			$baseMock.Name = 'Array TestCase <Name>'
			$baseMock.Data = @{Name = 'pester' }
			Expand-TestCaseName $baseMock | Should -Be 'Array TestCase pester'
		}
		It 'Works with Multiple Hashtable testcase' {
			$baseMock.Name = 'Array <Data> TestCase <Name>'
			$baseMock.Data = @{Name = 'pester'; Data = 'aCoolTest' }
			Expand-TestCaseName $baseMock | Should -Be 'Array aCoolTest TestCase pester'
		}

		It 'Works with Pester.Block' {
			$Block = Import-Clixml $Mocks/Block.clixml
			Expand-TestCaseName $Block | Should -Be 'Describe Nested Foreach giraffe'
		}
	}
}
