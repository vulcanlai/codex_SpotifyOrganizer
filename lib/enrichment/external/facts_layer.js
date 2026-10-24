/**
 * 區分外部事實、推論候選、無法確認（G1 不憑歌名推語言）
 */

/**
 * @param {import('./provider_base.js').ExternalCandidate|null} best
 * @param {boolean} isrc_exact
 */
export function build_fact_layer(best, isrc_exact) {
  if (!best) {
    return {
      recording_id: null,
      title: null,
      artists: [],
      duration_ms: null,
      first_release_date: null,
      genre_tags_from_source: [],
      isrc_linked: isrc_exact,
    };
  }
  return {
    recording_id: best.external_id,
    title: best.title,
    artists: best.artist_names.slice(),
    duration_ms: best.duration_ms,
    first_release_date: best.first_release_date,
    genre_tags_from_source: (best.tags || []).slice(),
    isrc_linked: isrc_exact,
  };
}

/**
 * G1：演唱語言不得由歌名語系推斷
 * @param {object} fact_layer
 */
export function build_inference_layer(fact_layer) {
  const genres = fact_layer.genre_tags_from_source || [];
  return {
    vocal_language: {
      value: 'unknown',
      confidence: 0,
      note: 'G1 不憑歌名或藝人國籍推斷演唱語言；需後續獨立證據來源',
    },
    primary_genre: {
      value: genres.length ? 'from_source_tags_only' : 'unknown',
      confidence: genres.length ? 0.4 : 0,
      note: genres.length
        ? '僅 MusicBrainz 使用者標籤，非正式分類結論'
        : '來源未提供曲風標籤',
      source_tags: genres.slice(),
    },
  };
}

/**
 * @param {string} verify_status
 * @param {boolean} version_ambiguous
 */
export function build_unknown_layer(verify_status, version_ambiguous) {
  const items = [];
  if (verify_status === 'not_found') {
    items.push('查無可靠外部錄音候選');
  }
  if (verify_status === 'ambiguous' || version_ambiguous) {
    items.push('存在多個接近的錄音版本，無法唯一對應');
  }
  if (verify_status === 'insufficient') {
    items.push('有搜尋結果但比對分數不足以認定為同一錄音');
  }
  return { reasons: items };
}
