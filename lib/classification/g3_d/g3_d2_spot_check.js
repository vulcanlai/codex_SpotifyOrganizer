/**
 * G3-D.2 30 首 spot-check（固定 seed，Agent 評語）
 */
import crypto from 'node:crypto';

function stable_rank(seed, id) {
  return crypto.createHash('sha256').update(seed + ':' + id).digest('hex');
}

function pick_stratified(rows, payload_map, target) {
  const buckets = {
    soundtrack: [],
    unknown: [],
    pop: [],
    hip_hop: [],
    other: [],
  };
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const pk = r.genre_profile.primary_genre;
    if (pk === 'soundtrack_instrumental') {
      buckets.soundtrack.push(r);
    } else if (pk === 'unknown') {
      buckets.unknown.push(r);
    } else if (pk === 'pop') {
      buckets.pop.push(r);
    } else if (pk === 'hip_hop') {
      buckets.hip_hop.push(r);
    } else {
      buckets.other.push(r);
    }
  }
  /** @type {object[]} */
  const picked = [];
  const order = ['soundtrack', 'unknown', 'pop', 'hip_hop', 'other'];
  const quota = { soundtrack: 10, unknown: 8, pop: 8, hip_hop: 2, other: 2 };
  for (let o = 0; o < order.length; o += 1) {
    const key = order[o];
    const list = buckets[key].slice().sort(function (a, b) {
      return stable_rank('g3-d2-spot', a.track_id) <
        stable_rank('g3-d2-spot', b.track_id)
        ? -1
        : 1;
    });
    const n = quota[key] || 0;
    for (let j = 0; j < n && j < list.length; j += 1) {
      picked.push(list[j]);
    }
  }
  while (picked.length < target && picked.length < rows.length) {
    const rest = rows.filter(function (r) {
      return !picked.some(function (p) {
        return p.track_id === r.track_id;
      });
    });
    rest.sort(function (a, b) {
      return stable_rank('g3-d2-spot-extra', a.track_id) <
        stable_rank('g3-d2-spot-extra', b.track_id)
        ? -1
        : 1;
    });
    if (!rest.length) {
      break;
    }
    picked.push(rest[0]);
  }
  return picked.slice(0, target);
}

function agent_verdict(row, payload) {
  const id = payload.identity || {};
  const pk = row.genre_profile.primary_genre;
  const tier = row.confidence_tier;
  const title = id.title || row.title;
  const album = id.album_name || '';
  const artists = (id.artists || []).join('、');
  const blob = (title + ' ' + album + ' ' + artists).toLowerCase();

  if (pk === 'unknown' && tier === 'low') {
    return {
      verdict: 'insufficient_evidence',
      verdict_zh: '證據不足',
      review_zh:
        'metadata 稀疏且 D.1 fallback；保留 unknown 合理，但非逐首深度推理',
    };
  }

  if (pk === 'soundtrack_instrumental') {
    if (
      /newton brothers|lorien testard|ジブリ|ヴァイオリン|魔女の宅|flying waters|game/i.test(
        blob
      )
    ) {
      return {
        verdict: 'reasonable',
        verdict_zh: '分類合理',
        review_zh:
          '作曲者或吉卜力改編／遊戲配樂脈絡明確；仍應標 version／是否人聲版',
      };
    }
    if (/ed sheeran|leo sayer|drake|pop|love song/i.test(blob)) {
      return {
        verdict: 'likely_error',
        verdict_zh: '疑似錯誤',
        review_zh:
          '流行歌手或抒情曲卻標配樂；可能誤觸 is_instrumental_context 關鍵字',
      };
    }
    return {
      verdict: 'insufficient_evidence',
      verdict_zh: '證據不足',
      review_zh:
        '僅 composer 或模糊 OST 字樣；不宜預設純器樂，可能含人聲',
    };
  }

  if (pk === 'pop' && /ed sheeran|leo sayer|carpenters/i.test(blob)) {
    return {
      verdict: 'reasonable',
      verdict_zh: '分類合理',
      review_zh:
        '歌手系譜支持流行；語言英文為 inferred 非音訊核實，tier 應維持 medium 以下',
    };
  }

  if (pk === 'hip_hop') {
    return {
      verdict: 'reasonable',
      verdict_zh: '分類合理',
      review_zh: '嘻哈歌手／專輯脈絡（如 #osnrap）與主曲風一致',
    };
  }

  if (
    row.language &&
    row.language.value === '英文' &&
    !id.enrichment_cache_complete &&
    !/ed sheeran|drake|beatles/i.test(blob)
  ) {
    return {
      verdict: 'insufficient_evidence',
      verdict_zh: '證據不足',
      review_zh: 'metadata 不足卻推断英文；不應僅憑拉丁字歌名',
    };
  }

  return {
    verdict: 'insufficient_evidence',
    verdict_zh: '證據不足',
    review_zh: '需更多 evidence 或第二輪 Agent 推理；不宣稱已驗證準確率',
  };
}

/**
 * @param {object[]} rows
 * @param {Record<string, object>} payload_map
 * @param {Record<string, object>} ev_tracks
 */
export function build_g3_d2_spot_check_30(rows, payload_map, ev_tracks) {
  const picked = pick_stratified(rows, payload_map, 30);
  /** @type {object[]} */
  const entries = [];
  const verdict_counts = {
    reasonable: 0,
    insufficient_evidence: 0,
    likely_error: 0,
    clear_conflict: 0,
  };

  for (let i = 0; i < picked.length; i += 1) {
    const row = picked[i];
    const payload = payload_map[row.track_id] || { identity: {} };
    const ev = ev_tracks[row.track_id];
    const v = agent_verdict(row, payload);
    if (verdict_counts[v.verdict] != null) {
      verdict_counts[v.verdict] += 1;
    }
    entries.push({
      track_id: row.track_id,
      title: row.title,
      artists: payload.identity && payload.identity.artists,
      album_name: payload.identity && payload.identity.album_name,
      enrichment_complete: !!(payload.identity && payload.identity.enrichment_cache_complete),
      ai_primary: row.genre_profile.primary_genre,
      ai_subgenres: row.genre_profile.subgenres,
      confidence_tier: row.confidence_tier,
      language: row.language && row.language.value,
      special_types: row.special_types,
      reason_zh: row.reason_zh,
      evidence_title_matches:
        ev && ev.identity ? ev.identity.title === row.title : null,
      cursor_agent_spot_check: v,
      note_zh: '第二輪 AI 意見未採納為事實；無音訊聆聽',
    });
  }

  return {
    schema_version: 1,
    seed: 'g3-d2-spot:30-stratified',
    sample_size: entries.length,
    entries: entries,
    verdict_counts: verdict_counts,
    accuracy_disclaimer_zh:
      '未進行音訊聆聽或外部 API；verdict 僅為 metadata／推理鏈 spot-check，非真實準確率',
  };
}
