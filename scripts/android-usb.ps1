param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$jobs = @()

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE." }
}

function Wait-ForLocalService {
    param([System.Management.Automation.Job]$Job, [string]$Url, [string]$ReadyMessage)
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    $started = !$ReadyMessage
    while ([DateTime]::UtcNow -lt $deadline -and $Job.State -notin 'Completed', 'Failed', 'Stopped') {
        if (!$started) { $started = @(Receive-Job -Job $Job -ErrorAction Continue) -contains $ReadyMessage }
        if ($started) {
            try {
                if ((Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { return }
            } catch { }
        }
        Start-Sleep -Milliseconds 500
    }
    Receive-Job -Job $Job -ErrorAction Continue | Write-Host
    throw "Service did not become ready at $Url."
}

function Get-LocalPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        $listener.LocalEndpoint.Port
    } finally { $listener.Stop() }
}

function Test-ApkBundle {
    param([string]$Path)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $bundle = $archive.GetEntry('assets/index.android.bundle')
        return $null -ne $bundle -and $bundle.Length -gt 0
    } finally { $archive.Dispose() }
}

function Install-WorkspaceDependencies {
    $pnpm = @('pnpm@10.28.1')
    $maxLength = [int](Invoke-Checked corepack.cmd ($pnpm + @('config', 'get', 'virtualStoreDirMaxLength')) |
        Select-Object -Last 1)
    if ($maxLength -le 0) { throw 'Could not read the pnpm virtual-store directory length.' }

    $modulesFile = Join-Path $root 'node_modules/.modules.yaml'
    $hasModules = Test-Path -LiteralPath $modulesFile -PathType Leaf
    $expectedLayout = "(?m)^virtualStoreDirMaxLength:\s*$maxLength\s*$"
    $layoutChanged = $hasModules -and ((Get-Content -LiteralPath $modulesFile -Raw) -notmatch $expectedLayout)
    if ($layoutChanged -or !$hasModules -or !(Test-Path -LiteralPath 'mobile/node_modules/metro/package.json')) {
        $installArgs = $pnpm + @('install', '--frozen-lockfile')
        if ($layoutChanged) {
            Write-Host 'Relinking dependencies with shorter Windows paths.'
            $installArgs += '--force'
        }
        $previousCI = $env:CI
        try {
            $env:CI = 'true'
            Invoke-Checked corepack.cmd $installArgs
        } finally {
            $env:CI = $previousCI
        }
    }
}

Push-Location -LiteralPath $root
try {
    if (!$env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
    if (!$env:JAVA_HOME) {
        $studioJdk = Join-Path $env:ProgramFiles 'Android/Android Studio/jbr'
        if (Test-Path -LiteralPath (Join-Path $studioJdk 'bin/java.exe')) { $env:JAVA_HOME = $studioJdk }
    }
    $adb = Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
    if (!(Test-Path -LiteralPath $adb -PathType Leaf)) { throw "ADB is missing at $adb." }
    try {
        $deviceList = @(Invoke-Checked $adb @('devices'))
    } catch {
        throw "ADB failed before it could list USB devices. $($_.Exception.Message)"
    }
    $devices = @($deviceList | Where-Object { $_ -match '^\S+\s+device\s*$' } |
        ForEach-Object { ($_ -split '\s+')[0] })
    if ($devices.Count -ne 1) {
        if ($deviceList -match '^\S+\s+unauthorized\s*$') { throw 'Unlock the phone and accept the USB debugging prompt.' }
        throw 'Connect exactly one Android device with USB debugging enabled.'
    }
    $serial = $devices[0]

    if (!$SkipBuild) {
        $gradle = Join-Path $root 'mobile/android/gradlew.bat'
        if (!(Test-Path -LiteralPath $gradle -PathType Leaf)) { throw 'The mobile/android project is missing.' }
        Install-WorkspaceDependencies
        $abi = (Invoke-Checked $adb @('-s', $serial, 'shell', 'getprop', 'ro.product.cpu.abi') | Out-String).Trim()
        if ($abi -notin 'arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86') { throw "Unsupported Android CPU architecture: $abi." }
        Write-Host "Building the Android debug APK for $abi with Gradle."
        $previousApi = $env:APP_PUBLIC_API_URL
        $previousAuth = $env:APP_PUBLIC_ENABLE_LOCAL_AUTH
        try {
            $env:APP_PUBLIC_API_URL = 'http://127.0.0.1:4321'
            $env:APP_PUBLIC_ENABLE_LOCAL_AUTH = '1'
            Invoke-Checked $gradle @('-p', (Split-Path -Parent $gradle), ':app:assembleDebug',
                "-PreactNativeArchitectures=$abi", '-PlevelmaxingUseMetro=false')
        } finally {
            $env:APP_PUBLIC_API_URL = $previousApi
            $env:APP_PUBLIC_ENABLE_LOCAL_AUTH = $previousAuth
        }
    }
    $outputDirectory = Join-Path $root 'mobile/android/app/build/outputs/apk/debug'
    $apk = Join-Path $outputDirectory 'app-debug.apk'
    if (!(Test-Path -LiteralPath $apk -PathType Leaf)) { throw "Android debug APK is missing at $apk." }
    $metadata = Get-Content -LiteralPath (Join-Path $outputDirectory 'output-metadata.json') -Raw | ConvertFrom-Json
    $applicationId = [string]$metadata.applicationId
    if ($applicationId -ne 'org.levelmaxing.app') { throw "Unexpected APK application ID: $applicationId." }
    $needsMetro = !(Test-ApkBundle $apk)
    Write-Host "Installing $apk"
    Invoke-Checked $adb @('-s', $serial, 'install', '-r', $apk)
    $installed = @(Invoke-Checked $adb @('-s', $serial, 'shell', 'pm', 'path', $applicationId))
    if (!($installed -match '^package:')) { throw 'Android did not report an installed Levelmaxing APK.' }
    Write-Host 'Android confirmed the APK is installed.'

    # ADB reverse preserves the phone's HTTP Host header. Match the backend listener port.
    $apiPort = 4321
    $null = Invoke-Checked $adb @('-s', $serial, 'reverse', "tcp:$apiPort", "tcp:$apiPort")

    Invoke-Checked node.exe @('scripts/create-local-access.mjs')
    $jobs += Start-Job -ArgumentList $root, $apiPort -ScriptBlock {
        param($RepoRoot, $Port)
        Set-Location -LiteralPath $RepoRoot
        $env:LEVELMAXING_MODE = 'local'
        $env:LEVELMAXING_PORT = [string]$Port
        node.exe --env-file=.local/access.env backend/src/node.ts
    }
    Wait-ForLocalService $jobs[0] "http://127.0.0.1:$apiPort/healthz" ('{"event":"api.listening","port":' + $apiPort + '}')
    if ($needsMetro) {
        $metroPort = Get-LocalPort
        $null = Invoke-Checked $adb @('-s', $serial, 'reverse', 'tcp:8081', "tcp:$metroPort")
        $jobs += Start-Job -ArgumentList $root, $metroPort -ScriptBlock {
            param($RepoRoot, $Port)
            Set-Location -LiteralPath (Join-Path $RepoRoot 'mobile')
            $env:APP_PUBLIC_API_URL = 'http://127.0.0.1:4321'
            $env:APP_PUBLIC_ENABLE_LOCAL_AUTH = '1'
            node.exe scripts/metro.cjs start --port $Port
        }
        Wait-ForLocalService $jobs[1] "http://127.0.0.1:$metroPort/status"
    }

    $launch = @(Invoke-Checked $adb @('-s', $serial, 'shell', 'am', 'start', '-W', '-a',
        'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', $applicationId))
    $launch | Write-Host
    if (!($launch -match '^Status: ok\s*$')) { throw 'Android did not confirm the activity launch.' }
    Start-Sleep -Seconds 2
    try {
        $running = @(Invoke-Checked $adb @('-s', $serial, 'shell', 'pidof', $applicationId))
    } catch {
        throw "Could not confirm the Levelmaxing process after launch. $($_.Exception.Message)"
    }
    if (!($running -match '^\d+(\s+\d+)*\s*$')) { throw 'Android did not report a running Levelmaxing process after launch.' }
    Write-Host 'APK installed and Android activity started. Use the participant token in .local/access.env to sign in.'
    $null = Read-Host 'Press Enter after testing to stop the local test services'
} finally {
    $jobs | Stop-Job -ErrorAction SilentlyContinue
    $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
    Pop-Location
}
