# WinForms OpenFileDialog (ASCII-only script; title passed from Node as Unicode argv)
param(
  [Parameter(Mandatory = $true)]
  [string]$ResultFile,
  [string]$InitialDirectory = '',
  [string]$Title = 'Select encrypted ZIP to import',
  [string]$TraceFile = '',
  [switch]$TestInitOnly,
  [switch]$OpenProbeOnly
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
    open_probe_only   = [bool]$OpenProbeOnly
    test_init_only    = [bool]$TestInitOnly
    initial_dir_arg   = $InitialDirectory
    initial_dir_empty = [string]::IsNullOrWhiteSpace($InitialDirectory)
  }

  Write-PickTrace 'before_add_type' @{}
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  Add-Type -AssemblyName System.Drawing | Out-Null
  Write-PickTrace 'after_add_type' @{}

  if ($TestInitOnly) {
    [void](New-Object System.Windows.Forms.OpenFileDialog)
    Write-PickTrace 'test_init_only_done' @{}
    exit 0
  }

  Write-PickTrace 'before_new_open_dialog' @{}
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  Write-PickTrace 'after_new_open_dialog' @{}

  $dialog.Title = $Title
  $dialog.Filter = 'ZIP archive (*.zip)|*.zip|All files (*.*)|*.*'
  $dialog.CheckFileExists = $true
  $dialog.Multiselect = $false
  Write-PickTrace 'dialog_props_set' @{}

  $initialApplied = $false
  $initialResolved = ''
  if ($InitialDirectory) {
    Write-PickTrace 'before_test_path' @{ path = $InitialDirectory }
    $pathExists = Test-Path -LiteralPath $InitialDirectory
    Write-PickTrace 'after_test_path' @{ exists = $pathExists }
    if ($pathExists) {
      Write-PickTrace 'before_resolve_path' @{}
      $initialResolved = (Resolve-Path -LiteralPath $InitialDirectory).Path
      Write-PickTrace 'after_resolve_path' @{ resolved = $initialResolved }
      $dialog.InitialDirectory = $initialResolved
      $initialApplied = $true
    }
  }
  Write-PickTrace 'initial_directory_done' @{
    applied = $initialApplied
    resolved = $initialResolved
  }

  Write-PickTrace 'before_enable_visual_styles' @{}
  [System.Windows.Forms.Application]::EnableVisualStyles()
  Write-PickTrace 'after_enable_visual_styles' @{}

  if ($OpenProbeOnly) {
    Write-PickTrace 'open_probe_only_exit' @{ note = 'ShowDialog skipped' }
    exit 0
  }

  Write-PickTrace 'before_show_dialog' @{}
  $result = $dialog.ShowDialog()
  Write-PickTrace 'after_show_dialog' @{ dialog_result = $result.ToString() }
  if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    exit 2
  }

  $picked = $dialog.FileName
  if (-not $picked) {
    Write-Error 'OpenFileDialog returned empty path'
    exit 1
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($ResultFile, $picked, $utf8NoBom)
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
