/**
 * G3-D.3 Cursor Agent 逐首推理（30 首修復樣本）
 * source: cursor_agent_g3_d3_repair — 非規則 generate-drafts
 */
import { MAIN_GENRES, subgenres_for_main } from '../genre_taxonomy.js';

export function main_to_allowed_subgenres_map() {
  const out = {};
  for (let i = 0; i < MAIN_GENRES.length; i += 1) {
    const code = MAIN_GENRES[i].code;
    out[code] = subgenres_for_main(code).map(function (r) {
      return r.code;
    });
  }
  return out;
}

function row(
  track_id,
  title,
  fields
) {
  return Object.assign(
    {
      track_id: track_id,
      title: title,
      source: 'cursor_agent_g3_d3_repair',
      confidence: 'inferred',
      human_locked: false,
      method: 'g3_d3_cursor_agent',
    },
    fields
  );
}

/**
 * 30 首 Agent 推理結果（2026-10-22 本機 Cursor Agent 填寫）
 */
export const G3_D3_AGENT_REPAIR_TRACKS = [
  row('680YpUhUvGBLMRQpbuxy1Q', 'Gestral Village - Alicia (Gestrals)', {
    confidence_tier: 'medium',
    genre_profile: {
      primary_genre: 'soundtrack_instrumental',
      subgenres: ['game_score'],
      secondary_genres: [],
      confidence: 'inferred',
    },
    language: {
      value: '未確認',
      confidence: 'unknown',
      vocal_verification_status: 'unverified',
      evidence: '遊戲 BGM 曲名脈絡；是否含人聲未核實',
    },
    contexts: [],
    special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
    version_uncertainty: false,
    reason_zh:
      'Lorien Testard／Clair Obscur 遊戲區域 BGM 命名；配樂合理但非僅因 composer regex',
    evidence_used: ['identity.title', 'identity.artists', 'title_game_area_pattern'],
    unverified_fields: ['vocal_language', 'instrumental_vs_vocal'],
  }),
  row('2zysGsFCXuQuB0fVqpnNHh', 'All Gone (Isolation)', {
    confidence_tier: 'medium',
    genre_profile: {
      primary_genre: 'soundtrack_instrumental',
      subgenres: ['film_score'],
      secondary_genres: [],
      confidence: 'inferred',
    },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '影視配樂曲目；演唱語言非標題可判' },
    special_types: [{ value: '電影／電視原聲帶', confidence: 'inferred' }],
    reason_zh: 'Gustavo Santaolalla《最後生還者》系譜配樂；與 D.1 方向一致但移除未證實「純音樂」',
    evidence_used: ['identity.artists', 'identity.title'],
    unverified_fields: ['vocal_language'],
  }),
  row('4TEFYzwIYt4jVohtGE64u6', 'Atelier de Clea - Fleur de Paris', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '遊戲場景音樂' },
    special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
    reason_zh: 'Lorien Testard 遊戲場景曲；法文曲名不推演唱語言',
    evidence_used: ['identity.title', 'identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('4y7D8NOSs8aa72wG3oGTfh', 'Long Live The King', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['film_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'Joseph Trapanese 影視配樂系譜' },
    special_types: [{ value: '電影／電視原聲帶', confidence: 'inferred' }],
    reason_zh: '作曲者為影視配樂家；曲名像主題音樂但仍可能含人聲版',
    evidence_used: ['identity.artists', 'identity.title'],
    unverified_fields: ['vocal_language', 'primary_genre'],
  }),
  row('1kuddnNVHv1cmGoOm7h8nk', 'Confusing Time', {
    confidence_tier: 'low',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['film_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'Newton Brothers 影視配樂；metadata 缺 album' },
    special_types: [],
    reason_zh: 'The Newton Brothers 多為影視配樂，但單曲 metadata 不足；保留配樂主類、降信心',
    evidence_used: ['identity.artists'],
    unverified_fields: ['primary_genre', 'vocal_language'],
  }),
  row('5FLz4ai2phyipZzlj2ozXd', 'Gestral Village - Golgra', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '遊戲 BGM' },
    special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
    reason_zh: '同 Lorien Testard 遊戲村莊 BGM 系列',
    evidence_used: ['identity.title', 'identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('5I04MBlxgkrND4xvwlAWjG', 'Breaching the Wall', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['film_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'David Fleming 配樂系譜（如《藍色星球》）' },
    special_types: [{ value: '電影／電視原聲帶', confidence: 'inferred' }],
    reason_zh: '作曲者配樂脈絡明確；不額外標純音樂',
    evidence_used: ['identity.artists', 'identity.title'],
    unverified_fields: ['vocal_language'],
  }),
  row('6Hatem0bsuoOrDQDKekvsO', 'Stone Wave Cliffs - Missing Hope', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '遊戲區域 BGM' },
    special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
    reason_zh: 'Lorien Testard 遊戲探索 BGM',
    evidence_used: ['identity.title', 'identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('5Cm5lOLVANyXZ9ADVEPF7P', "Esquie's Nest - François", {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '遊戲場景' },
    special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
    reason_zh: '遊戲內場景音樂命名',
    evidence_used: ['identity.title', 'identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('75vBtpe5RMXptCWVUfTO2R', 'Fine Work', {
    confidence_tier: 'low',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['film_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '僅作曲者 Joseph Trapanese' },
    special_types: [],
    reason_zh: '曲名泛用；配樂作曲者線索弱於系列 OST 曲，保留配樂但 low tier',
    evidence_used: ['identity.artists'],
    unverified_fields: ['primary_genre', 'vocal_language'],
  }),
  row('5BY5wtAWSFwt2AYKziOEEi', 'Forgotten Battlefield - Over the Fallen', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '遊戲戰鬥 BGM' },
    special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
    reason_zh: 'Lorien Testard 遊戲戰鬥音樂',
    evidence_used: ['identity.title', 'identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('6DKZ6kwCDHC8JckgXYrb9x', 'All Gone (Affliction)', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['film_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'TLOU 配樂系列' },
    special_types: [{ value: '電影／電視原聲帶', confidence: 'inferred' }],
    reason_zh: '與 All Gone (Isolation) 同系；影視配樂',
    evidence_used: ['identity.title', 'identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('3C3S07q0RbDyjfqULVE3fz', 'Zusammenleben - Live At Palast der Republik / 1989', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'pop', subgenres: ['adult_contemporary'], secondary_genres: ['folk'], confidence: 'inferred' },
    language: { value: '其他', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Milva 德義系歌手 repertoire；德語現場曲目，非僅拉丁字歌名' },
    contexts: [{ value: '懷舊', confidence: 'inferred' }],
    special_types: [{ value: '現場演唱', confidence: 'inferred' }],
    version_uncertainty: true,
    reason_zh: 'D.1 fallback 錯失；德語現場 Schlager／流行，非 unknown',
    evidence_used: ['identity.title', 'identity.artists', 'title_live_marker'],
    unverified_fields: ['vocal_language', 'recording_version'],
  }),
  row('7rIovIsXE6kMn629b7kDig', 'I Will Survive', {
    confidence_tier: 'high',
    genre_profile: { primary_genre: 'pop', subgenres: ['dance_pop'], secondary_genres: ['rnb_soul'], confidence: 'inferred' },
    language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Gloria Gaynor 經典迪斯科／流行人聲曲；歌手系譜' },
    contexts: [{ value: '懷舊', confidence: 'inferred' }],
    reason_zh: 'D.1 規則未命中歌手 regex 而 unknown；應為英文迪斯科流行',
    evidence_used: ['identity.artists', 'identity.title'],
    unverified_fields: ['vocal_language'],
  }),
  row('79F1mmYfctu0sljzqipDP4', 'Hear Me Calling', {
    confidence_tier: 'high',
    genre_profile: { primary_genre: 'hip_hop', subgenres: ['trap'], secondary_genres: ['pop'], confidence: 'inferred' },
    language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Juice WRLD 饒舌作品系譜' },
    reason_zh: 'D.1 fallback；嘻哈歌手明確',
    evidence_used: ['identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('7dIEZMOFeo4XgXY2Su3I7I', '斑马，斑马', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'folk', subgenres: ['urban_folk'], secondary_genres: ['pop'], confidence: 'inferred' },
    language: { value: '國語', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: '宋冬野《安和桥北》民謠系譜；中文歌名不單獨定案但歌手＋專輯強' },
    reason_zh: 'D.1 unknown 不合理；華語民謠流行',
    evidence_used: ['identity.artists', 'identity.album_name', 'identity.title'],
    unverified_fields: ['vocal_language'],
  }),
  row('4wJsXq6J2K0wokQuRxr0Bn', 'Raise Me Up', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'pop', subgenres: ['pop_ballad'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Tones And I 英文流行歌手' },
    reason_zh: 'D.1 fallback；流行抒情',
    evidence_used: ['identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('4rIXleJdGOGHSzVFDUBRAC', "The Wolven Storm (Priscilla's Song)", {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'folk', subgenres: ['folk_pop'], secondary_genres: ['soundtrack_instrumental'], confidence: 'inferred' },
    language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: '《巫師3》Priscilla 之歌公開為英文演唱；翻唱版' },
    special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
    version_uncertainty: true,
    reason_zh: '遊戲 bard 歌；可 folk 主＋配樂次，非純 instrumental',
    evidence_used: ['identity.title', 'identity.artists', 'identity.album_name'],
    unverified_fields: ['vocal_language', 'recording_version'],
  }),
  row('2Zamj985QrDpk6kRmG6qKt', 'Möbius', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['film_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '澤野弘之《閃光的哈薩維》OST；可能含人聲/合唱' },
    special_types: [{ value: '動漫', confidence: 'inferred' }, { value: '電影／電視原聲帶', confidence: 'inferred' }],
    reason_zh: '專輯名明示 OST；不標純音樂',
    evidence_used: ['identity.album_name', 'identity.artists'],
    unverified_fields: ['vocal_language', 'instrumental_vs_vocal'],
  }),
  row('4kiPD6AvrjT5XcqNQvHUDX', 'Ich weiss es selber nicht genau', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'pop', subgenres: ['adult_contemporary'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '其他', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Milva 德語曲目標題與歌手系譜' },
    reason_zh: 'D.1 unknown；德語流行／Schlager',
    evidence_used: ['identity.artists', 'identity.title'],
    unverified_fields: ['vocal_language'],
  }),
  row('5X9EjZiYdWZteDAcCqQ5rr', 'Styrofoam', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'pop', subgenres: ['pop_ballad'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Daniel Powter 英文流行' },
    reason_zh: 'Bad Day 歌手系譜；D.1 fallback',
    evidence_used: ['identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('4XCaLLXGBymaZbUbglm6a1', 'Lose Someone Like Me', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'pop', subgenres: ['indie_pop'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Tones And I' },
    reason_zh: 'D.1 unknown → 流行',
    evidence_used: ['identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('1U5FWT6cHrEM8eD17uEVvn', 'Overpass Graffiti - Live', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'rock', subgenres: ['pop_rock'], secondary_genres: ['pop'], confidence: 'inferred' },
    language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Ed Sheeran 現場版' },
    special_types: [{ value: '現場演唱', confidence: 'inferred' }],
    version_uncertainty: true,
    reason_zh: 'D.1 pop 合理；補 live 版本不確定',
    evidence_used: ['identity.artists', 'identity.title'],
    unverified_fields: ['recording_version', 'vocal_language'],
  }),
  row('5bmCJB6oBM778g2KtAfZwN', 'Give Me Love - Live', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'pop', subgenres: ['pop_ballad'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Ed Sheeran' },
    special_types: [{ value: '現場演唱', confidence: 'inferred' }],
    version_uncertainty: true,
    reason_zh: '現場抒情流行',
    evidence_used: ['identity.artists', 'identity.title'],
    unverified_fields: ['recording_version'],
  }),
  row('6TJuL34llW4H7vWSJrDDO7', 'Let It Be', {
    confidence_tier: 'low',
    genre_profile: { primary_genre: 'pop', subgenres: ['pop_ballad'], secondary_genres: ['rock'], confidence: 'inferred' },
    language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Leo Sayer 常翻唱／抒情；曲名與 Beatles 撞名' },
    version_uncertainty: true,
    reason_zh: '可能是翻唱；D.1 pop 方向可接受但版本與編曲不確定',
    evidence_used: ['identity.artists', 'identity.title'],
    unverified_fields: ['recording_version', 'primary_genre'],
  }),
  row('5kF2vPeEQu1AuYrsZDtQ50', 'Clothes Off (Nanana)', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'electronic', subgenres: ['house'], secondary_genres: ['pop'], confidence: 'inferred' },
    language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Darius & Finlay 為德國電音組合；非 K-pop' },
    reason_zh: 'D.1 誤用 K-pop regex；應為舞曲 house',
    evidence_used: ['identity.artists', 'identity.title'],
    unverified_fields: ['vocal_language'],
  }),
  row('7gnMJEqeFry2idtHhFp20R', 'The A Team - Live', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'folk', subgenres: ['folk_pop'], secondary_genres: ['pop'], confidence: 'inferred' },
    language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Ed Sheeran 代表曲現場' },
    special_types: [{ value: '現場演唱', confidence: 'inferred' }],
    version_uncertainty: true,
    reason_zh: 'folk_pop 子類更貼 A Team；現場版',
    evidence_used: ['identity.artists', 'identity.title'],
    unverified_fields: ['recording_version'],
  }),
  row('6FBppLvnHy0XOQ2wWre8RT', 'Remembrance', {
    confidence_tier: 'high',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '專輯名 Original Soundtrack' },
    special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
    reason_zh: 'Arise OST 明示；對照組維持配樂但去掉未證實純音樂',
    evidence_used: ['identity.album_name', 'identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('2mvp2zReyW1Z7f5xLRm1nv', 'Lullaby over the Lake', {
    confidence_tier: 'medium',
    genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'David García 遊戲 Arise 系譜' },
    special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
    reason_zh: '同 OST 對照；湖邊搖籃曲 BGM',
    evidence_used: ['identity.title', 'identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('7ajpbW6tBpqUI9foCtwlLw', '祝福', {
    confidence_tier: 'high',
    genre_profile: { primary_genre: 'pop', subgenres: ['adult_contemporary'], secondary_genres: [], confidence: 'inferred' },
    language: { value: '日文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'YOASOBI 日文流行／動漫 tie-in 系譜' },
    special_types: [{ value: '動漫', confidence: 'inferred' }],
    reason_zh: 'D.1 若未覆蓋此首則應為 J-pop；歌手 YOASBI 強線索',
    evidence_used: ['identity.artists', 'identity.title'],
    unverified_fields: ['vocal_language'],
  }),
];
