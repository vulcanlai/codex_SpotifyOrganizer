param(
    [Parameter(Mandatory=$true)][ValidateSet('prepare','write-original','restrict','restore','status')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$HelperPath
)
# 本工具只操作固定的新測試目錄。所有快照均為 ACL 中繼資料，沒有檔案內容。
$ErrorActionPreference = 'Stop'
$sections = [Security.AccessControl.AccessControlSections]::Access
$current = [Security.Principal.WindowsIdentity]::GetCurrent()
$user = $current.User.Value
$root = $null
$canReport = $false
$state = @{reason='operation_failed'}

function Hash-Bytes([byte[]]$Bytes) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
    finally { $hash.Dispose() }
}
function Authenticate([byte[]]$Bytes,[byte[]]$Key) {
    $mac = [Security.Cryptography.HMACSHA256]::new($Key)
    try { return ([BitConverter]::ToString($mac.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
    finally { $mac.Dispose() }
}
function Fail([string]$Code) { $state.reason = $Code; throw 'safe_probe_failure' }
function Assert-NoReparse([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    while ($null -ne $item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail 'reparse_path_rejected' }
        $parent = [IO.Path]::GetDirectoryName($item.FullName.TrimEnd('\'))
        if ([string]::IsNullOrEmpty($parent)) { break }
        $item = Get-Item -LiteralPath $parent -Force
    }
}
function New-PrivateDirectoryAcl {
    $security = New-Object Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true,$false)
    foreach ($sidText in @($user,'S-1-5-18','S-1-5-32-544')) {
        $sid = New-Object Security.Principal.SecurityIdentifier($sidText)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit, ObjectInherit','None','Allow')
        [void]$security.AddAccessRule($rule)
    }
    return $security
}
function Assert-PrivateRoot {
    Assert-NoReparse $root
    $acl = Get-Acl -LiteralPath $root
    if (!$acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user) { Fail 'unsafe_test_directory' }
    $seen = @{}
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        $sid = $rule.IdentityReference.Value
        if ($sid -notin @($user,'S-1-5-18','S-1-5-32-544') -or $rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or
            [int]$rule.FileSystemRights -ne [int][Security.AccessControl.FileSystemRights]::FullControl -or
            $rule.InheritanceFlags -ne 'ContainerInherit, ObjectInherit' -or $rule.PropagationFlags -ne 'None') { Fail 'unsafe_test_directory' }
        $seen[$sid] = $true
    }
    if ($seen.Count -ne 3) { Fail 'unsafe_test_directory' }
    foreach ($item in Get-ChildItem -LiteralPath $root -Force) {
        if ($item.PSIsContainer -or $item.Name -notin @('dummy.txt','snapshot.bin','snapshot.hmac','snapshot.key','result.json') -or
            ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Fail 'unexpected_test_entry' }
    }
}
function Get-Metadata([string]$Path) {
    $info = [SpotifyAclProbe.Native]::Inspect($Path)
    if ($info.Links -ne 1) { Fail 'multiple_links_rejected' }
    return $info
}
function Assert-OwnedFile([string]$Path) {
    Assert-NoReparse $Path
    if ((Get-Item -LiteralPath $Path -Force).PSIsContainer) { Fail 'not_a_file' }
    if ((Get-Acl -LiteralPath $Path).GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user) { Fail 'owner_mismatch' }
    [void](Get-Metadata $Path)
}
function Write-NewBytes([string]$Path,[byte[]]$Bytes) {
    $stream = [IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.Write($Bytes,0,$Bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}
function Read-Snapshot {
    Assert-PrivateRoot
    foreach ($path in @($snapshot,$checksum,$keyFile,$target)) { Assert-OwnedFile $path }
    if ((Get-Item -LiteralPath $snapshot).Length -gt 1048576 -or (Get-Item -LiteralPath $checksum).Length -gt 128 -or
        (Get-Item -LiteralPath $keyFile).Length -ne 32) { Fail 'snapshot_size_rejected' }
    $bytes = [IO.File]::ReadAllBytes($snapshot)
    if ((Authenticate $bytes ([IO.File]::ReadAllBytes($keyFile))) -cne [IO.File]::ReadAllText($checksum).Trim()) { Fail 'snapshot_authentication_failed' }
    try { $data = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json } catch { Fail 'invalid_snapshot' }
    if ($data.version -ne 1 -or $data.target -cne 'dummy.txt' -or $data.owner -cne $user -or $data.root -cne $root) { Fail 'snapshot_target_mismatch' }
    $info = Get-Metadata $target
    $rootInfo = [SpotifyAclProbe.Native]::Inspect($root)
    if ($info.Id -cne $data.file_id -or $info.Created -cne $data.created -or $rootInfo.Id -cne $data.directory_id) { Fail 'file_identity_mismatch' }
    if ((Get-Acl -LiteralPath $root).GetSecurityDescriptorSddlForm($sections) -cne $data.directory_dacl) { Fail 'directory_acl_changed' }
    $raw = New-Object Security.AccessControl.RawSecurityDescriptor($data.dacl)
    if ($null -eq $raw.DiscretionaryAcl -or $null -ne $raw.Owner -or $null -ne $raw.Group -or $null -ne $raw.SystemAcl) { Fail 'not_access_only_snapshot' }
    $protected = [bool]($raw.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected)
    if ($protected -ne $data.inheritance_disabled) { Fail 'snapshot_inheritance_mismatch' }
    return $data
}
function Same-Dacl([string]$Left,[string]$Right) {
    $a = New-Object Security.AccessControl.RawSecurityDescriptor($Left)
    $b = New-Object Security.AccessControl.RawSecurityDescriptor($Right)
    if ($null -eq $a.DiscretionaryAcl -or $null -eq $b.DiscretionaryAcl) { return $false }
    # Windows 寫回時可自行補上 AUTO_INHERITED 資訊旗標；不忽略保護狀態或任何 ACE。
    $mask = -bnot [int][Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited
    if (([int]$a.ControlFlags -band $mask) -ne ([int]$b.ControlFlags -band $mask)) { return $false }
    $ab = New-Object byte[] $a.DiscretionaryAcl.BinaryLength
    $bb = New-Object byte[] $b.DiscretionaryAcl.BinaryLength
    $a.DiscretionaryAcl.GetBinaryForm($ab,0)
    $b.DiscretionaryAcl.GetBinaryForm($bb,0)
    return [Convert]::ToBase64String($ab) -ceq [Convert]::ToBase64String($bb)
}
function Restore-Dacl($Data) {
    # 與正式 helper 相同：新 FileSecurity，只匯入 Access，再用 .NET 寫回。
    $security = New-Object Security.AccessControl.FileSecurity
    $security.SetSecurityDescriptorSddlForm($Data.dacl,$sections)
    [IO.File]::SetAccessControl($target,$security)
    $actual = Get-Acl -LiteralPath $target
    if (!(Same-Dacl $actual.GetSecurityDescriptorSddlForm($sections) $Data.dacl) -or $actual.AreAccessRulesProtected -ne $Data.inheritance_disabled) { Fail 'restoration_not_confirmed' }
    Assert-OwnedFile $target
    if ([IO.File]::ReadAllText($target) -cne 'FAKE ACL TEST DATA ONLY') { Fail 'fake_data_changed' }
    [IO.File]::WriteAllText($target,'FAKE ACL TEST DATA ONLY',[Text.Encoding]::ASCII)
}
function Report($Result) {
    $Result.stage = $Mode
    $json = $Result | ConvertTo-Json -Compress
    if ($canReport -and $Mode -ne 'status') {
        $resultPath = Join-Path $root 'result.json'
        if (Test-Path -LiteralPath $resultPath) { Assert-OwnedFile $resultPath }
        [IO.File]::WriteAllText($resultPath,$json,[Text.UTF8Encoding]::new($false))
    }
    $json
}

try {
    if ([IO.Path]::GetFileName($HelperPath) -cne 'token_file_acl.ps1') { Fail 'invalid_helper_path' }
    Assert-NoReparse $HelperPath
    if ((New-Object Security.Principal.WindowsPrincipal($current)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Fail 'elevated_process_rejected' }
    if ($user -notmatch '^S-1-5-21-(\d+-){3}\d+$') { Fail 'unsupported_test_identity' }
    $base = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    Assert-NoReparse $base
    $ancestor = $base
    while (![string]::IsNullOrEmpty($ancestor)) {
        if (Test-Path -LiteralPath (Join-Path $ancestor '.git')) { Fail 'temp_inside_repository_rejected' }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor.TrimEnd('\'))
    }
    $tag = (Hash-Bytes ([Text.Encoding]::UTF8.GetBytes($user))).Substring(0,16)
    $root = Join-Path $base ('spotify-acl-probe-v1-'+$tag)
    $target = Join-Path $root 'dummy.txt'
    $snapshot = Join-Path $root 'snapshot.bin'
    $checksum = Join-Path $root 'snapshot.hmac'
    $keyFile = Join-Path $root 'snapshot.key'
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace SpotifyAclProbe {
  public sealed class Metadata { public string Id; public string Created; public uint Links; }
  public static class Native {
    [StructLayout(LayoutKind.Sequential)] struct Info {
      public uint Attributes, CLo, CHi, ALo, AHi, WLo, WHi, Volume, SizeHi, SizeLo, Links, IdHi, IdLo;
    }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern SafeFileHandle CreateFileW(string n,uint a,uint s,IntPtr p,uint d,uint f,IntPtr t);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
    public static Metadata Inspect(string path) {
      using(var h=CreateFileW(path,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
        if(h.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        Info i; if(!GetFileInformationByHandle(h,out i)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return new Metadata { Id=i.Volume.ToString("X8")+":"+i.IdHi.ToString("X8")+i.IdLo.ToString("X8"), Created=i.CHi.ToString("X8")+i.CLo.ToString("X8"), Links=i.Links };
      }
    }
  }
}
'@
    if ($Mode -eq 'prepare') {
        if (Test-Path -LiteralPath $root) { Fail 'existing_directory_preserved' }
        [void][IO.Directory]::CreateDirectory($root,(New-PrivateDirectoryAcl))
        Assert-PrivateRoot
        if (@(Get-ChildItem -LiteralPath $root -Force).Count -ne 0) { Fail 'directory_not_empty' }
        $canReport = $true
        Write-NewBytes $target ([Text.Encoding]::UTF8.GetBytes('FAKE ACL TEST DATA ONLY'))
        Assert-OwnedFile $target
        $acl = Get-Acl -LiteralPath $target
        $info = Get-Metadata $target
        $data = @{version=1;target='dummy.txt';root=$root;owner=$user;file_id=$info.Id;created=$info.Created;
            directory_id=([SpotifyAclProbe.Native]::Inspect($root)).Id;
            directory_dacl=(Get-Acl -LiteralPath $root).GetSecurityDescriptorSddlForm($sections);
            dacl=$acl.GetSecurityDescriptorSddlForm($sections);inheritance_disabled=$acl.AreAccessRulesProtected}
        $bytes = [Text.Encoding]::UTF8.GetBytes(($data | ConvertTo-Json -Compress))
        $key = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($key) } finally { $rng.Dispose() }
        Write-NewBytes $keyFile $key
        Write-NewBytes $snapshot $bytes
        Write-NewBytes $checksum ([Text.Encoding]::ASCII.GetBytes((Authenticate $bytes $key)))
        [void](Read-Snapshot)
        Report @{ok=$true;directory=$root;cleanup_eligible=$false}
    } else {
        Assert-PrivateRoot
        $canReport = $true
        $data = Read-Snapshot
        if ($Mode -in @('restore','write-original')) {
            Restore-Dacl $data
            Report @{ok=$true;directory=$root;restored=$true;cleanup_eligible=($Mode -eq 'restore')}
        } elseif ($Mode -eq 'restrict') {
            $source = [IO.File]::ReadAllText($HelperPath,[Text.Encoding]::UTF8)
            $literal = {param($v) "'"+$v.Replace("'","''")+"'"}
            $cmd = '& {'+"`n"+$source+"`n"+'} apply '+(& $literal $target)+' '+(& $literal $user)
            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
            $reply = & (Join-Path $PSHOME 'powershell.exe') -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded 2>$null
            if ($LASTEXITCODE -ne 0) { Fail 'helper_execution_failed' }
            try { $result = ($reply -join "`n") | ConvertFrom-Json } catch { Fail 'helper_output_invalid' }
            if ($result.ok -ne $true) { Fail 'helper_restrict_failed' }
            [void](Read-Snapshot)
            Report @{ok=$true;directory=$root;cleanup_eligible=$false}
        } else {
            $actual = Get-Acl -LiteralPath $target
            $same = Same-Dacl $actual.GetSecurityDescriptorSddlForm($sections) $data.dacl
            Report @{ok=$true;directory=$root;restored=$same;cleanup_eligible=$same}
        }
    }
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    $result = @{ok=$false;reason=$state.reason;cleanup_eligible=$false}
    if ($null -ne $root) { $result.directory=$root }
    $result.hresult=$cause.HResult
    $result.error_type=$cause.GetType().Name
    $result.line=$_.InvocationInfo.ScriptLineNumber
    $id = ($_.FullyQualifiedErrorId -split ',')[0]
    if ($id -match '^[A-Za-z0-9_]+$') { $result.error_id=$id }
    if ($cause -is [ComponentModel.Win32Exception]) { $result.win32_code=$cause.NativeErrorCode }
    # 驗證未通過時不寫入既有目錄，以免覆蓋診斷資料。
    try { Report $result } catch { $result | ConvertTo-Json -Compress }
}
