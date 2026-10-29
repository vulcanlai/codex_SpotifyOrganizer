// 人工定義的合成資料：100 首 AI（90 medium / 10 low）、其中 31 首需語言證據，
// 另 300 首可供新分類。沒有正式歌曲、歷史報告或 OAuth 資料。
export const track_id = n => String(n + 1).padStart(22, '0');
export const SAMPLE_SIZE = 100;
export const UNIVERSE_SIZE = 400;
export function ai_row(n) {
  return {
    track_id: track_id(n), title: `Fixture Song ${n}`, artists: ['Fixture Artist'],
    source: 'cursor_agent_g3_d3_repair', confidence: 'inferred',
    confidence_tier: n < 90 ? 'medium' : 'low',
    genre_profile: { primary_genre: 'pop', subgenres: [], secondary_genres: [], confidence: 'inferred' },
    language: n < 31 ? { value: '英文', evidence: 'synthetic inference' } : { value: '未確認' },
    contexts: [], special_types: [], unverified_fields: [], version_uncertainty: false,
  };
}
export function evidence_row(n) {
  return {
    track_id: track_id(n),
    identity: { title: `Fixture Song ${n}`, artists: ['Fixture Artist'], enrichment_cache_complete: true },
    human_confirmation: { locked: false }, facts: [], inferences: [], evidence: [], conflicts: [],
    verification_status: {}, priority_resolution: {},
  };
}
export function fixture_documents() {
  const ids = Array.from({ length: UNIVERSE_SIZE }, (_, n) => track_id(n));
  const index = Object.fromEntries(ids.map((id, n) => [id, {
    spotify_id: id, metadata_status: 'complete',
    display: { name: `Fixture Song ${n}`, artists: ['Fixture Artist'] }, tags: [],
  }]));
  return {
    'backup/merged/library-v2.json': { schema_version: 2, track_index_by_spotify_id: index },
    'backup/classification/classification-index.json': { tracks_by_id: index },
    'backup/classification/formal-classification-state.json': { states_by_track_id: {} },
    'backup/classification/manual-overrides.json': { schema_version: 1, overrides_by_track_id: {} },
    'backup/enrichment/track-metadata-cache.json': { schema_version: 1, tracks_by_id: {} },
    'backup/classification/g3-evidence/evidence-index.json': {
      source_fingerprints: {}, tracks: Object.fromEntries(ids.map((id, n) => [id, evidence_row(n)])),
    },
    'backup/enrichment/external/g1-30/sample-30.json': { track_ids: ids.slice(0, 30) },
    'backup/classification/g3-b-trial-30/ai-classification-draft.json': {
      tracks: Array.from({ length: 10 }, (_, n) => ai_row(n)),
    },
    'backup/classification/g3-b3-trial-30/batch-drafts/fixture-imported.json': {
      tracks: Array.from({ length: 20 }, (_, n) => ai_row(n + 10)),
    },
    'backup/classification/g3-b6-trial-100/batch-drafts/fixture-imported.json': {
      tracks: Array.from({ length: 70 }, (_, n) => ai_row(n + 30)),
    },
    'backup/classification/g3-b5-trial-100/sample-100.json': { track_ids: ids.slice(0, 100) },
    'backup/classification/g3-d1-wave-200/sample-200.json': { track_ids: ids.slice(100, 300) },
  };
}
