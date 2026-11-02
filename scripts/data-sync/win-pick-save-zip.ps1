# WinForms SaveFileDialog (ASCII-only script; titles passed from Node as Unicode argv)
param(
  [Parameter(Mandatory = $true)]
  [string]$ResultFile,
  [string]$InitialDirectory = '',
  [string]$DialogTitle = 'Export Spotify data (encrypted ZIP)',
  [string]$TraceFile = '',
  [switch]$TestInitOnly
)

$ErrorActionPreference = 'Stop'
$script:TraceSw = [System.Diagnostics.Stopwatch]::StartNew()

function Write-PickTrace {
  param(
    [string]$Phase,
    [hashtable]$Detail
  )
  if (-not $TraceFile) {
    return
  }
  $row = [ordered]@{
    t      = (Get-Date).ToString('o')
    ps_ms  = [int]$script:TraceSw.ElapsedMilliseconds
    pid    = $PID
    layer  = 'powershell'
    phase  = $Phase
  }
  if ($Detail) {
    foreach ($k in $Detail.Keys) {
      $row[$k] = $Detail[$k]
    }
  }
  $json = ($row | ConvertTo-Json -Compress)
  Add-Content -LiteralPath $TraceFile -Value $json -Encoding UTF8
}

try {
  Write-PickTrace 'ps_script_start' @{
    test_init_only    = [bool]$TestInitOnly
    initial_dir_arg   = $InitialDirectory
    initial_dir_empty = [string]::IsNullOrWhiteSpace($InitialDirectory)
  }

  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  Add-Type -AssemblyName System.Drawing | Out-Null

  if ($TestInitOnly) {
    [void](New-Object System.Windows.Forms.SaveFileDialog)
    Write-PickTrace 'test_init_only_done' @{}
    exit 0
  }

  $dialog = New-Object System.Windows.Forms.SaveFileDialog
  $dialog.Title = $DialogTitle
  $dialog.Filter = 'ZIP archive (*.zip)|*.zip|All files (*.*)|*.*'
  $dialog.DefaultExt = 'zip'
  $dialog.AddExtension = $true
  $dialog.OverwritePrompt = $false
  . (Join-Path $PSScriptRoot 'taiwan-zip-name.ps1')
  $dialog.FileName = Get-SpotifyHandoffFileName

  $initialResolved = ''
  if ($InitialDirectory -and (Test-Path -LiteralPath $InitialDirectory)) {
    $initialResolved = (Resolve-Path -LiteralPath $InitialDirectory).Path
    $dialog.InitialDirectory = $initialResolved
  }

  [System.Windows.Forms.Application]::EnableVisualStyles()
  Write-PickTrace 'before_show_dialog' @{ initial = $initialResolved }
  $result = $dialog.ShowDialog()
  Write-PickTrace 'after_show_dialog' @{ dialog_result = $result.ToString() }
  if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    exit 2
  }

  $picked = $dialog.FileName
  if (-not $picked) {
    Write-Error 'SaveFileDialog returned empty path'
    exit 1
  }

  if (-not [System.IO.Path]::IsPathRooted($picked) -and $initialResolved) {
    $picked = [System.IO.Path]::Combine($initialResolved, $picked)
  }

  # PS 5.1：Split-Path -LiteralPath 與 -Parent 不可同時使用（參數集衝突）
  $dir = [System.IO.Path]::GetDirectoryName($picked)
  Write-PickTrace 'picked_path_resolved' @{
    rooted = [System.IO.Path]::IsPathRooted($picked)
    dir    = $dir
  }
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($ResultFile, $picked, $utf8NoBom)
  Write-PickTrace 'result_file_written' @{}
  exit 0
}
catch {
  Write-PickTrace 'ps_error' @{ message = $_.Exception.Message }
  Write-Error ($_.Exception.Message)
  if ($_.ScriptStackTrace) {
    Write-Error ($_.ScriptStackTrace)
  }
  exit 1
}
