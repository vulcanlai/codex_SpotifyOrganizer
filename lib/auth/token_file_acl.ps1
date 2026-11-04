param(
    [Parameter(Mandatory=$true)][ValidateSet('create','apply','verify')][string]$Action,
    [Parameter(Mandatory=$true)][string]$FilePath,
    [Parameter(Mandatory=$true)][ValidatePattern('^S-1-5-21-(\d+-){3}\d+$')][string]$UserSid
)
# 不載入 profile、不解析語系相關的帳號名稱、不存取 Token 內容。
$ErrorActionPreference = 'Stop'
$sections = [System.Security.AccessControl.AccessControlSections]::Access
$changed = $false
$original = $null

function Test-SafeAcl($Acl) {
    if (!$Acl.AreAccessRulesProtected) { return $false }
    if ($Acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $UserSid) { return $false }
    $required = @{
        $UserSid = [int][System.Security.AccessControl.FileSystemRights]::Modify
        'S-1-5-18' = [int][System.Security.AccessControl.FileSystemRights]::FullControl
        'S-1-5-32-544' = [int][System.Security.AccessControl.FileSystemRights]::FullControl
    }
    $seen = @{}
    foreach ($rule in $Acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
        $sid = $rule.IdentityReference.Value
        if ($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or !$required.ContainsKey($sid)) { return $false }
        if ($rule.InheritanceFlags -ne 'None' -or $rule.PropagationFlags -ne 'None') { return $false }
        $rights = [int]$rule.FileSystemRights
        $maximum = $required[$sid] -bor [int][System.Security.AccessControl.FileSystemRights]::Synchronize
        if (($rights -band $maximum) -ne $rights) { return $false }
        $seen[$sid] = ($seen[$sid] -bor $rights)
    }
    foreach ($sid in $required.Keys) {
        if (($seen[$sid] -band $required[$sid]) -ne $required[$sid]) { return $false }
    }
    return $true
}

function New-TokenDacl {
    $replacement = New-Object System.Security.AccessControl.FileSecurity
    $replacement.SetAccessRuleProtection($true, $false)
    foreach ($entry in @(@($UserSid, 'Modify'), @('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'))) {
        $sid = New-Object System.Security.Principal.SecurityIdentifier($entry[0])
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $entry[1], 'Allow')
        [void]$replacement.AddAccessRule($rule)
    }
    return $replacement
}

try {
    if ([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne $UserSid) {
        @{ok=$false; reason='identity_mismatch'} | ConvertTo-Json -Compress
        exit 0
    }
    if ($Action -eq 'create') {
        # CreateNew 與 FileSecurity 在建立時即指定 DACL，尚未寫入任何內容。
        $stream = [System.IO.FileStream]::new($FilePath,
            [IO.FileMode]::CreateNew, ([Security.AccessControl.FileSystemRights]::Read -bor [Security.AccessControl.FileSystemRights]::Write),
            [IO.FileShare]::None, 4096, [IO.FileOptions]::None, (New-TokenDacl))
        $stream.Dispose()
    }
    $item = Get-Item -LiteralPath $FilePath -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        @{ok=$false; reason='not_regular_file'} | ConvertTo-Json -Compress
        exit 0
    }
    $acl = Get-Acl -LiteralPath $FilePath
    if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $UserSid) {
        @{ok=$false; reason='owner_mismatch'} | ConvertTo-Json -Compress
        exit 0
    }
    if ($Action -eq 'apply') {
        $original = $acl.GetSecurityDescriptorSddlForm($sections)
        # 先在記憶體組好完整授權，再一次提交 DACL。
        $replacement = New-TokenDacl
        # 只修改 Access，保留原擁有者與群組。
        $changed = $true
        [System.IO.File]::SetAccessControl($FilePath, $replacement)
    }
    if (!(Test-SafeAcl (Get-Acl -LiteralPath $FilePath))) {
        if ($Action -eq 'apply') { throw 'verification_failed' }
        @{ok=$false; reason='unsafe_acl'} | ConvertTo-Json -Compress
        exit 0
    }
    @{ok=$true} | ConvertTo-Json -Compress
} catch {
    $restored = $false
    if ($changed -and $null -ne $original) {
        try {
            $restore = New-Object System.Security.AccessControl.FileSecurity
            $restore.SetSecurityDescriptorSddlForm($original, $sections)
            [System.IO.File]::SetAccessControl($FilePath, $restore)
            $restored = (Get-Acl -LiteralPath $FilePath).GetSecurityDescriptorSddlForm($sections) -eq $original
        } catch { $restored = $false }
    }
    $reason = 'acl_operation_failed'
    if ($changed -and !$restored) { $reason = 'acl_restore_failed' }
    @{ok=$false; reason=$reason; recovery_attempted=$changed; recovery_succeeded=$restored} | ConvertTo-Json -Compress
}
