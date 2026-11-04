/** 固定假檔案的實機測試入口；不載入 config、Token 或 OAuth。 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const commands = new Set(['run', 'restore', 'status']);
const command = process.argv[2] || 'run';
if (process.platform !== 'win32' || process.argv.length > 3 || !commands.has(command)) {
  console.error('用法：node scripts/acl-recovery-test.js [run|restore|status]；僅限 Windows，不接受目標路徑。');
  process.exitCode = 1;
} else {
  const script = fileURLToPath(new URL('./acl_recovery_test.ps1', import.meta.url));
  const helper = fileURLToPath(new URL('../lib/auth/token_file_acl.ps1', import.meta.url));
  const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const literal = value => "'" + value.replaceAll("'", "''") + "'";
  const modes = command === 'run' ? ['prepare', 'write-original', 'restrict', 'restore', 'status'] : [command];
  for (const mode of modes) {
    // 短的固定 loader 避免接近 Windows 32K 命令列上限；不改變 ExecutionPolicy。
    const source = `& ([scriptblock]::Create([IO.File]::ReadAllText(${literal(script)},[Text.Encoding]::UTF8))) ${literal(mode)} ${literal(helper)}`;
    const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(source, 'utf16le').toString('base64')], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024,
    });
    let report;
    try { report = JSON.parse(String(result.stdout || '').trim().replace(/^\uFEFF/, '')); }
    catch { report = { ok: false, stage: mode, reason: 'tool_output_unavailable' }; }
    if (result.error || result.status !== 0) report = { ok: false, stage: mode, reason: 'tool_execution_failed' };
    // 報告只含工具自己建立的固定欄位，不轉送例外或子程序原始輸出。
    const safe = { ok: report.ok === true, stage: mode };
    for (const key of ['reason', 'error_type', 'error_id', 'line', 'hresult', 'win32_code', 'directory', 'restored', 'cleanup_eligible']) {
      if (report[key] !== undefined) safe[key] = report[key];
    }
    console.log(JSON.stringify(safe));
    if (!safe.ok) {
      console.error('測試停止，診斷資料保留；可另開程序執行 restore 或 status。勿操作真實 Token。');
      process.exitCode = 1;
      break;
    }
  }
}
