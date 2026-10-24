/**
 * G3 證據條目（保留來源，不僅合併值）
 */

export const EVIDENCE_PRIORITY = {
  manual_confirmed: 1,
  sourced_fact: 2,
  ai_suggestion: 3,
  rule_inference: 4,
  unknown: 5,
};

/**
 * @param {object} opts
 */
export function evidence_entry(opts) {
  const o = opts || {};
  return {
    field: o.field || '',
    value: o.value,
    source: o.source || 'unknown',
    source_ref: o.source_ref || null,
    obtained_at: o.obtained_at || null,
    is_direct_fact: !!o.is_direct_fact,
    is_inference: !!o.is_inference,
    is_ai_candidate: !!o.is_ai_candidate,
    pending_verification: !!o.pending_verification,
    priority_rank:
      typeof o.priority_rank === 'number'
        ? o.priority_rank
        : EVIDENCE_PRIORITY.unknown,
    conflicts: (o.conflicts || []).slice(),
    note: o.note || null,
  };
}

/**
 * @param {object} layer
 */
export function verification_layer_summary(layer) {
  if (!layer) {
    return null;
  }
  return {
    engine: layer.engine,
    verify_status: layer.verify_status,
    match_tier: layer.match_tier || null,
    artist_match_status: layer.artist_match_status || null,
    artist_verified: layer.artist_verified === true,
    isrc_conflict: !!layer.isrc_conflict,
    recording_id: layer.recording_id || null,
    match_score: layer.match_score != null ? layer.match_score : null,
    is_online_mb: layer.is_online_mb === true,
    source_ref: layer.source_ref,
    obtained_at: layer.obtained_at || null,
    pending_verification: !!layer.pending_verification,
    note: layer.note || null,
  };
}
