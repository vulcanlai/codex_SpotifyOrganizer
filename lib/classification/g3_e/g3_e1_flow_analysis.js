/**
 * G3-E.1 現有流程角色說明（衍生文件）
 */
export function build_g3_e1_pipeline_flow_analysis() {
  return {
    schema_version: 1,
    purpose_zh: '釐清哪些步驟產生曲風、哪些僅驗證；檔名含 agent 不等於模型推理',
    components: [
      {
        id: 'g3_d1_offline_plan',
        role: 'prepare',
        decides_genre: false,
        proves_model: false,
        note_zh: '產生 batch-inputs／evidence_payloads',
      },
      {
        id: 'g3_d1_evidence_classify.js',
        role: 'rule_infer',
        decides_genre: true,
        proves_model: false,
        note_zh: 'artist／album／composer regex 與 heuristic；method g3_d1_cursor_ai 為誤導性標籤',
      },
      {
        id: 'g3:d1-generate-cursor-drafts',
        role: 'rule_infer',
        decides_genre: true,
        proves_model: false,
        note_zh: '呼叫 g3_d1_evidence_classify，非 Cursor 模型',
      },
      {
        id: 'g3_d4_write_batches_01_03.js',
        role: 'embedded_agent_module',
        decides_genre: true,
        proves_model: false,
        note_zh: 'Agent 填寫之 JS 模組；無 session log → attested_module_no_session_log',
      },
      {
        id: 'build_batches_04_17.mjs',
        role: 'script_catalog',
        decides_genre: true,
        proves_model: false,
        note_zh: 'BY_ID 映射寫 JSON；D.5 provenance_unverified',
      },
      {
        id: 'g3_d3_agent_repair_drafts.js',
        role: 'embedded_agent_module',
        decides_genre: true,
        proves_model: false,
        note_zh: '30 首修復樣本模組',
      },
      {
        id: 'validate_g3_d4_agent_batch',
        role: 'validate',
        decides_genre: false,
        proves_model: false,
        note_zh: '字典／結構／反 D.1 模板；不產生分類',
      },
      {
        id: 'validate_g3_b_ai_draft',
        role: 'validate',
        decides_genre: false,
        proves_model: false,
        note_zh: 'G3-B 草稿驗證',
      },
      {
        id: 'g3_e1_pipeline',
        role: 'e1_workflow',
        decides_genre: false,
        proves_model: 'partial',
        note_zh: 'prepare→infer→validate→audit→stage；infer 缺則 fail-closed',
      },
    ],
    what_proves_model_zh: [
      '可驗證的 API/session 紀錄（本環境通常無）',
      'E.1 run-manifest 之 input/output hash + 對應 staged 檔 + Agent 回覆存檔（若使用者保存 chat）',
    ],
    source_string_only_zh: 'cursor_agent_*、inference_source 欄位僅為宣告，非獨立執行證明',
  };
}
