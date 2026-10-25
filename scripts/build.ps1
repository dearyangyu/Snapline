param([switch]$PortableOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    if ($PortableOnly) { & npm.cmd run tauri -- build --no-bundle -- --locked }
    else { & npm.cmd run tauri -- build --bundles nsis -- --locked }
    if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }
    $releaseDir = Join-Path $projectRoot 'release'
    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'src-tauri\target\release\snapline.exe') -Destination (Join-Path $releaseDir 'Snapline.exe') -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $releaseDir -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination $releaseDir -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination $releaseDir -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'CONTRIBUTING.md') -Destination $releaseDir -Force
    if (-not $PortableOnly) {
        $bundleConfig = Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
        $installerName = '{0}_{1}_x64-setup.exe' -f $bundleConfig.productName, $bundleConfig.version
        $installerSource = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis\$installerName"
        if (-not (Test-Path -LiteralPath $installerSource -PathType Leaf)) {
            throw "Current-version Windows installer was not produced: $installerName"
        }
        Copy-Item -LiteralPath $installerSource -Destination (Join-Path $releaseDir $installerName) -Force
    }
    # Preserve relative README/notice links, including nested license files.
    foreach ($directory in @('docs', 'licenses')) {
        $sourceDirectory = Join-Path $projectRoot $directory
        $targetDirectory = Join-Path $releaseDir $directory
        New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
        foreach ($entry in Get-ChildItem -LiteralPath $sourceDirectory) {
            Copy-Item -LiteralPath $entry.FullName -Destination $targetDirectory -Recurse -Force
        }
    }
    Get-ChildItem -LiteralPath $releaseDir -Filter '*.exe' | ForEach-Object {
        $artifactHash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
        "$($artifactHash.Hash)  $($_.Name)"
    } | Set-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS.txt')
    Get-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS.txt')
} finally { Pop-Location }
