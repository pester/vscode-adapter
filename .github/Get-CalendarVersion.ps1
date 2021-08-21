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
		#The branch where releases are produced. Untagged releases will have the "beta" label
		[string]$releaseBranchName = 'main',
		#Add the build number to the release number. Basically replace the "+" with a "-"
		[switch]$MergeBuild
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
	if (-not $currentBranchName -and $env:GITHUB_REF) {
		$currentBranchName = $env:GITHUB_REF
	}

	Write-Verbose "Current Branch Name: $currentBranchName"

	[string]$branchName = if ($currentBranchName -eq $releaseBranchName) {
		'beta'
	} elseif ($currentBranchName -match '^refs/pull/(\d+)/merge$') {
		'pr' + $matches[1]
		Write-Verbose "Pull Request Branch Detected, branchname is now pr$($matches[1])"
	} else {
		$currentBranchName.split('/') | Select-Object -Last 1
	}

	$delimiter = $MergeBuild ? '+' : '-'
	[int]$commitsSince = @(& git log --oneline -- "$currentBranchName..HEAD").count
	[string]$prereleaseTag = $branchName, $commitsSince.ToString().PadLeft(3, '0') -join $delimiter

	return [SemanticVersion]::new($year, $month, $releaseCount, $prereleaseTag)
}

Get-CalendarVersion
