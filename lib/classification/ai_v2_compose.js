/**
 * 依 sample metadata + v1 候選，產生 v2（12 主曲風 + 子曲風）候選
 * 僅使用公開 metadata，不聲稱聽過音訊
 */
import { migrate_legacy_genre_label } from './genre_migrate.js';
import { GENRE_PRIMARY_UNKNOWN } from './genre_taxonomy.js';

const AI_METHOD = 'cursor_ai_metadata';
const AI_SOURCE = 'cursor_ai';

function ai_tag(value, confidence, evidence) {
  return {
    value,
    confidence,
    evidence,
    method: AI_METHOD,
    source: AI_SOURCE,
  };
}

function genre_tag(code, confidence, evidence) {
  return ai_tag(code, confidence, evidence);
}

/**
 * 每曲新版曲風（覆寫自動對應）；缺省由 v1 中文曲風遷移
 * @type {Record<string, { primary: string, secondary?: string[], subs?: string[], note: string }>}
 */
const V2_GENRE_BY_ID = {
  '00BoQyD7l8sQ6DreBlbD8R': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: '林憶蓮《玫瑰香》為 1990 年代華語抒情流行（公開作品脈絡）。',
  },
  '00Coyxt9mTec1acC52qtWa': {
    primary: 'pop',
    secondary: ['soundtrack_instrumental'],
    subs: ['pop_ballad', 'film_score'],
    note: '韓劇 OST 抒情主題曲，專輯名含 OST。',
  },
  '00KmOF83bIAhl0XSskhJ6j': {
    primary: 'folk',
    secondary: ['rock'],
    subs: ['folk_rock'],
    note: '羅大佑《亞細亞的孤兒》常歸類民謠搖滾（公開資料）。',
  },
  '00Pawae4ozSMD3EOVLSiDD': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: '李心潔華語抒情流行專輯曲目。',
  },
  '00Q1SHbnvV1vxHOOcc9iGz': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: '謝霆鋒華語流行抒情向（歌名與藝人公開脈絡）。',
  },
  '00U0pedRUMEzREpyRqbVT6': {
    primary: 'pop',
    secondary: ['soundtrack_instrumental'],
    subs: ['pop_ballad', 'film_score'],
    note: '曲名標示電影 With Honors 主題，Madonna 抒情流行。',
  },
  '00YZtBMUcWuz84fowwSRtA': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: '《戀曲1990》翻唱／精選脈絡，華語抒情流行。',
  },
  '00p3KkrKpdkbsH3gZyA27a': {
    primary: 'folk',
    subs: ['urban_folk'],
    note: '汤旭《岛歌》都會民謠／民謠流行取向（公開作品類型）。',
  },
  '00wt3D7S5tkAVOpf8OnToi': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: '華語抒情流行（歌名與 v1 推論一致）。',
  },
  '00zxUkJOax0xUwKXRuLkO3': {
    primary: 'pop',
    subs: ['dance_pop'],
    note: 'v1 情境「派對」；曲名《本色英雄》偏舞曲流行取向，僅 metadata 推論。',
  },
  '010TvPu6fgBJL4usanmgAU': {
    primary: 'rock',
    secondary: ['pop'],
    subs: ['pop_rock'],
    note: '《男人KTV》為華語流行搖滾／KTV 向（公開曲名脈絡）。',
  },
  '017XZFegi1L3gRokZGVycq': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: '《報告班長》華語懷舊抒情流行。',
  },
  '018z3v1gpuqBe6rsKUygpv': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: '慢板抒情流行（歌名與 v1 情境）。',
  },
  '01BE3X67aMlekmWy5mvRc9': {
    primary: 'pop',
    secondary: ['soundtrack_instrumental'],
    subs: ['pop_ballad', 'film_score'],
    note: '周杰倫電影主題曲《我是如此相信》，專輯／v1 特殊類型標 OST。',
  },
  '01I5PszJ2fdDaKccLBgrCq': {
    primary: 'pop',
    subs: ['indie_pop'],
    note: '中英文歌名並列，獨立／文藝流行取向（metadata 推論，非音訊）。',
  },
  '01J9yboPO3GGfsdiedfgTG': {
    primary: 'rock',
    secondary: ['pop'],
    subs: ['pop_rock'],
    note: 'v1 主搖滾次流行；伍佰《孤星》搖滾流行脈絡。',
  },
  '01PSJFZbSRujjSk9d2Gbla': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: '華語抒情流行。',
  },
  '01Rs03ewLeWAhYMVKOviep': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: '《人面桃花》古典意象抒情流行。',
  },
  '01YxoO4X1DyTN0TJYQGlL9': {
    primary: 'pop',
    secondary: ['soundtrack_instrumental'],
    subs: ['film_score'],
    note: 'v1 標電影原聲；曲名《故事 II》無法細分子曲風 beyond 配樂。',
  },
  '01oBgDuwk5iU3742bIVPcw': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: '華語抒情流行。',
  },
  '01piD1UUm2YtKmL5HdXCuD': {
    primary: GENRE_PRIMARY_UNKNOWN,
    subs: [],
    note: 'v1 曲風「其他」無法對應新版主曲風；西語歌名但無足夠類型證據。',
  },
  '01xZKpqtvfYisTZFoaYwxd': {
    primary: 'classical',
    secondary: ['soundtrack_instrumental'],
    subs: ['orchestral', 'film_score'],
    note: '迪士尼《美女與野獸》歌劇段落，古典管弦配樂脈絡。',
  },
  '02W5tzWUqFYLv1GQySW2Tv': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: '《安妮》華語懷舊抒情流行。',
  },
  '04HktQKouXTU7teN9LlAwQ': {
    primary: 'classical',
    secondary: ['soundtrack_instrumental'],
    subs: ['orchestral', 'film_score'],
    note: '同專輯 Lumière 法語歌劇／配樂段落。',
  },
  '07LzuddOowix2OX46t1Fsj': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: '華語抒情流行。',
  },
  '0AQqrtK1pULuwZUXhwaaDz': {
    primary: 'pop',
    subs: ['pop_ballad'],
    note: 'Celine Dion 抒情流行經典（公開作品類型）。',
  },
  '0GjEhVFGZW8afUYGChu3Rr': {
    primary: 'pop',
    secondary: ['electronic'],
    subs: ['dance_pop'],
    note: 'ABBA《Dancing Queen》為迪斯可／舞曲流行；舊版「舞曲」不單獨作為主曲風。',
  },
  '0JTWeXdhgjlFHWDO070jE2': {
    primary: 'pop',
    subs: ['adult_contemporary'],
    note: '《美酒加咖啡》老派華語流行／成人當代取向。',
  },
  '0V58TmLnChjbNycM9QfFC0': {
    primary: 'pop',
    secondary: ['folk'],
    subs: ['folk_pop'],
    note: 'v1 流行+民謠；西洋抒情標準曲常歸流行與民謠跨界。',
  },
  '0WeN17PUto5ZdSqkUBDOsX': {
    primary: 'pop',
    subs: ['adult_contemporary'],
    note: '《玫瑰玫瑰我愛你》老派華語流行標準曲（公開脈絡）。',
  },
};

function build_genre_profile_tags(spec, v1_candidate) {
  const primary = spec.primary;
  const conf =
    primary === GENRE_PRIMARY_UNKNOWN ? 'unknown' : 'inferred';
  const evidence =
    spec.note +
    (v1_candidate.genres && v1_candidate.genres.length
      ? ' v1 曲風標籤：' +
        v1_candidate.genres
          .map(function (g) {
            return g.value;
          })
          .join('、') +
        '。'
      : '');

  const secondary = spec.secondary || [];
  const subs = primary === GENRE_PRIMARY_UNKNOWN ? [] : spec.subs || [];

  const profile = {
    primary_genre: genre_tag(primary, conf, evidence),
    secondary_genres: [],
    subgenres: [],
  };

  for (let i = 0; i < secondary.length && i < 2; i += 1) {
    profile.secondary_genres.push(
      genre_tag(secondary[i], 'inferred', spec.note)
    );
  }
  for (let s = 0; s < subs.length; s += 1) {
    profile.subgenres.push(
      genre_tag(subs[s], 'inferred', spec.note)
    );
  }
  return profile;
}

function copy_dimension(v1_field) {
  if (!v1_field) {
    return null;
  }
  return {
    value: v1_field.value,
    confidence: v1_field.confidence,
    evidence: v1_field.evidence,
    method: v1_field.method || AI_METHOD,
    source: v1_field.source || AI_SOURCE,
  };
}

function copy_list(items) {
  const out = [];
  for (let i = 0; i < (items || []).length; i += 1) {
    const it = items[i];
    out.push({
      value: it.value,
      confidence: it.confidence,
      evidence: it.evidence,
      method: it.method || AI_METHOD,
      source: it.source || AI_SOURCE,
    });
  }
  return out;
}

/**
 * @param {object} track_row sample-30 track
 * @param {object} v1_candidate
 */
export function compose_v2_candidate(track_row, v1_candidate) {
  const id = v1_candidate.spotify_id;
  let spec = V2_GENRE_BY_ID[id];
  if (!spec) {
    const labels = (v1_candidate.genres || []).map(function (g) {
      return g.value;
    });
    let primary = GENRE_PRIMARY_UNKNOWN;
    const secondary = [];
    for (let i = 0; i < labels.length; i += 1) {
      const m = migrate_legacy_genre_label(labels[i]);
      if (m.primary !== GENRE_PRIMARY_UNKNOWN && primary === GENRE_PRIMARY_UNKNOWN) {
        primary = m.primary;
      } else if (
        m.primary !== GENRE_PRIMARY_UNKNOWN &&
        m.primary !== primary &&
        secondary.length < 2
      ) {
        secondary.push(m.primary);
      }
    }
    spec = {
      primary,
      secondary,
      subs: [],
      note: '由 v1 曲風標籤自動遷移，未加子曲風。',
    };
  }

  const name = track_row && track_row.name ? track_row.name : id;
  const album = track_row && track_row.album_name ? track_row.album_name : '';

  return {
    spotify_id: id,
    language: copy_dimension(v1_candidate.language) || {
      value: '未確認',
      confidence: 'unknown',
      evidence:
        'metadata 未標語言；歌名「' +
        name +
        '」不足以唯一判定語言。',
      method: AI_METHOD,
      source: AI_SOURCE,
    },
    contexts: copy_list(v1_candidate.contexts || v1_candidate.moods),
    special_types: copy_list(v1_candidate.special_types),
    genre_profile: build_genre_profile_tags(spec, v1_candidate),
    analysis_note:
      'v2 重新評估：曲名「' +
      name +
      '」' +
      (album ? '、專輯「' + album + '」' : '') +
      '；依新版 12+40 字典，非音訊推論。',
  };
}

/**
 * @param {object} sample_doc
 * @param {object} v1_doc
 */
export function build_v2_candidates_doc(sample_doc, v1_doc) {
  const tracks_by_id = {};
  const tracks = sample_doc.tracks || [];
  for (let i = 0; i < tracks.length; i += 1) {
    tracks_by_id[tracks[i].spotify_id] = tracks[i];
  }
  const v1_map = {};
  const v1_list = v1_doc.candidates || [];
  for (let j = 0; j < v1_list.length; j += 1) {
    v1_map[v1_list[j].spotify_id] = v1_list[j];
  }

  const candidates = [];
  for (let k = 0; k < sample_doc.track_ids.length; k += 1) {
    const tid = sample_doc.track_ids[k];
    const v1 = v1_map[tid];
    if (!v1) {
      throw new Error('v1 缺少候選：' + tid);
    }
    candidates.push(compose_v2_candidate(tracks_by_id[tid], v1));
  }

  return {
    schema_version: 2,
    candidate_version: 2,
    source: 'cursor_ai',
    taxonomy_version: 1,
    sample_size: sample_doc.track_count,
    sample_id: sample_doc.sample_id,
    generated_at: new Date().toISOString(),
    candidates,
  };
}
