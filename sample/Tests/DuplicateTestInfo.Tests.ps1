Describe 'DuplicateTests' {
	It 'DuplicateTest' {}
	It 'DuplicateTest' {}
}

Describe 'DuplicateDescribes' {
	It 'Test' {}
}
Describe 'DuplicateDescribes' {
	It 'Test' {}
}

Describe 'DuplicateContexts' {
	Context 'DuplicateContext' {
		It 'Test' {}
	}
	Context 'DuplicateContext' {
		It 'Test2' {}
	}
}
