/**
 * G3-E.1 後續 140 / 1476 續跑設計（本階段不執行）
 */
export function build_g3_e1_continuation_plan() {
  return {
    schema_version: 1,
    design_only: true,
    batch_size_recommended: '5–10',
    phases: ['prepare', 'infer', 'validate', 'audit', 'stage', 'adopt'],
    adopt_enabled: false,
    queues: {
      provenance_unverified_140: {
        source: 'g3-d5 provenance_unverified batch 04–17',
        strategy_zh: '逐批 infer；禁止 build_batches 式 BY_ID 腳本寫入',
      },
      d1_rule_repair_remaining: {
        source: 'G3-D.1 200 以外未重跑之列',
        strategy_zh: '同 E.1 workflow；與 D.3/D.4 並存不覆寫',
      },
      library_unclassified_1476: {
        source: '全庫尚未 AI 分類（約 1,476）',
        strategy_zh: '離線 stratify → prepare inputs → Agent infer → validate',
      },
    },
    resume: {
      progress_file: 'batch-progress.json',
      fields: ['last_completed_batch', 'track_ids_done', 'failed_track_ids'],
      idempotency: 'skip if output_hash exists for same input_hash',
    },
    retry: {
      max_attempts: 3,
      on_fail: 'record in failed-track.json; do not rule_fallback',
    },
    quality_gates: {
      every_n_batches: 5,
      checks: ['unknown_ratio', 'duplicate_reason', 'provenance_unverified_count'],
    },
    fail_closed_zh: 'infer 缺列 → 停止；不得 g3_d1_evidence_classify 補位',
  };
}
