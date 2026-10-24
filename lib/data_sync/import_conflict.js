/**
 * 交接版本與衝突判斷（匯入＋匯出狀態、handoff 鏈，非僅 exported_at）
 */

/**
 * @param {object | null} import_state
 * @param {object | null} export_state
 */
/**
 * @param {object | null} import_state
 * @param {object | null} export_state
 * @returns {string | null}
 */
function resolve_local_handoff_tip(import_state, export_state) {
  const imp = import_state;
  const exp = export_state;
  if (imp && imp.corrupt) {
    return null;
  }
  if (exp && exp.corrupt) {
    return null;
  }
  if (imp && exp) {
    if (exp.handoff_previous_bundle_id === imp.last_bundle_id) {
      return exp.last_bundle_id;
    }
    if (
      imp.handoff_previous_bundle_id != null &&
      imp.handoff_previous_bundle_id === exp.last_bundle_id
    ) {
      return imp.last_bundle_id;
    }
    if (imp.last_bundle_id === exp.last_bundle_id) {
      return imp.last_bundle_id;
    }
    return imp.last_bundle_id;
  }
  if (imp) {
    return imp.last_bundle_id;
  }
  if (exp) {
    return exp.last_bundle_id;
  }
  return null;
}

/**
 * @param {object | null} import_state
 * @param {object | null} export_state
 */
function resolve_file_baselines(import_state, export_state) {
  const tip = resolve_local_handoff_tip(import_state, export_state);
  if (
    export_state &&
    !export_state.corrupt &&
    tip &&
    export_state.last_bundle_id === tip &&
    export_state.file_baselines
  ) {
    return export_state.file_baselines;
  }
  if (import_state && !import_state.corrupt && import_state.file_baselines) {
    return import_state.file_baselines;
  }
  if (export_state && !export_state.corrupt && export_state.file_baselines) {
    return export_state.file_baselines;
  }
  return {};
}

/**
 * @param {object} params
 * @param {object} params.manifest
 * @param {string} params.bundle_id
 * @param {object | null} params.import_state
 * @param {object | null} params.export_state
 * @param {{ path: string, local_sha256: string | null, incoming_sha256: string }[]} params.file_rows
 * @param {boolean} params.project_has_sync_relevant_files
 */
export function evaluate_import_handoff(params) {
  const imp = params.import_state;
  const exp = params.export_state;

  if (imp && imp.corrupt) {
    return {
      ok: false,
      scenario: 'state_inconsistent',
      reason_zh: imp.reason_zh || '匯入交接紀錄不一致',
    };
  }
  if (exp && exp.corrupt) {
    return {
      ok: false,
      scenario: 'state_inconsistent',
      reason_zh: exp.reason_zh || '匯出交接紀錄不一致',
    };
  }

  const incoming_prev =
    params.manifest.handoff_previous_bundle_id != null
      ? params.manifest.handoff_previous_bundle_id
      : null;

  const baselines = resolve_file_baselines(imp, exp);

  /** @type {string[]} */
  const local_modified = [];
  /** @type {string[]} */
  const unsafe = [];

  for (let i = 0; i < params.file_rows.length; i += 1) {
    const row = params.file_rows[i];
    const baseline = baselines[row.path];
    const local = row.local_sha256;
    const incoming = row.incoming_sha256;

    if (baseline && local && local !== baseline) {
      local_modified.push(row.path);
    }

    if (local && local !== incoming && baseline && local !== baseline) {
      unsafe.push(row.path);
    } else if (local && local !== incoming && !baseline && Object.keys(baselines).length > 0) {
      unsafe.push(row.path);
    }
  }

  if (local_modified.length > 0) {
    return {
      ok: false,
      scenario: 'local_modified',
      reason_zh:
        '本機資料已偏離上次交接基準（' +
        local_modified.slice(0, 3).join(', ') +
        (local_modified.length > 3 ? '…' : '') +
        '）',
      allow_apply: false,
      paths: local_modified,
    };
  }

  if (unsafe.length > 0) {
    return {
      ok: false,
      scenario: 'unsafe_conflict',
      reason_zh: '無法證明安全的檔案衝突：' + unsafe.slice(0, 3).join(', '),
      allow_apply: false,
      paths: unsafe,
    };
  }

  if (imp && imp.last_bundle_id === params.bundle_id) {
    return {
      ok: true,
      scenario: 'duplicate_bundle',
      reason_zh: '與上次成功匯入為同一份 bundle（可略過正式寫入）',
      allow_apply: true,
    };
  }

  if (
    imp &&
    incoming_prev &&
    incoming_prev === imp.last_bundle_id &&
    exp &&
    exp.handoff_previous_bundle_id === incoming_prev &&
    exp.last_bundle_id !== params.bundle_id
  ) {
    return {
      ok: false,
      scenario: 'handoff_branch',
      reason_zh:
        '偵測到交接分支：本機已匯出 bundle ' +
        exp.last_bundle_id +
        '，與匯入的 ' +
        params.bundle_id +
        ' 共用父節點，不得自動合併',
      allow_apply: false,
    };
  }

  if (!imp && !exp) {
    if (params.project_has_sync_relevant_files) {
      return {
        ok: false,
        scenario: 'local_data_no_state',
        reason_zh:
          '本機已有工作資料但無交接紀錄；請先在本機成功匯出一次以建立 last-export.json',
        allow_apply: false,
      };
    }
    return {
      ok: true,
      scenario: 'first_import',
      reason_zh: incoming_prev
        ? '初次匯入（空白專案；採用最新交接 ZIP，無需先匯入中間 bundle）'
        : '初次匯入（空白專案）',
      allow_apply: true,
    };
  }

  if (incoming_prev == null || incoming_prev === '') {
    if (imp || exp) {
      return {
        ok: false,
        scenario: 'state_inconsistent',
        reason_zh:
          'ZIP 缺少 handoff_previous_bundle_id，無法與現有交接狀態銜接（請使用新版 export-data 重新匯出）',
        allow_apply: false,
      };
    }
  }

  if (!imp && exp) {
    if (incoming_prev !== exp.last_bundle_id) {
      return {
        ok: false,
        scenario: 'state_inconsistent',
        reason_zh:
          '匯入 ZIP 的父 bundle（' +
          incoming_prev +
          '）與本機 last-export（' +
          exp.last_bundle_id +
          '）不符',
        allow_apply: false,
      };
    }
    return {
      ok: true,
      scenario: 'export_handoff_continuation',
      reason_zh: '接續本機上次匯出後的往返交接（last-export 基準一致）',
      allow_apply: true,
    };
  }

  if (imp) {
    const tip = resolve_local_handoff_tip(imp, exp);
    if (incoming_prev !== tip) {
      return {
        ok: false,
        scenario: 'handoff_chain_break',
        reason_zh:
          '交接鏈中斷：匯入 ZIP 父 bundle 為 ' +
          (incoming_prev || '（無）') +
          '，本機交接 tip 為 ' +
          (tip || '（無）'),
        allow_apply: false,
      };
    }
    if (exp && !exp.corrupt) {
      return {
        ok: true,
        scenario: 'continuation_ok',
        reason_zh: '正常接續本機匯入／匯出交接鏈',
        allow_apply: true,
      };
    }
    return {
      ok: true,
      scenario: 'continuation_ok',
      reason_zh: '正常接續 last-import 交接鏈',
      allow_apply: true,
    };
  }

  return {
    ok: false,
    scenario: 'state_inconsistent',
    reason_zh: '無法判定交接情境',
    allow_apply: false,
  };
}
