/** Shared interactive flow used by the BAT GUI and offline tests. */
import { run_data_import } from './import_run.js';
import { format_import_preview_zh } from './import_gui_messages.js';
import { IMPORT_APPLY_CONFIRM_TOKEN } from './constants.js';

export async function run_import_gui_flow({
  import_common,
  project_root,
  ask_confirm,
  log = console.log,
  run_import = run_data_import,
}) {
  let dry = await run_import({ ...import_common, dry_run: true });
  if (!dry.preview) {
    return { ok: false, reason_zh: '匯入預覽失敗：' + (dry.reason_zh || '未知錯誤') };
  }
  log(format_import_preview_zh(dry.preview, project_root));
  const authorization = {};
  if (!dry.ok && dry.preview.handoff.scenario === 'local_modified') {
    log('本機資料已修改。只有確認選定 ZIP 為權威來源，才可授權覆蓋對應資料（含分類資料）。');
    log('正式寫入前會自動建立並驗證可還原的本機備份；備份失敗即停止。');
    const allowed = await ask_confirm(
      '輸入 OVERWRITE 授權以這份 ZIP 覆蓋本機對應資料，其他輸入取消： ',
      'OVERWRITE'
    );
    if (!allowed) return { ok: true, cancelled: true };
    authorization.authorized_local_modified_manifest_sha256 = dry.preview.manifest_sha256;
    // Run all checks again with authorization; a broken chain still blocks apply.
    dry = await run_import({ ...import_common, ...authorization, dry_run: true });
    if (dry.preview) log(format_import_preview_zh(dry.preview, project_root));
  }
  if (!dry.ok || !dry.preview || dry.preview.handoff.allow_apply === false) {
    return {
      ok: false,
      reason_zh: dry.reason_zh || dry.preview?.handoff.reason_zh || '安全檢查不允許匯入',
    };
  }
  log('正式匯入會先自動備份並驗證成功，再寫入資料。');
  const go = await ask_confirm('是否正式匯入？輸入 yes 才會寫入，其他輸入取消： ', 'yes');
  if (!go) return { ok: true, cancelled: true };
  return run_import({
    ...import_common,
    ...authorization,
    apply: true,
    confirm_token: IMPORT_APPLY_CONFIRM_TOKEN,
  });
}
