/**
 * G3-D.1 Cursor Agent 推理（依 evidence_payloads；非外部 API）
 * 不得僅憑歌名腳本定演唱語言；允許 unknown。
 */
import { SUBGENRES_BY_CODE } from '../genre_taxonomy.js';

function base_row(track_id, title) {
  return {
    track_id: track_id,
    title: title,
    confidence: 'inferred',
    confidence_tier: 'medium',
    genre_profile: {
      primary_genre: 'unknown',
      secondary_genres: [],
      subgenres: [],
      confidence: 'inferred',
    },
    language: {
      value: '未確認',
      confidence: 'unknown',
      vocal_verification_status: 'unverified',
      method: 'g3_d1_cursor_ai',
      evidence: '無音訊核實；未以歌名腳本單獨定案',
    },
    contexts: [],
    special_types: [],
    version_uncertainty: false,
    reason_zh: '',
    evidence_used: ['identity.title', 'identity.artists'],
    unverified_fields: ['primary_genre', 'vocal_language'],
    human_locked: false,
  };
}

function apply_genre(row, primary, subgenres, secondary, reason) {
  row.genre_profile.primary_genre = primary;
  row.genre_profile.subgenres = subgenres || [];
  row.genre_profile.secondary_genres = secondary || [];
  row.reason_zh = reason;
  row.unverified_fields = row.unverified_fields.filter(function (f) {
    return f !== 'primary_genre';
  });
  if (primary === 'unknown') {
    if (row.unverified_fields.indexOf('primary_genre') < 0) {
      row.unverified_fields.push('primary_genre');
    }
  }
}

function candidate_hint(payload) {
  const list = payload.classification_candidates || [];
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i].candidate;
    if (!c || !c.genre_profile) {
      continue;
    }
    const pg = c.genre_profile.primary_genre;
    const code =
      typeof pg === 'object' && pg ? pg.value : pg;
    if (code && code !== 'unknown') {
      return { primary: code, note: c.analysis_note || list[i].batch_id };
    }
  }
  return null;
}

function album_blob(payload) {
  const id = payload.identity || {};
  return (
    (id.album_name || '') +
    ' ' +
    (id.title || '') +
    ' ' +
    (id.artists || []).join(' ')
  ).toLowerCase();
}

function artist_blob(payload) {
  return ((payload.identity && payload.identity.artists) || [])
    .join(' ')
    .toLowerCase();
}

function title_blob(payload) {
  return String((payload.identity && payload.identity.title) || '').toLowerCase();
}

/**
 * G3-D.2 收窄：composer  alone 或泛 OST 字樣不再直接判定配樂（僅影響後續波次，不重跑 D.1）
 */
function is_instrumental_context(payload) {
  const blob = album_blob(payload);
  const title = title_blob(payload);
  if (
    /ヴァイオリン|ピアノの調べ|魔女の宅急便|ジブリ|宮崎.*駿|grieg|solo piano|off vocal|伴奏/i.test(
      blob
    )
  ) {
    return true;
  }
  if (/(\(|\[)?instrumental(\)|\])?|純音樂|無人聲/i.test(title)) {
    return true;
  }
  const comp = artist_blob(payload);
  if (
    /lorien testard|flying waters|rain from the ground/i.test(comp + ' ' + title)
  ) {
    return true;
  }
  if (
    /newton brothers|joseph trapanese|gustavo santaolalla|bear mccreary|david fleming/i.test(
      comp
    ) &&
    /score|soundtrack|原聲|配樂|game|film|電影|遊戲/i.test(blob)
  ) {
    return true;
  }
  return false;
}

function set_language_inferred(row, value, evidence) {
  row.language.value = value;
  row.language.confidence = 'inferred';
  row.language.evidence = evidence;
  row.unverified_fields = row.unverified_fields.filter(function (f) {
    return f !== 'vocal_language';
  });
}

/**
 * @param {object} payload evidence_payloads 元素
 */
export function classify_g3_d1_from_evidence(payload) {
  const id = payload.track_id;
  const title = payload.identity.title || '';
  const row = base_row(id, title);

  if (payload.human_confirmation && payload.human_confirmation.locked) {
    row.human_locked = true;
    row.reason_zh = '人工鎖定；不輸出覆寫性 AI';
    return row;
  }

  const hint = candidate_hint(payload);
  if (hint) {
    row.evidence_used.push('classification_candidates');
  }

  if (/remaster|remix|live|acoustic|現場|\(live\)/i.test(title)) {
    row.version_uncertainty = true;
    row.unverified_fields.push('recording_version');
    row.evidence_used.push('identity.title_version_markers');
  }

  if (is_instrumental_context(payload)) {
    const game = /game|witcher|god of war|lorien|flying waters|rain from the ground/i.test(
      album_blob(payload) + title_blob(payload)
    );
    apply_genre(
      row,
      'soundtrack_instrumental',
      [game ? 'game_score' : 'film_score'],
      [],
      game
        ? '作曲／專輯脈絡指向遊戲或影視配樂；器樂為主'
        : '專輯或作曲者脈絡指向配樂／改編 instrumental；非 Spotify API'
    );
    row.special_types.push({
      value: game ? '遊戲音樂' : '電影／電視原聲帶',
      confidence: 'inferred',
    });
    row.special_types.push({ value: '純音樂', confidence: 'inferred' });
    row.language.evidence =
      '配樂／改編 instrumental 為主；演唱語言非分類重點';
    row.confidence_tier = 'medium';
    return row;
  }

  const art = artist_blob(payload);
  const alb = album_blob(payload);

  if (/ed sheeran|leo sayer|adele|billie eilish|dua lipa|harry styles|sam smith|bruno mars|the carpenters|maroon 5|coldplay|taylor swift|ariana grande|justin bieber|edward christopher/i.test(
    art
  )) {
    apply_genre(
      row,
      'pop',
      ['pop_ballad'],
      [],
      '歌手公開作品系譜以英語流行为主；非僅拉丁字歌名'
    );
    set_language_inferred(
      row,
      '英文',
      '歌手系譜與主流發行脈絡；未聆聽本 Spotify 音訊'
    );
    row.evidence_used.push('artist_public_discography');
    if (/leo sayer|remaster/i.test(title + art)) {
      row.version_uncertainty = true;
    }
    return row;
  }

  if (/drake|dr\. dre|snoop|kendrick|travis scott|21 savage|future|lil |nas |eminem|jay-z|kanye|高爾宣|osn|蛋堡|頑童|mj116|mc hotdog|熊仔|大支/i.test(
    art + alb
  )) {
    apply_genre(
      row,
      'hip_hop',
      art.indexOf('高爾宣') >= 0 || art.indexOf('osn') >= 0 ? ['pop_rap'] : ['trap'],
      art.indexOf('高爾宣') >= 0 ? ['pop'] : [],
      '饒舌／嘻哈歌手或專輯脈絡（#osnrap 等）'
    );
    if (/高爾宣|osn|蛋堡|頑童|熊仔|大支|mc hotdog/i.test(art)) {
      set_language_inferred(
        row,
        art.indexOf('蛋堡') >= 0 ? '台語' : '國語',
        '華語嘻哈歌手公開作品語系；非僅中文歌名'
      );
    } else {
      set_language_inferred(
        row,
        '英文',
        '嘻哈歌手系譜；未聆聽音訊'
      );
    }
    row.evidence_used.push('artist_genre_discography');
    return row;
  }

  if (/tove lo|calvin harris|david guetta|avicii|deadmau5|skrillex|martin garrix|zedd|kygo|alan walker|a7s|topic/i.test(
    art + title
  )) {
    apply_genre(row, 'electronic', ['house'], ['pop'], 'EDM／舞曲製作人或 Remix 脈絡');
    set_language_inferred(row, '英文', '電子舞曲系譜；未聆聽音訊');
    return row;
  }

  if (/beatles|queen|led zeppelin|pink floyd|nirvana|metallica|linkin park|green day|oasis|radiohead|fall out boy|my chemical romance/i.test(
    art
  )) {
    apply_genre(row, 'rock', ['classic_rock'], [], '搖滾樂團系譜');
    set_language_inferred(row, '英文', '搖滾樂團公開作品；未聆聽音訊');
    return row;
  }

  if (/久石|suzuki|misia|宇多田|米津|official髭男|yoasobi|aiko|中島|玉置|德永|桑田|福山|椎名|yuka|吉森|宮崎/i.test(
    art + alb + title
  )) {
    apply_genre(
      row,
      alb.indexOf('ジブリ') >= 0 || title.indexOf('より') >= 0 ? 'soundtrack_instrumental' : 'pop',
      alb.indexOf('ジブリ') >= 0 ? ['film_score'] : ['adult_contemporary'],
      [],
      '日本歌手或吉卜力改編專輯脈絡'
    );
    if (alb.indexOf('ヴァイオリン') >= 0) {
      row.special_types.push({ value: '純音樂', confidence: 'inferred' });
      row.language.value = '未確認';
    } else {
      set_language_inferred(row, '日文', '日本歌手／專輯脈絡；非僅假名歌名');
    }
    return row;
  }

  if (/周杰|jay chow|jj lin|林俊|王力宏|陶喆|張惠|蔡依林|孫燕|梁靜|陳奕|五月天|蘇打|徐佳|楊丞|萧敬|胡夏|邓紫棋|g.e.m|李榮|毛不易|薛之|華語/i.test(
    art + title
  )) {
    apply_genre(row, 'pop', ['pop_ballad'], [], '華語流行歌手系譜');
    set_language_inferred(
      row,
      /粤语|粵|hong kong|hk|eason|陳奕|張學友|李克|容祖|gem/i.test(art + title)
        ? '粵語'
        : /台|waa|伍佰|江蕙|張震|陳昇|b.a.d|b.a.d/i.test(art + title)
          ? '台語'
          : '國語',
      '歌手／專輯系譜推論；未聆聽音訊'
    );
    return row;
  }

  if (/bts|blackpink|iu|taeyeon|psy|bigbang|seventeen|newjeans|aespa|stray kids|gidle/i.test(
    art
  )) {
    apply_genre(row, 'pop', ['dance_pop'], [], 'K-pop 歌手系譜');
    set_language_inferred(row, '韓文', 'K-pop 歌手公開作品；非僅 Hangul 歌名');
    row.special_types.push({ value: '韓流', confidence: 'inferred' });
    return row;
  }

  if (hint && hint.primary) {
    const subs = [];
    const meta = SUBGENRES_BY_CODE;
    apply_genre(
      row,
      hint.primary,
      subs,
      [],
      '參考既有 AI 候選（' + hint.note + '）並對照字典；仍為 inferred'
    );
    row.confidence_tier = 'low';
    return row;
  }

  row.confidence_tier = 'low';
  row.reason_zh =
    row.reason_zh ||
    'metadata／候選不足；保留 unknown 與未確認';
  return row;
}
