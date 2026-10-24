/**
 * G3-E.1 audit：來源與品質
 */
export function audit_g3_e1_run(run_manifest, validate_report) {
  const entries = run_manifest.entries || [];
  let all_have_hash = true;
  for (let i = 0; i < entries.length; i += 1) {
    if (!entries[i].input_hash || !entries[i].output_hash) {
      all_have_hash = false;
    }
    if (entries[i].model_api_session_id) {
      throw new Error('audit 發現虛構 session_id');
    }
  }

  return {
    schema_version: 1,
    track_count: entries.length,
    all_input_output_hashes: all_have_hash,
    provenance_unverified_all: true,
    agent_workflow_declared_all: true,
    validate_ok: validate_report.validate_ok === true,
    alternative_audit_zh: [
      '保存 inputs/*-input.json 與 staged-inferences/* 之 hash 對照',
      'run-manifest-infer.json 逐首紀錄',
      '可選：匯出 Cursor chat 片段至 g3-e1-pilot-5/agent-transcript-excerpt.md（本 repo 未自動寫入）',
    ],
    cannot_claim_zh: '不得聲稱具 API session 級 provenance；source 欄位非獨立證明',
  };
}
