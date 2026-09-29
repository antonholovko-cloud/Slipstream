# Memory / CPU benchmark: runs the app off-screen on the demo race with your saved layout
# for each tuning variant and reports private memory, CPU and process types.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\perf.ps1 [-Variants default,none,nogpu] [-Runs 2]
#   default = built-in tuning, none = no tuning, or a comma list: nospare,pps,heap,nogpu
param([string[]]$Variants = @('default', 'none'), [int]$Runs = 2)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$exe = Join-Path $repo 'node_modules\electron\dist\electron.exe'
$sp = Join-Path $env:TEMP 'slipstream-perf'
$cores = (Get-CimInstance Win32_Processor | Measure-Object NumberOfLogicalProcessors -Sum).Sum
$results = @()
foreach ($v in $Variants) {
  foreach ($r in 1..$Runs) {
    Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep 1
    $ud = Join-Path $sp ("ud-" + ($v -replace ',', '_') + "-$r")
    if (Test-Path $ud) { Remove-Item $ud -Recurse -Force }
    New-Item -ItemType Directory -Force $ud | Out-Null
    if (Test-Path "$env:APPDATA\Slipstream\overlay-config.json") { Copy-Item "$env:APPDATA\Slipstream\overlay-config.json" $ud }
    $env:IRO_USERDATA = $ud; $env:IRO_OFFSCREEN = '1'; $env:IRO_DEMO_SKIP = '300'
    # note: setting an env var to '' deletes it in PowerShell, so 'none' is passed as a real token
    if ($v -eq 'default') { Remove-Item Env:IRO_TUNE -ErrorAction SilentlyContinue } else { $env:IRO_TUNE = $v }
    Start-Process -FilePath $exe -ArgumentList '.', '--demo', '--hidden' -WorkingDirectory $repo -WindowStyle Hidden | Out-Null
    Start-Sleep 20
    $cpu1 = (Get-Process electron | Measure-Object CPU -Sum).Sum
    Start-Sleep 15
    $p2 = Get-Process electron
    $cpu2 = ($p2 | Measure-Object CPU -Sum).Sum
    $ids = $p2.Id
    $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids -contains $_.IDProcess }
    $priv = ($perf | Measure-Object WorkingSetPrivate -Sum).Sum / 1MB
    $types = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ForEach-Object {
      if ($_.CommandLine -match '--type=(\S+)') { $matches[1] } else { 'main' } } | Group-Object | ForEach-Object { "$($_.Name)=$($_.Count)" }
    $results += [pscustomobject]@{ Variant = $v; Run = $r; Procs = $p2.Count; PrivateMB = [math]::Round($priv); CpuPct = [math]::Round((($cpu2 - $cpu1) / 15) * 100 / $cores, 2); Types = ($types -join ' ') }
    Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
  }
}
Remove-Item Env:IRO_USERDATA, Env:IRO_OFFSCREEN, Env:IRO_TUNE, Env:IRO_DEMO_SKIP -ErrorAction SilentlyContinue
$results | Format-Table -AutoSize | Out-String -Width 220
