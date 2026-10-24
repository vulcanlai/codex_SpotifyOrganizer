# WinForms SaveFileDialog (ASCII-only script; titles passed from Node as Unicode argv)
param(
  [Parameter(Mandatory = $true)]
  [string]$ResultFile,
  [string]$InitialDirectory = '',
  [string]$DialogTitle = 'Export Spotify data (encrypted ZIP)',
  [switch]$TestInitOnly
)

$ErrorActionPreference = 'Stop'

try {
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  Add-Type -AssemblyName System.Drawing | Out-Null

  if ($TestInitOnly) {
    [void](New-Object System.Windows.Forms.SaveFileDialog)
    exit 0
  }

  $dialog = New-Object System.Windows.Forms.SaveFileDialog
  $dialog.Title = $DialogTitle
  $dialog.Filter = 'ZIP archive (*.zip)|*.zip|All files (*.*)|*.*'
  $dialog.DefaultExt = 'zip'
  $dialog.AddExtension = $true
  $dialog.OverwritePrompt = $false
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $dialog.FileName = "spotify-handoff-$stamp.zip"

  if ($InitialDirectory -and (Test-Path -LiteralPath $InitialDirectory)) {
    $dialog.InitialDirectory = (Resolve-Path -LiteralPath $InitialDirectory).Path
  }

  [System.Windows.Forms.Application]::EnableVisualStyles()
  $result = $dialog.ShowDialog()
  if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    exit 2
  }

  $picked = $dialog.FileName
  if (-not $picked) {
    Write-Error 'SaveFileDialog returned empty path'
    exit 1
  }

  $dir = Split-Path -LiteralPath $picked -Parent
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($ResultFile, $picked, $utf8NoBom)
  exit 0
}
catch {
  Write-Error ($_.Exception.Message)
  if ($_.ScriptStackTrace) {
    Write-Error ($_.ScriptStackTrace)
  }
  exit 1
}
