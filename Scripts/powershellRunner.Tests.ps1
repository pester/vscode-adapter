Describe 'PowershellRunner Primitive Types' {
  It '<Name>' {
    function Invoke-Runner ([ScriptBlock]$ScriptBlock) {
      ". C:\Users\JGrote\Projects\vscode-adapter\Scripts\powershellRunner.ps1 {$ScriptBlock}" | pwsh -noprofile -noni -c -
    }

    $runResult = Invoke-Runner $TestValue
    $result = ($runResult | ConvertFrom-Json)
    if (-not $Stream) { $Stream = 'Output' }
    $result.__PSStream | Should -Be $Stream
    $result.__PSType | Should -Be $Type
    if ($result.message -is [datetime]) {
      # Date compare after rehydration doesn't work for some reason
      $result.message = $result.message.ToUniversalTime().ToString('s')
    }
    $result.message | Should -Be $ExpectedResult

  } -TestCases @(
    @{
      Name           = 'int'
      TestValue      = { 1 }
      Type           = 'System.Int32'
      ExpectedResult = 1
    }
    @{
      Name           = 'string'
      TestValue      = { 'pester' }
      Type           = 'System.String'
      ExpectedResult = 'pester'
    }
    @{
      Name           = 'datetime'
      TestValue      = { Get-Date -Date '1/1/2025 3:22PM' }
      Type           = 'System.DateTime'
      ExpectedResult = Get-Date '2025-01-01T23:22:00.0000000'
    }
    @{
      Name           = 'verboseRecord'
      TestValue      = { Write-Verbose -Verbose 'PesterVerbose' }
      Type           = 'System.String'
      ExpectedResult = 'PesterVerbose'
      Stream         = 'Verbose'
    }
    @{
      Name           = 'warningRecord'
      TestValue      = { Write-Warning 'PesterWarning' }
      Type           = 'System.String'
      ExpectedResult = 'PesterWarning'
      Stream         = 'Warning'
    }
  )
}
