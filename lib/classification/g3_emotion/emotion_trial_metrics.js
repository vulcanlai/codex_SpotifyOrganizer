/**
 * 80 首情緒試驗 — 批次驗證指標（Phase 0 門檻）
 */
import { validate_emotion_inference } from './validate_emotion_inference.js';
import {
  label_evidence_used_is_title_only,
  label_has_actionable_emotion_without_evidence,
} from './emotion_evidence_rules.js';
import { EMOTION_REVIEW_PENDING } from './emotion_schema.js';

/** 試驗通過門檻（規格固定，變更須 bump TRIAL_METRICS_RULES_VERSION） */
export const TRIAL_METRICS_RULES_VERSION = 'g3_emotion_trial_metrics:v1';

export const TRIAL_SCHEMA_PASS_RATE_MIN = 0.95;
export const TRIAL_TITLE_ONLY_INFERRED_LABEL_RATE_MAX = 0.05;
export const TRIAL_FAKE_AUDIO_VERIFIED_MAX = 0;
export const TRIAL_PENDING_REVIEW_RATE_MIN = 1.0;

/**
 * @param {object[]} inferences 每首 validate 過的 inference 文件
 */
export function compute_emotion_trial_batch_metrics(inferences) {
  const list = inferences || [];
  const n = list.length;
  let schema_pass = 0;
  let schema_fail = 0;
  let total_labels = 0;
  let title_only_inferred_labels = 0;
  let fake_audio_verified = 0;
  let pending_review_labels = 0;
  let empty_label_tracks = 0;
  let tracks_with_labels = 0;
  let no_evidence_inferred_labels = 0;

  for (let i = 0; i < list.length; i += 1) {
    const inf = list[i];
    const val = validate_emotion_inference(inf);
    if (val.ok) {
      schema_pass += 1;
    } else {
      schema_fail += 1;
    }

    const labels = (inf && inf.emotion_labels) || [];
    if (!labels.length) {
      empty_label_tracks += 1;
    } else {
      tracks_with_labels += 1;
    }

    for (let j = 0; j < labels.length; j += 1) {
      const label = labels[j];
      total_labels += 1;
      if (label.review_status === EMOTION_REVIEW_PENDING || !label.review_status) {
        pending_review_labels += 1;
      }
      if (
        label.confidence === 'inferred' &&
        label_evidence_used_is_title_only(label.evidence_used || [])
      ) {
        title_only_inferred_labels += 1;
      }
      if (label_has_actionable_emotion_without_evidence(label)) {
        no_evidence_inferred_labels += 1;
      }
      const sonic = (label.evidence_axes && label.evidence_axes.sonic) || {};
      if (sonic.direct_audio_verified === true) {
        const basis = sonic.basis || [];
        const ok = basis.includes('direct_audio_feature') || basis.includes('human_listen_review');
        if (!ok) {
          fake_audio_verified += 1;
        }
      }
    }
  }

  const schema_pass_rate = n > 0 ? schema_pass / n : 0;
  const title_only_rate =
    total_labels > 0 ? title_only_inferred_labels / total_labels : 0;
  const pending_review_rate =
    total_labels > 0 ? pending_review_labels / total_labels : n > 0 ? 1 : 0;
  const no_evidence_rate =
    total_labels > 0 ? no_evidence_inferred_labels / total_labels : 0;

  const gates = {
    schema_pass_rate_ok: schema_pass_rate >= TRIAL_SCHEMA_PASS_RATE_MIN,
    title_only_inferred_rate_ok:
      title_only_rate <= TRIAL_TITLE_ONLY_INFERRED_LABEL_RATE_MAX,
    fake_audio_verified_ok: fake_audio_verified <= TRIAL_FAKE_AUDIO_VERIFIED_MAX,
    pending_review_rate_ok: pending_review_rate >= TRIAL_PENDING_REVIEW_RATE_MIN,
  };
  const trial_pass = Object.keys(gates).every(function (k) {
    return gates[k] === true;
  });

  return {
    rules_version: TRIAL_METRICS_RULES_VERSION,
    track_count: n,
    schema_pass,
    schema_fail,
    schema_pass_rate,
    total_emotion_labels: total_labels,
    title_only_inferred_labels,
    title_only_inferred_label_rate: title_only_rate,
    no_evidence_inferred_labels,
    no_evidence_inferred_label_rate: no_evidence_rate,
    fake_audio_verified_count: fake_audio_verified,
    pending_review_labels,
    pending_review_label_rate: pending_review_rate,
    empty_label_tracks,
    tracks_with_labels,
    gates: gates,
    trial_pass: trial_pass,
  };
}
