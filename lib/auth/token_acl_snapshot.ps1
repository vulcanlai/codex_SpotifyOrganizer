# 遷移／復原專用共用元件。呼叫端提供 $user 與 $state；不讀取目標檔案內容。
function Stop-Acl([string]$Code) { $state.reason=$Code; throw 'acl_safety_stop' }
function Acl-Hash([byte[]]$Bytes) {
    $hash=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally {$hash.Dispose()}
}
function Acl-Mac([byte[]]$Bytes,[byte[]]$Key) {
    $mac=[Security.Cryptography.HMACSHA256]::new($Key)
    try { return ([BitConverter]::ToString($mac.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally {$mac.Dispose()}
}
function Assert-AclPath([string]$Path) {
    $item=Get-Item -LiteralPath $Path -Force
    while ($null -ne $item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {Stop-Acl 'reparse_path_rejected'}
        $parent=[IO.Path]::GetDirectoryName($item.FullName.TrimEnd('\'))
        if ([string]::IsNullOrEmpty($parent)) {break}
        $item=Get-Item -LiteralPath $parent -Force
    }
}
function Same-Acl([string]$Left,[string]$Right) {
    $a=[Security.AccessControl.RawSecurityDescriptor]::new($Left)
    $b=[Security.AccessControl.RawSecurityDescriptor]::new($Right)
    if ($null -eq $a.DiscretionaryAcl -or $null -eq $b.DiscretionaryAcl) {return $false}
    $mask=-bnot [int][Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited
    if (([int]$a.ControlFlags -band $mask) -ne ([int]$b.ControlFlags -band $mask)) {return $false}
    $ab=New-Object byte[] $a.DiscretionaryAcl.BinaryLength
    $bb=New-Object byte[] $b.DiscretionaryAcl.BinaryLength
    $a.DiscretionaryAcl.GetBinaryForm($ab,0); $b.DiscretionaryAcl.GetBinaryForm($bb,0)
    return [Convert]::ToBase64String($ab) -ceq [Convert]::ToBase64String($bb)
}
function Private-AclDirectory {
    $acl=[Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @($user,'S-1-5-18','S-1-5-32-544')) {
        $id=[Security.Principal.SecurityIdentifier]::new($sid)
        [void]$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($id,'FullControl','ContainerInherit, ObjectInherit','None','Allow'))
    }
    return $acl
}
function Assert-PrivateAcl([string]$Path,[bool]$Directory) {
    Assert-AclPath $Path
    $item=Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer -ne $Directory) {Stop-Acl 'snapshot_entry_type_mismatch'}
    $acl=Get-Acl -LiteralPath $Path
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user) {Stop-Acl 'snapshot_owner_mismatch'}
    if ($Directory -and !$acl.AreAccessRulesProtected) {Stop-Acl 'unsafe_snapshot_directory'}
    $seen=@{}
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        $sid=$rule.IdentityReference.Value
        if ($sid -notin @($user,'S-1-5-18','S-1-5-32-544') -or $rule.AccessControlType -ne 'Allow' -or
            [int]$rule.FileSystemRights -ne [int][Security.AccessControl.FileSystemRights]::FullControl) {Stop-Acl 'unsafe_snapshot_acl'}
        if ($Directory -and ($rule.IsInherited -or $rule.InheritanceFlags -ne 'ContainerInherit, ObjectInherit' -or $rule.PropagationFlags -ne 'None')) {Stop-Acl 'unsafe_snapshot_acl'}
        $seen[$sid]=$true
    }
    if ($seen.Count -ne 3) {Stop-Acl 'unsafe_snapshot_acl'}
    $info=[SpotifyTokenAcl.Native]::Inspect($Path)
    if (!$Directory -and $info.Links -ne 1) {Stop-Acl 'snapshot_multiple_links'}
}
function New-AclBytes([string]$Path,[byte[]]$Bytes) {
    $stream=[IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$stream.Write($Bytes,0,$Bytes.Length);$stream.Flush($true)} finally {$stream.Dispose()}
}
function Set-AccessOnly([string]$Path,[string]$Sddl) {
    $raw=[Security.AccessControl.RawSecurityDescriptor]::new($Sddl)
    if ($null -eq $raw.DiscretionaryAcl -or $null -ne $raw.Owner -or $null -ne $raw.Group -or $null -ne $raw.SystemAcl) {Stop-Acl 'not_access_only_snapshot'}
    $acl=[Security.AccessControl.FileSecurity]::new()
    $acl.SetSecurityDescriptorSddlForm($Sddl,[Security.AccessControl.AccessControlSections]::Access)
    [IO.File]::SetAccessControl($Path,$acl)
}

# 以零資料存取權讀取識別／時間／大小；鎖定只限制分享，不讀取資料串流。
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace SpotifyTokenAcl {
 public sealed class Metadata { public string Id, Created, Written, Size; public uint Links; }
 public static class Native {
  [StructLayout(LayoutKind.Sequential)] struct Info {public uint Attributes,CLo,CHi,ALo,AHi,WLo,WHi,Volume,SizeHi,SizeLo,Links,IdHi,IdLo;}
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string n,uint a,uint s,IntPtr p,uint d,uint f,IntPtr t);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
  public static SafeFileHandle Guard(string path,uint sharing) {
   var h=CreateFileW(path,0,sharing,IntPtr.Zero,3,0x02000000,IntPtr.Zero);
   if(h.IsInvalid) {int e=Marshal.GetLastWin32Error();h.Dispose();throw new Win32Exception(e);} return h;
  }
  public static Metadata Inspect(string path) {
   using(var h=Guard(path,7)) {Info i;if(!GetFileInformationByHandle(h,out i))throw new Win32Exception(Marshal.GetLastWin32Error());
    return new Metadata {Id=i.Volume.ToString("X8")+":"+i.IdHi.ToString("X8")+i.IdLo.ToString("X8"),Created=i.CHi.ToString("X8")+i.CLo.ToString("X8"),Written=i.WHi.ToString("X8")+i.WLo.ToString("X8"),Size=i.SizeHi.ToString("X8")+i.SizeLo.ToString("X8"),Links=i.Links};}
  }
 }
}
'@
