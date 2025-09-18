BeforeDiscovery {
	$script:arrayOfHashtables = @(
		@{ Emoji = '🌵' ; Description = 'cactus' }
		@{ Emoji = '🦒' ; Description = 'giraffe' }
		@{ Emoji = '🍎' ; Description = 'apple' }
		@{ Emoji = '🐧' ; Description = 'penguin' }
		@{ Emoji = '😊' ; Description = 'smiling face with smiling eyes' }
	)

	$script:arrayOfObjects = @(
		[pscustomobject]@{ Emoji = '🌵' ; Description = 'cactus' }
		[System.Object]@{ Emoji = '🦒' ; Description = 'giraffe' }
		[pscustomobject]@{ Emoji = '🍎' ; Description = 'apple' }
		[pscustomobject]@{ Emoji = '🐧' ; Description = 'penguin' }
		[pscustomobject]@{ Emoji = '😊' ; Description = 'smiling face with smiling eyes' }
	)
}

Describe 'Issue 247' {
	Describe 'Template expansion' {
		Context 'Array of hashtables' {
			It 'Using PropertyName:   Returns <Emoji> (<Description>)' -ForEach $arrayOfHashtables {}
			It 'Using _.PropertyName: Returns <_.Emoji> (<_.Description>)' -ForEach $arrayOfHashtables {}
		}
		Context 'Array of objects' {
			It 'Using PropertyName:   Returns <Emoji> (<Description>)' -ForEach $arrayOfObjects {}
			It 'Using _.PropertyName: Returns <_.Emoji> (<_.Description>)' -ForEach $arrayOfObjects {}
		}
	}
}

Describe 'Pester Documentation V5' {
	BeforeAll {
		Get-Module PesterDemoFunctions | Remove-Module
		New-Module PesterDemoFunctions -ScriptBlock {
			$emojis = @(
				@{ Name = 'apple'; Symbol = '🍎'; Kind = 'Fruit' }
				@{ Name = 'beaming face with smiling eyes'; Symbol = '😁'; Kind = 'Face' }
				@{ Name = 'cactus'; Symbol = '🌵'; Kind = 'Plant' }
				@{ Name = 'giraffe'; Symbol = '🦒'; Kind = 'Animal' }
				@{ Name = 'pencil'; Symbol = '✏️'; Kind = 'Item' }
				@{ Name = 'penguin'; Symbol = '🐧'; Kind = 'Animal' }
				@{ Name = 'pensive'; Symbol = '😔'; Kind = 'Face' }
				@{ Name = 'slightly smiling face'; Symbol = '🙂'; Kind = 'Face' }
				@{ Name = 'smiling face with smiling eyes'; Symbol = '😊'; Kind = 'Face' }
			) | ForEach-Object { [PSCustomObject]$_ }

			function Get-Emoji ([string]$Name = '*') {
				$script:emojis | Where-Object Name -like $Name | ForEach-Object Symbol
			}

			function Get-EmojiKind {
				param(
					[Parameter(Mandatory = $true, ValueFromPipeline = $true)]
					[string]$Emoji
				)
				process {
					$script:emojis | Where-Object Symbol -eq $Emoji | Foreach-Object Kind
				}
			}

			$fruitBasket = [System.Collections.ArrayList]@('🍎', '🍌', '🥝', '🥑', '🍇', '🍐')

			function Get-FruitBasket {
				$script:fruitBasket
			}

			function Remove-FruitBasket {
				param(
					[Parameter(Mandatory = $true)]
					[string]$Item
				)
				$script:fruitBasket.Remove($Item)
			}

			function Reset-FruitBasket {
				$script:fruitBasket = [System.Collections.ArrayList]@('🍎', '🍌', '🥝', '🥑', '🍇', '🍐')
			}
		} | Import-Module
	}
	Context "Using -ForEach & -TestCases with hashtable" {
		Describe "Get-Emoji" {
			It "Returns <expected> (<name>)" -ForEach @(
				@{ Name = "cactus"; Expected = '🌵' }
				@{ Name = "giraffe"; Expected = '🦒' }
				@{ Name = "apple"; Expected = '🍎' }
				@{ Name = "pencil"; Expected = '✏️' }
				@{ Name = "penguin"; Expected = '🐧' }
				@{ Name = "smiling face with smiling eyes"; Expected = '😊' }
			) {
				Get-Emoji -Name $name | Should -Be $expected
			}
		}
		Describe "Get-Emoji <name>" -ForEach @(
			@{ Name = "cactus"; Symbol = '🌵'; Kind = 'Plant' }
			@{ Name = "giraffe"; Symbol = '🦒'; Kind = 'Animal' }
		) {
			It "Returns <symbol>" {
				Get-Emoji -Name $name | Should -Be $symbol
			}

			It "Has kind <kind>" {
				Get-Emoji -Name $name | Get-EmojiKind | Should -Be $kind
			}
		}
		Describe "Get-Emoji <name>" -ForEach @(
			@{
				Name   = "cactus";
				Symbol = '🌵';
				Kind   = 'Plant'
				Runes  = @(
					@{ Index = 0; Rune = 127797 }
				)
			}
			@{
				Name   = "pencil"
				Symbol = '✏️'
				Kind   = 'Item'
				Runes  = @(
					@{ Index = 0; Rune = 9999 }
					@{ Index = 1; Rune = 65039 }
				)
			}
		) {
			It "Returns <symbol>" {
				Get-Emoji -Name $name | Should -Be $symbol
			}

			It "Has kind <kind>" {
				Get-Emoji -Name $name | Get-EmojiKind | Should -Be $kind
			}

			Context "Runes (each character in multibyte emoji)" {
				It "Has rune <rune> on index <index>" -ForEach $runes {
					$actual = @((Get-Emoji -Name $name).EnumerateRunes())
					$actual[$index].Value | Should -Be $rune
				}
			}
		}
	}
	Context 'Using -ForEach & -TestCases with an array' {
		Describe "Get-FruitBasket" {
			It "Contains <_>" -ForEach '🍎', '🍌', '🥝', '🥑', '🍇', '🍐' {
				Get-FruitBasket | Should -Contain $_
			}

			Context "Fruit <_>" -ForEach '🍎', '🍌', '🥝', '🥑', '🍇', '🍐' {
				It "Contains <_> by default" {
					Get-FruitBasket | Should -Contain $_
				}

				It "Can remove <_> from the basket" {
					Remove-FruitBasket -Item $_
					Get-FruitBasket | Should -Not -Contain $_
				}
			}
			AfterAll {
				Reset-FruitBasket
			}
		}
	}
	Context 'Using <> templates' {
		BeforeAll {
			$script:apple = '🍎'
		}

		Describe "<apple>" {
			It "<apple> <animal>" -ForEach @(
				@{ Animal = "🐛" }
				@{ Animal = "🐶" }
			) {}
		}
		Describe "<banana>" {
			BeforeAll {
				$script:banana = '🍌'
			}

			BeforeEach {
				$script:giraffe = '🦒'
			}

			It "<banana> <giraffe> <animal>" {}
		}
		Describe "Animals " {
			It "<_>" -ForEach @("🐛", "🐶") {}
		}
	}
	Context 'Using dot-navigation in <> template' {
		Describe "Animals" {
			It "A <animal.emoji> (<name>) goes <animal.sound>" -ForEach @(
				@{
					Name   = "cow"
					Animal = @{
						Sound = "Mooo"
						Emoji = "🐄"
					}
				}
				@{
					Name   = "fox"
					Animal = @{
						Sound = "Ring-ding-ding-ding-dingeringeding!"
						Emoji = "🦊"
					}
				}
			) {}
		}
	}
	Context 'Escaping' {
		Describe 'with single quoted string' {
			Describe "Fruit <_>" -ForEach "🍎", "🍐" {
				It 'Getting <_> returns $null' {}
			}
			Describe 'When x `< 4, x: <_>' -ForEach @(1..4) {
				It 'x: `<<_>`>' {}
			}
		}
		Describe 'with double  quoted string' {
			Describe "Fruit <_>" -ForEach "🍎", "🍐" {
				It "Getting <_> returns `$null" {}
			}
			Describe "When x ``< 4, x: <_>" -ForEach @(1..4) {
				It "x: ``<<_>``>" {}
			}
		}
	}
}
