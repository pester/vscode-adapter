Describe 'PowerShellRunner Types' {
  It '<Name>' {
    function Invoke-Runner ([ScriptBlock]$ScriptBlock) {
      ". C:\Users\JGrote\Projects\vscode-adapter\Scripts\powershellRunner.ps1 {$ScriptBlock}" | pwsh -noprofile -noni -c - 2>$null
    }

    $runResult = Invoke-Runner $TestValue
		#The last message is a script finished message, not relevant to this test
		$result = ($runResult | ConvertFrom-Json | Select-Object -SkipLast 1)
    $result.__PSStream | Should -Be $Stream
    $result.__PSType | Should -Be $Type
    if ($result.message -is [datetime]) {
      # Date compare after rehydration doesn't work for some reason
      $result = $result.ToUniversalTime().ToString('s')
    }
    $result | Should -Be $ExpectedResult

  } -TestCases @(
    @{
      Name           = 'int'
      TestValue      = { 1 }
      ExpectedResult = 1
    }
    @{
      Name           = 'double'
      TestValue      = { -1.5 }
      ExpectedResult = -1.5
    }
    @{
      Name           = 'string'
      TestValue      = { 'pester' }
      ExpectedResult = 'pester'
    }
    @{
      Name           = 'datetime'
      TestValue      = { Get-Date -Date '1/1/2025 3:22PM' }
      ExpectedResult = Get-Date '2025-01-01T15:22:00.0000000'
    }
  )
}
