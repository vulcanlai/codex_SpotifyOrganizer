/** 正式遷移入口：不載入 config／Token store，不接受目標路徑、SID 或測試模式。 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('./token_acl_migrate.ps1', import.meta.url));
const command = process.argv[2];
const flags = { preflight: null, prepare: '--confirm-owner', apply: '--confirm-acl', verify: null,
  restore: '--confirm-original-acl', 'recovery-status': null };
const expected = flags[command];
const valid = Object.hasOwn(flags, command) && (expected ? process.argv.length === 4 && process.argv[3] === expected : process.argv.length === 3);
if (process.platform !== 'win32' || !valid) {
  console.error('用法：token-acl-migrate.js preflight | prepare --confirm-owner | apply --confirm-acl | verify | restore --confirm-original-acl | recovery-status；不接受路徑或 SID。');
  process.exitCode = 1;
} else {
  const q = value => "'" + value.replaceAll("'", "''") + "'";
  const modes = command === 'prepare' ? ['preflight','authorize','snapshot']
    : command === 'apply' ? ['apply','verify'] : command === 'restore' ? ['restore','recovery-status'] : [command];
  const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  for (const mode of modes) {
    const source = `& ([scriptblock]::Create([IO.File]::ReadAllText(${q(script)},[Text.Encoding]::UTF8))) -Mode ${q(mode)} -SourceRoot ${q(project)} -ProjectRoot ${q(project)} -Confirmation ${q(expected || '')}`;
    const r = spawnSync(executable, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: 45000, maxBuffer: 1048576 });
    let result;
    try {result=JSON.parse(String(r.stdout || '').trim().replace(/^\uFEFF/,''));}
    catch {result={ok:false,reason:'migration_output_unavailable'};}
    if (r.error || r.status !== 0) result={ok:false,reason:'migration_execution_failed'};
    if (command === 'restore' && mode === 'recovery-status' && result.original_restored !== true) {
      result={...result,ok:false,reason:'restored_status_mismatch'};
    }
    const safe={ok:result.ok===true,stage:mode};
    for (const key of ['reason','error_type','hresult','win32_code','target','snapshot_directory','authorized','owner_matches',
      'parent_risk','snapshot_ready','snapshot_reused','target_verified','original_restored','rollback_attempted','rollback_succeeded']) {
      if (result[key] !== undefined) safe[key]=result[key];
    }
    console.log(JSON.stringify(safe));
    if (!safe.ok) {
      console.error('已停止。保留快照及診斷；不要執行 OAuth／刷新。若 ACL 已修改，可在同一正式帳號另開程序執行 restore --confirm-original-acl。');
      process.exitCode=1;
      break;
    }
  }
}
