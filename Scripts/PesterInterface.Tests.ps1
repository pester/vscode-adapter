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
    }
    It 'Basic.Tests Discovery' {
      $paths = "$testDataPath/Tests/Basic.Tests.ps1"
      & $PesterInterface -Path $paths -Discovery -PipeName $PipeOutPath -DryRun 6>$null
      Get-Content $PipeOutPath | ConvertFrom-Json | ForEach-Object label | Should -HaveCount 58
    }
		It 'Simple Test Run' {
			$paths = "$testDataPath/Tests/True.Tests.ps1"
			& $PesterInterface -Path $paths -PipeName $PipeOutPath -DryRun 6>$null
			Get-Content $PipeOutPath | ConvertFrom-Json | ForEach-Object label | Should -HaveCount 2 -Because 'One for test start and one for test result'
		}
    It 'Syntax Error' {
      $paths = "$testDataPath/Tests/ContextSyntaxError.Tests.ps1",
      "$testDataPath/Tests/DescribeSyntaxError.Tests.ps1"
      & $PesterInterface -Path $paths -Discovery -PipeName $PipeOutPath -DryRun 6>$null
      $testResult = Get-Content $PipeOutPath | ConvertFrom-Json
      $testResult.id | Should -HaveCount 2
      $testResult | Where-Object id -Match 'Describesyntaxerror' | ForEach-Object error | Should -Match 'Missing closing'
      $testResult | Where-Object id -Match 'ContextSyntaxError' | ForEach-Object error | Should -Match 'Missing expression'
    }
		It 'BeforeAll Error' {
      $paths = "$testDataPath/Tests/BeforeAllError.Tests.ps1"
      & $PesterInterface -Path $paths -PipeName $PipeOutPath -DryRun 6>$null
      $testResult = Get-Content $PipeOutPath | ConvertFrom-Json
      $testResult.id | Should -Match 'TESTDESCRIBE$'
			$testResult.error | Should -Match 'Fails in Describe Block'
    }
  }
  Context 'New-TestItemId' {
    BeforeAll {
			Import-Module $PSScriptRoot\PesterTestPlugin.psm1 -Force
		}
		AfterAll {
			Remove-Module PesterTestPlugin
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
			Import-Module $PSScriptRoot\PesterTestPlugin.psm1 -Force
		}
		AfterAll {
			Remove-Module PesterTestPlugin
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

	Context 'Get-DurationString' {
		BeforeAll {
			Import-Module $PSScriptRoot\PesterTestPlugin.psm1 -Force
		}
		AfterAll {
			Remove-Module PesterTestPlugin
		}
    It 'Duration Format <Name>' {
      $mockTestParameter = [PSCustomObject] @{
        UserDuration      = $UserDuration
        FrameworkDuration = $FrameworkDuration
      }
      $getDurationStringResult = Get-DurationString $mockTestParameter
      $getDurationStringResult | Should -Be $Expected
    } -TestCases @(
      @{
        Name              = 'Both'
        UserDuration      = 10000
        FrameworkDuration = 20000
        Expected          = '(1ms|2ms)'
      },
      @{
        Name              = 'Null UserDuration'
        UserDuration      = $null
        FrameworkDuration = 20000
        Expected          = $null
      },
      @{
        Name              = 'Null FrameworkDuration'
        UserDuration      = 10000
        FrameworkDuration = $null
        Expected          = $null
      }
    )
  }
}
