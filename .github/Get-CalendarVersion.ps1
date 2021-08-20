#requires -version 7
using namespace System.Management.Automation
Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

<#
.SYNOPSIS
Generates a CalendarVersion based on the current commit
#>
function Get-CalendarVersion {
	param(
		[string]$releaseBranchName = 'main'
	)
	$date = [DateTime]::Now
	$month = $date.Month.ToString().PadLeft(2, '0')
	$year = $date.Year
	[string]$datePrefix = $month, $year -join '.'

	#This version component is zero-based so it should be 0 for the first release of the month, 1 for the second, etc.
	$releaseCount = @(& git tag -l "v$DatePrefix*").count

	if ($releaseBranchName -eq [string](git describe --tags)) {
		return [SemanticVersion]::new($year, $month, $releaseCount)
	}

	[string]$currentBranchName = & git branch --show-current
	Write-Host "Current Branch Name: $currentBranchName"
	Get-ChildItem env: | Format-Table | Out-String | Write-Host

	$branchName = if ($currentBranchName -eq $releaseBranchName) {
		'beta'
	} else {
		$currentBranchName.split('/') | Select-Object -Last 1
	}

	[int]$commitsSince = @(& git log --oneline -- "$currentBranchName..HEAD").count
	$prereleaseTag = $branchName, $commitsSince.ToString().PadLeft(3, '0') -join '+'

	return [SemanticVersion]::new($year, $month, $releaseCount, $prereleaseTag)
}

Get-CalendarVersion
