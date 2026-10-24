/**
 * G3-B.6 Cursor AI 草稿推理（離線 evidence，無外部 API）
 */
function join_artists(artists) {
  return (artists || []).join(' ');
}

function title_lower(title) {
  return String(title || '').toLowerCase();
}

function has_cjk(s) {
  return /[\u4E00-\u9FFF]/.test(String(s || ''));
}

function has_kana(s) {
  return /[\u3040-\u309F\u30A0-\u30FF]/.test(String(s || ''));
}

function is_live_remix_acoustic(title) {
  const t = title_lower(title);
  return (
    /(\blive\b|\(live\)|remix|acoustic|feat\.|featured in)/i.test(title) ||
    /現場|演唱會/.test(String(title || ''))
  );
}

function is_score_artist(artists) {
  const a = join_artists(artists).toLowerCase();
  return (
    /gustavo santaolalla|joseph trapanese|lorien testard|bear mccreary|david fleming|david garcía|newton brothers|raney shockne|thomas chong|frida johansson|percival/i.test(
      a
    ) || /grieg|edvard grieg/i.test(a)
  );
}

function is_game_score_context(title, album) {
  const blob = (title + ' ' + (album || '')).toLowerCase();
  return (
    /god of war|witcher|men in black|orphan|monoco|lumière|wolven|settlement|invited|resolve|flashback|dust and oblivion|reacher|virtuosity|sanctuary|root|stoup|mexico|survive|auspicious|plan\?|vuilpanne|bard maker|one upon light|memories of mother|featured in/i.test(
      blob
    ) || /soundtrack|ost|score/i.test(blob)
  );
}

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
      method: 'g3_b6_cursor_ai',
      evidence: '無音訊核實；索引語言標籤皆未確認',
    },
    contexts: [],
    special_types: [],
    version_uncertainty: false,
    reason_zh: '',
    evidence_used: ['identity.title', 'identity.artists'],
    unverified_fields: ['vocal_language', 'primary_genre'],
    human_locked: false,
  };
}

/**
 * @param {object} payload from build_track_payloads_for_ids
 */
export function infer_g3_b6_draft_row(payload) {
  const id = payload.track_id;
  const title = payload.identity.title || '';
  const artists = payload.identity.artists || [];
  const album = payload.identity.album_name || '';
  const row = base_row(id, title);
  const artist_blob = join_artists(artists);

  if (is_live_remix_acoustic(title)) {
    row.version_uncertainty = true;
    row.unverified_fields.push('recording_version');
    if (/live|現場/i.test(title)) {
      row.special_types.push({ value: '現場演唱', confidence: 'inferred' });
    }
    if (/remix/i.test(title_lower(title))) {
      row.unverified_fields.push('remix_vs_original');
    }
    if (/acoustic/i.test(title_lower(title))) {
      row.unverified_fields.push('acoustic_arrangement');
    }
  }

  if (is_score_artist(artists) || is_game_score_context(title, album)) {
    row.genre_profile.primary_genre = 'soundtrack_instrumental';
    row.genre_profile.subgenres = [
      is_game_score_context(title, album) ? 'game_score' : 'film_score',
    ];
    row.special_types.push({
      value: is_game_score_context(title, album) ? '遊戲音樂' : '電影／電視原聲帶',
      confidence: 'inferred',
    });
    row.special_types.push({ value: '純音樂', confidence: 'inferred' });
    row.language.value = '未確認';
    row.language.confidence = 'unknown';
    row.language.evidence =
      '配樂／器樂取向；無人聲或人聲非分類重點，未做演唱語言判定';
    row.unverified_fields = ['primary_genre', 'instrumental_vs_vocal'];
    row.confidence_tier = 'medium';
    row.reason_zh =
      '依作曲者與曲名脈絡（遊戲／影視配樂）推論；非 Spotify/MB 查證。';
    row.evidence_used.push('composer_credits', 'title_context');
    if (/grieg|våren/i.test(title_lower(title) + artist_blob.toLowerCase())) {
      row.genre_profile.primary_genre = 'classical';
      row.genre_profile.subgenres = ['solo_piano'];
      row.genre_profile.secondary_genres = ['soundtrack_instrumental'];
      row.reason_zh = 'Grieg 古典小品；鋼琴／室內樂編制推論。';
    }
    return row;
  }

  if (/tove lo|topic|a7s|breaking me/i.test(artist_blob.toLowerCase() + title_lower(title))) {
    row.genre_profile.primary_genre = 'electronic';
    row.genre_profile.subgenres = ['house'];
    row.genre_profile.secondary_genres = ['pop'];
    row.language.value = '英文';
    row.language.confidence = 'inferred';
    row.language.evidence = '電子舞曲／Remix 脈絡；未聆聽音訊';
    if (/remix/i.test(title_lower(title))) {
      row.version_uncertainty = true;
    }
    row.reason_zh = 'EDM／Remix 取向；Stay High 等為舞曲改編。';
    return row;
  }

  if (/ed sheeran|billie eilish|tones and i|daniel powter|leo sayer|carpenters|blackbear|william prince|pitbull|honeyfox|portals/i.test(
    artist_blob.toLowerCase()
  )) {
    row.genre_profile.primary_genre = 'pop';
    row.genre_profile.subgenres = ['pop_ballad'];
    if (/pitbull/i.test(artist_blob.toLowerCase())) {
      row.genre_profile.primary_genre = 'hip_hop';
      row.genre_profile.subgenres = ['pop_rap'];
      row.genre_profile.secondary_genres = ['pop'];
    }
    row.language.value = '英文';
    row.language.confidence = 'inferred';
    row.language.evidence =
      '歌手以英文流行／嘻哈作品著稱；非僅憑拉丁字歌名，但未聆聽音訊';
    row.unverified_fields = ['vocal_language'];
    row.reason_zh = '主流英語流行／嘻哈脈絡；tier 受 metadata 稀疏限制。';
    if (/carpenters/i.test(artist_blob.toLowerCase())) {
      row.confidence_tier = 'high';
      row.language.evidence = 'Carpenters 原版英文錄音脈絡（專輯年代標籤 1970s）';
    }
    return row;
  }

  if (/dr\. dre|snoop|devin the dude/i.test(artist_blob.toLowerCase())) {
    row.genre_profile.primary_genre = 'hip_hop';
    row.genre_profile.subgenres = ['pop_rap'];
    row.language.value = '英文';
    row.language.confidence = 'inferred';
    row.language.evidence = '西岸嘻哈專輯脈絡；未聆聽音訊';
    row.reason_zh = 'Dr. Dre 相關嘻哈曲目；可能含髒話／skit。';
    row.confidence_tier = 'low';
    return row;
  }

  if (has_kana(title) || /misia/i.test(artist_blob.toLowerCase())) {
    row.genre_profile.primary_genre = 'pop';
    row.genre_profile.subgenres = ['adult_contemporary'];
    row.language.value = '日文';
    row.language.confidence = 'inferred';
    row.language.evidence = '日文歌名與 MISIA 日語歌手脈絡；未聆聽音訊';
    row.special_types.push({ value: '動漫', confidence: 'inferred' });
    row.reason_zh = '日本流行／動漫相關曲；語言未音訊核實。';
    return row;
  }

  if (has_cjk(title) || /cheung|kwok|tse|wong|mui|peng|eggplant|麻吉|張琍敏|謝霆鋒|王菲|張學友|郭富城|彭佳慧|黃立成|珊瑚/i.test(
    artist_blob
  )) {
    row.genre_profile.primary_genre = 'pop';
    row.genre_profile.subgenres = ['pop_ballad'];
    if (/麻吉|machi|hip|饒舌/i.test(title + artist_blob)) {
      row.genre_profile.primary_genre = 'hip_hop';
      row.genre_profile.subgenres = ['pop_rap'];
      row.genre_profile.secondary_genres = ['pop'];
    }
    if (/eggplant|蛋堡|日常/i.test(artist_blob + title)) {
      row.language.value = '粵語';
      row.language.confidence = 'inferred';
      row.language.evidence = 'EggPlantEgg 香港粵語嘻哈／流行脈絡；非僅憑中文歌名';
    } else {
      row.language.value = '國語';
      row.language.confidence = 'inferred';
      row.language.evidence =
        '華語歌手與中文歌名脈絡（專輯／歌手公開作品系譜）；未聆聽音訊';
    }
    if (id === '0WeN17PUto5ZdSqkUBDOsX') {
      row.genre_profile.subgenres = ['adult_contemporary'];
      row.language.evidence =
        '《玫瑰玫瑰我愛你》華語標準曲、張琍敏珍藏系列脈絡；呼應 v2 候選但語言仍 unverified';
      row.evidence_used.push('phase_e_v2_candidate_hint', 'album_context');
    }
    if (/胭脂扣|anita mui/i.test(title + artist_blob.toLowerCase())) {
      row.genre_profile.subgenres = ['pop_ballad'];
      row.contexts.push({ value: '懷舊', confidence: 'inferred' });
      row.reason_zh = '梅艷芳經典華語抒情；1980s–2010s 重發脈絡。';
    }
    row.reason_zh = row.reason_zh || '華語／台語流行抒情或嘻哈；metadata 有限。';
    return row;
  }

  if (/bellabeth|wolven storm|priscilla/i.test(title_lower(title) + artist_blob.toLowerCase())) {
    row.genre_profile.primary_genre = 'folk';
    row.genre_profile.secondary_genres = ['soundtrack_instrumental'];
    row.genre_profile.subgenres = ['folk_pop'];
    row.language.value = '英文';
    row.language.confidence = 'inferred';
    row.language.evidence = '《巫師 3》Priscilla 之歌公開為英文演唱；未聆聽本版音訊';
    row.special_types.push({ value: '遊戲音樂', confidence: 'inferred' });
    row.version_uncertainty = true;
    row.reason_zh = '遊戲內 bard 歌曲；可能有翻唱版差異。';
    return row;
  }

  if (/paenda|friend zone/i.test(artist_blob.toLowerCase() + title_lower(title))) {
    row.genre_profile.primary_genre = 'pop';
    row.genre_profile.subgenres = ['dance_pop'];
    row.language.value = '英文';
    row.language.confidence = 'inferred';
    row.language.evidence = '奧地利 PAENDA 電子流行；非僅歌名';
    return row;
  }

  row.confidence_tier = 'low';
  row.reason_zh = 'metadata 稀疏；保留 unknown／未確認。';
  return row;
}
