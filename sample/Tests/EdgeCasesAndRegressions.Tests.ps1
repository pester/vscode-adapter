Describe 'Edge Cases and Regressions' {
	It 'HaveParameter' {
		(Get-Command Get-ChildItem) | Should -HaveParameter Include
	}
}
