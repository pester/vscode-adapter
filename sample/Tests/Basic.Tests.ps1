
Context 'Test' {
    It 'test' {
        $true
    }
}
Describe 'Basic' {

    Context 'Succeeds' {
        It 'True' { $true }
        It 'False' { $false }
        It 'ShouldBeTrue' { $true | Should -Be $true }
    }
    Context 'Fails' {
        It 'Throws' { throw 'Kaboom' }
        It 'ShouldThrow' { { $true } | Should -Throw }
        It 'ShouldBeTrue' { $false | Should -Be $true }
        It 'ShouldBeGreaterThan' { 1 | Should -BeGreaterThan 2 }
    }
    It 'Describe-Level Succeeds' { $true | Should -Be $true }
    It 'Describe-Level Fails' { $true | Should -Be $false }
}

Describe 'TestCases' {
    It 'TestCase Array <_>' {
        $_ | Should -Not -BeNullOrEmpty
    } -TestCases @(
        1
        2
        'red'
        'blue'
    )
    It 'TestCase HashTable <Name>' {
        $_ | Should -Not -BeNullOrEmpty
    } -TestCases @(
        @{Name = 1 }
        @{Name = 2 }
        @{Name = 'red' }
        @{Name = 'blue' }
    )
}

Describe 'Describe Nested Foreach <name> <symbol>' -ForEach @(
    @{ Name = 'cactus'; Symbol = '🌵'; Kind = 'Plant' }
    @{ Name = 'giraffe'; Symbol = '🦒'; Kind = 'Animal' }
) {
    It 'Returns <symbol>' { $true }

    It 'Has kind <kind>' { $true }

    It 'Nested Hashtable TestCase <kind> <name>' { $true } -TestCases @{
        Name = 'test'
    }
    It 'Nested Array TestCase <kind> <_>' { $true } -TestCases @(
        'Test'
    )
    It 'Nested Multiple Hashtable TestCase <kind> <name> <symbol>' { $true } -TestCases @(
        @{
            Name = 'Pester1'
        }
        @{
            Name = 'Pester2'
        }
    )

    Context 'Context Nested Foreach <name> <ContextValue>' -Foreach @(
        @{ ContextValue = 'Test1' }
        @{ ContextValue = 'Test2' }
    ) {
        It 'Describe Context Nested Array <name> <contextvalue> <_>' -TestCases @(
            'Test1'
            'Test2'
        ) {$true}
    }
}

# Edge cases that may occur during editing

Describe 'Empty Describe' {}
Describe 'Duplicate Describe' {}
Describe 'Duplicate Describe' {}
Describe 'Duplicate DescribeWithContext' {
    Context 'DupeContext' {
        It 'DupeContext' { $true }
    }
}
# Describe 'Duplicate DescribeWithContext' {
#     Context 'DupeContext' {
#         It 'DupeContext' { $true }
#     }
# }