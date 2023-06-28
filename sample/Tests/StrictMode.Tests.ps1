BeforeAll {
	Set-StrictMode -Version Latest
}

Describe 'Tests' {
	It 'Should-Pass' {
		# This test should pass.
		. $PSScriptRoot/Mocks/StrictMode.ps1
	}
}
