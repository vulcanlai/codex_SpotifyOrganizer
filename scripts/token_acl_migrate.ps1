param(
 [Parameter(Mandatory=$true)][ValidateSet('preflight','authorize','snapshot','apply','verify','restore','recovery-status')][string]$Mode,
 [Parameter(Mandatory=$true)][string]$SourceRoot,
 [Parameter(Mandatory=$true)][string]$ProjectRoot,
 [string]$Confirmation='',
 [ValidateSet('production','lab')][string]$Scope='production',
 [ValidateSet('','after-apply')][string]$InjectFailure=''
)
# 正式模式從不讀取 Token 資料串流。lab 只接受 TEMP 內有標記的 dummy.txt。
$ErrorActionPreference='Stop'
$state=@{reason='operation_failed'}
$sections=[Security.AccessControl.AccessControlSections]::Access
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$user=$identity.User.Value
$parentGuard=$null;$targetGuard=$null;$snapshotGuard=$null
$operationMutex=$null;$mutexHeld=$false
$changed=$false;$data=$null;$store=$null;$canLog=$false
function Early-Stop([string]$Reason) {$state.reason=$Reason;throw 'acl_safety_stop'}
function Read-Approval {
 if ($Scope -eq 'production') {return [Environment]::GetEnvironmentVariable('SPOTIFYORG_AUTHORIZED_WINDOWS_SID','User')}
 $path=Join-Path $ProjectRoot 'lab-approval.txt'
 if (Test-Path -LiteralPath $path) {return [IO.File]::ReadAllText($path)}
 return $null
}
function Write-Approval($Value) {
 if ($Scope -eq 'production') {[Environment]::SetEnvironmentVariable('SPOTIFYORG_AUTHORIZED_WINDOWS_SID',$Value,'User')}
 else {[IO.File]::WriteAllText((Join-Path $ProjectRoot 'lab-approval.txt'),[string]$Value,[Text.UTF8Encoding]::new($false))}
}
function Require-Approval {if ((Read-Approval) -cne $user) {Stop-Acl 'authorization_required_or_mismatched'}}
function Read-TargetAcl {return (Get-Acl -LiteralPath $target).GetSecurityDescriptorSddlForm($sections)}
function Check-Target {
 Assert-AclPath $target
 if ((Get-Item -LiteralPath $target -Force).PSIsContainer) {Stop-Acl 'not_regular_file'}
 if ((Get-Acl -LiteralPath $target).GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user) {Stop-Acl 'owner_mismatch'}
 $info=[SpotifyTokenAcl.Native]::Inspect($target)
 if ($info.Links -ne 1) {Stop-Acl 'multiple_links_rejected'}
 return $info
}
function Helper-Acl([string]$Action) {
 Assert-AclPath $helper
 $q={param($v) "'"+$v.Replace("'","''")+"'"}
 $cmd='& ([scriptblock]::Create([IO.File]::ReadAllText('+(& $q $helper)+',[Text.Encoding]::UTF8))) '+(& $q $Action)+' '+(& $q $target)+' '+(& $q $user)
 $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
 $reply=& (Join-Path $PSHOME 'powershell.exe') -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded 2>$null
 if ($LASTEXITCODE -ne 0) {Stop-Acl 'helper_execution_failed'}
 try {$result=($reply -join "`n") | ConvertFrom-Json} catch {Stop-Acl 'helper_output_invalid'}
 return $result.ok -eq $true
}
function Check-Store {
 Assert-PrivateAcl $store $true
 foreach ($entry in Get-ChildItem -LiteralPath $store -Force) {
  if ($entry.PSIsContainer -or $entry.Name -notin @('original.bin','original.hmac','original.key','result.json')) {Stop-Acl 'unexpected_snapshot_entry'}
  Assert-PrivateAcl $entry.FullName $false
 }
}
function Load-Snapshot {
 Check-Store
 foreach ($file in @($snapshot,$signature,$keyFile)) {Assert-PrivateAcl $file $false}
 if ((Get-Item -LiteralPath $snapshot).Length -gt 1048576 -or (Get-Item -LiteralPath $signature).Length -gt 128 -or
     (Get-Item -LiteralPath $keyFile).Length -ne 32) {Stop-Acl 'snapshot_size_rejected'}
 $bytes=[IO.File]::ReadAllBytes($snapshot)
 if ((Acl-Mac $bytes ([IO.File]::ReadAllBytes($keyFile))) -cne [IO.File]::ReadAllText($signature).Trim()) {Stop-Acl 'snapshot_authentication_failed'}
 try {$saved=[Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json} catch {Stop-Acl 'invalid_snapshot'}
 if ($saved.version -ne 1 -or $saved.scope -cne $Scope -or $saved.target -cne $target -or $saved.project -cne $ProjectRoot -or
     $saved.owner -cne $user -or $saved.store -cne $store) {Stop-Acl 'snapshot_target_mismatch'}
 $now=Check-Target
 if ($now.Id -cne $saved.file_id -or $now.Created -cne $saved.created -or $now.Links -ne 1) {Stop-Acl 'file_identity_mismatch'}
 if ($Mode -ne 'verify' -and ($now.Written -cne $saved.written -or $now.Size -cne $saved.size)) {Stop-Acl 'target_data_metadata_changed'}
 if ([SpotifyTokenAcl.Native]::Inspect($ProjectRoot).Id -cne $saved.parent_id -or
     [SpotifyTokenAcl.Native]::Inspect($store).Id -cne $saved.store_id) {Stop-Acl 'directory_identity_mismatch'}
 if (!(Same-Acl (Get-Acl -LiteralPath $ProjectRoot).GetSecurityDescriptorSddlForm($sections) $saved.parent_dacl) -or
     !(Same-Acl (Get-Acl -LiteralPath $store).GetSecurityDescriptorSddlForm($sections) $saved.store_dacl)) {Stop-Acl 'parent_or_snapshot_acl_changed'}
 $raw=[Security.AccessControl.RawSecurityDescriptor]::new($saved.dacl)
 if ($null -eq $raw.DiscretionaryAcl -or $null -ne $raw.Owner -or $null -ne $raw.Group -or $null -ne $raw.SystemAcl) {Stop-Acl 'not_access_only_snapshot'}
 if ([bool]($raw.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne $saved.inheritance_disabled) {Stop-Acl 'snapshot_inheritance_mismatch'}
 return $saved
}
function Restore-Original($Saved) {
 # 先重新驗證持久快照與目標，然後只寫回 Access 區段。
 $valid=Load-Snapshot
 Set-AccessOnly $target $valid.dacl
 if (!(Same-Acl (Read-TargetAcl) $valid.dacl) -or (Get-Acl -LiteralPath $target).AreAccessRulesProtected -ne $valid.inheritance_disabled) {Stop-Acl 'restoration_not_confirmed'}
 [void](Check-Target)
}
function Emit($Result) {
 $Result.stage=$Mode
 $json=$Result | ConvertTo-Json -Compress
 if ($canLog -and $Mode -notin @('preflight','verify','recovery-status')) {
  $log=Join-Path $store 'result.json'
  if (Test-Path -LiteralPath $log) {Assert-PrivateAcl $log $false}
  [IO.File]::WriteAllText($log,$json,[Text.UTF8Encoding]::new($false))
 }
 $json
}

try {
 # 正式模式先拒絕沙箱，尚未檢查任何 Token 路徑或 HKCU 值。
 if ($Scope -eq 'production') {
  if ($InjectFailure) {Early-Stop 'production_test_injection_rejected'}
  if ($identity.Name -match '(?i)\\CodexSandbox') {Early-Stop 'sandbox_identity'}
  try {
   $account=[Security.Principal.NTAccount]::new([Environment]::MachineName,'CodexSandboxUsers')
   $sandbox=$account.Translate([Security.Principal.SecurityIdentifier]).Value
   if (@($identity.Groups | ForEach-Object {$_.Value}) -contains $sandbox) {Early-Stop 'sandbox_identity'}
  } catch [Security.Principal.IdentityNotMappedException] {}
 }
 if (([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {Early-Stop 'elevated_process_rejected'}
 if ($user -notmatch '^S-1-5-21-(\d+-){3}\d+$') {Early-Stop 'unsupported_identity'}
 $SourceRoot=[IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
 $ProjectRoot=[IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
 if ($Scope -eq 'production' -and $ProjectRoot -cne $SourceRoot) {Early-Stop 'production_path_mismatch'}
 if ($Scope -eq 'lab') {
  if ([IO.Path]::GetDirectoryName($ProjectRoot).TrimEnd('\') -ine [IO.Path]::GetTempPath().TrimEnd('\') -or
      [IO.Path]::GetFileName($ProjectRoot) -notmatch '^so-token-migrate-tests-[A-Za-z0-9]+$') {Early-Stop 'invalid_lab_path'}
  $marker=Join-Path $ProjectRoot 'lab-marker.txt'
 }
 $common=Join-Path $SourceRoot 'lib\auth\token_acl_snapshot.ps1'
 if ((Get-Item -LiteralPath $common -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {Early-Stop 'reparse_source_rejected'}
 . ([scriptblock]::Create([IO.File]::ReadAllText($common,[Text.Encoding]::UTF8)))
 Assert-AclPath $ProjectRoot
 if ($Scope -eq 'lab') {
  Assert-AclPath $marker
  if ((Get-Item -LiteralPath $marker).Length -gt 128 -or [SpotifyTokenAcl.Native]::Inspect($marker).Links -ne 1 -or
      (Get-Acl -LiteralPath $marker).GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user) {Stop-Acl 'invalid_lab_marker'}
  if ([IO.File]::ReadAllText($marker) -cne 'SpotifyOrganizer isolated ACL lab v1') {Stop-Acl 'invalid_lab_marker'}
 }
 $helper=Join-Path $SourceRoot 'lib\auth\token_file_acl.ps1'
 $target=Join-Path $ProjectRoot $(if ($Scope -eq 'lab') {'dummy.txt'} else {'.spotify_tokens.json'})
 $mutexTag=(Acl-Hash ([Text.Encoding]::UTF8.GetBytes($ProjectRoot.ToLowerInvariant()+'|'+$user))).Substring(0,32)
 $operationMutex=[Threading.Mutex]::new($false,('Local\SpotifyOrganizer.TokenAcl.'+$mutexTag))
 try {$mutexHeld=$operationMutex.WaitOne(0)} catch [Threading.AbandonedMutexException] {$mutexHeld=$true}
 if (!$mutexHeld) {Stop-Acl 'another_migration_running'}
 $parentGuard=[SpotifyTokenAcl.Native]::Guard($ProjectRoot,3)
 $targetGuard=[SpotifyTokenAcl.Native]::Guard($target,0)
 $meta=Check-Target
 $parentAcl=(Get-Acl -LiteralPath $ProjectRoot).GetSecurityDescriptorSddlForm($sections)
 $risk=$false
 foreach ($rule in (Get-Acl -LiteralPath $ProjectRoot).GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
  if ($rule.IdentityReference.Value -notin @($user,'S-1-5-18','S-1-5-32-544') -and $rule.AccessControlType -eq 'Allow' -and
      ([int64]$rule.FileSystemRights -band 0x50116)) {$risk=$true}
 }
 if ($Scope -eq 'lab') {$store=Join-Path $ProjectRoot 'recovery'}
 else {
  $base=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  Assert-AclPath $base
  $tag=(Acl-Hash ([Text.Encoding]::UTF8.GetBytes($ProjectRoot.ToLowerInvariant()+'|'+$user))).Substring(0,20)
  $store=Join-Path $base ('SpotifyOrganizer-TokenAclRecovery-'+$tag)
  $ancestor=$base
  while (![string]::IsNullOrEmpty($ancestor)) {
   if (Test-Path -LiteralPath (Join-Path $ancestor '.git')) {Stop-Acl 'snapshot_inside_repository_rejected'}
   $ancestor=[IO.Path]::GetDirectoryName($ancestor.TrimEnd('\'))
  }
 }
 $snapshot=Join-Path $store 'original.bin';$signature=Join-Path $store 'original.hmac';$keyFile=Join-Path $store 'original.key'
 if ($Mode -eq 'preflight') {
  Emit @{ok=$true;target=$target;owner_matches=$true;authorized=((Read-Approval) -ceq $user);parent_risk=$risk}
 } elseif ($Mode -eq 'authorize') {
  if ($Confirmation -cne '--confirm-owner') {Stop-Acl 'owner_confirmation_required'}
  $old=Read-Approval
  if (![string]::IsNullOrEmpty($old) -and $old -cne $user) {Stop-Acl 'existing_authorization_preserved'}
  try {Write-Approval $user;if ((Read-Approval) -cne $user) {throw 'approval_not_confirmed'}}
  catch {try {Write-Approval $old} catch {};Stop-Acl 'authorization_write_failed'}
  Emit @{ok=$true;authorized=$true;owner_matches=$true}
 } elseif ($Mode -eq 'snapshot') {
  Require-Approval
  if (Test-Path -LiteralPath $store) {
   $data=Load-Snapshot
   Emit @{ok=$true;snapshot_ready=$true;snapshot_reused=$true;snapshot_directory=$store}
  } else {
   [void][IO.Directory]::CreateDirectory($store,(Private-AclDirectory))
   Assert-PrivateAcl $store $true
   if (@(Get-ChildItem -LiteralPath $store -Force).Count -ne 0) {Stop-Acl 'existing_snapshot_preserved'}
   $snapshotGuard=[SpotifyTokenAcl.Native]::Guard($store,3)
   $canLog=$true
   $data=@{version=1;scope=$Scope;target=$target;project=$ProjectRoot;store=$store;owner=$user;
    file_id=$meta.Id;created=$meta.Created;written=$meta.Written;size=$meta.Size;
    parent_id=([SpotifyTokenAcl.Native]::Inspect($ProjectRoot)).Id;store_id=([SpotifyTokenAcl.Native]::Inspect($store)).Id;
    parent_dacl=$parentAcl;store_dacl=(Get-Acl -LiteralPath $store).GetSecurityDescriptorSddlForm($sections);
    dacl=(Read-TargetAcl);inheritance_disabled=(Get-Acl -LiteralPath $target).AreAccessRulesProtected}
   $bytes=[Text.Encoding]::UTF8.GetBytes(($data | ConvertTo-Json -Compress))
   $key=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
   try {$rng.GetBytes($key)} finally {$rng.Dispose()}
   New-AclBytes $keyFile $key;New-AclBytes $snapshot $bytes
   New-AclBytes $signature ([Text.Encoding]::ASCII.GetBytes((Acl-Mac $bytes $key)))
   [void](Load-Snapshot)
   Emit @{ok=$true;snapshot_ready=$true;snapshot_directory=$store}
  }
 } elseif ($Mode -eq 'verify') {
  Require-Approval
  if (!(Helper-Acl 'verify')) {Stop-Acl 'target_acl_not_secure'}
  Emit @{ok=$true;target=$target;target_verified=$true;parent_risk=$risk}
 } else {
  Check-Store
  $snapshotGuard=[SpotifyTokenAcl.Native]::Guard($store,3)
  $canLog=$true
  $data=Load-Snapshot
  if ($Mode -eq 'apply') {
   if ($Confirmation -cne '--confirm-acl') {Stop-Acl 'acl_confirmation_required'}
   Require-Approval
   if (!(Helper-Acl 'verify')) {
    if (!(Same-Acl (Read-TargetAcl) $data.dacl)) {Stop-Acl 'target_acl_changed_since_snapshot'}
    $changed=$true
    if (!(Helper-Acl 'apply')) {Stop-Acl 'acl_apply_failed'}
    if ($InjectFailure -eq 'after-apply') {Stop-Acl 'injected_lab_failure'}
   }
   Require-Approval
   if (!(Helper-Acl 'verify')) {Stop-Acl 'post_apply_verification_failed'}
   Emit @{ok=$true;target_verified=$true;snapshot_directory=$store;parent_risk=$risk}
  } elseif ($Mode -eq 'restore') {
   if ($Confirmation -cne '--confirm-original-acl') {Stop-Acl 'restore_confirmation_required'}
   Restore-Original $data
   Emit @{ok=$true;original_restored=$true;snapshot_directory=$store}
  } else {
   $same=Same-Acl (Read-TargetAcl) $data.dacl
   Emit @{ok=$true;original_restored=$same;snapshot_directory=$store}
  }
 }
} catch {
 $cause=$_.Exception;while ($null -ne $cause.InnerException) {$cause=$cause.InnerException}
 $failureReason=$state.reason
 $report=@{ok=$false;reason=$failureReason;error_type=$cause.GetType().Name;hresult=$cause.HResult}
 if ($cause -is [ComponentModel.Win32Exception]) {$report.win32_code=$cause.NativeErrorCode}
 if ($changed -and $null -ne $data) {
  $report.rollback_attempted=$true
  try {Restore-Original $data;$report.rollback_succeeded=$true} catch {$report.rollback_succeeded=$false}
 }
 if ($null -ne $store) {$report.snapshot_directory=$store}
 try {Emit $report} catch {$report | ConvertTo-Json -Compress}
} finally {
 foreach ($handle in @($snapshotGuard,$targetGuard,$parentGuard)) {if ($null -ne $handle) {$handle.Dispose()}}
 if ($null -ne $operationMutex) {if ($mutexHeld) {$operationMutex.ReleaseMutex()};$operationMutex.Dispose()}
}
