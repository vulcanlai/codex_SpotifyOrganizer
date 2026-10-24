/**
 * G3-D.4 批次 01–03 Cursor Agent 草稿（本機填寫後寫入 JSON）
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import { G3_D4_AGENT_DRAFTS_DIR, G3_D4_AGENT_SOURCE, G3_D4_AGENT_METHOD } from './paths_d4.js';
import { validate_g3_d4_agent_batch } from './g3_d4_validate_agent_batch.js';
import { reconcile_d1_d3_d4 } from './g3_d4_reconcile.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';

function base(track_id, title, fields) {
  return Object.assign(
    {
      track_id: track_id,
      title: title,
      source: G3_D4_AGENT_SOURCE,
      method: G3_D4_AGENT_METHOD,
      inference_source: G3_D4_AGENT_SOURCE,
      confidence: 'inferred',
      human_locked: false,
    },
    fields
  );
}

const BATCHES = {
  'g3d4-batch-01': [
    base('1BmgC9xYbGQvuJ6n4GBa4l', "I Can't Stop Loving You (Though I Try) - Remastered", {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'pop', subgenres: ['adult_contemporary'], secondary_genres: ['rock'], confidence: 'inferred' },
      language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Leo Sayer 1970s 英語流行代表曲系譜；Remastered 版本人聲曲' },
      contexts: [{ value: '懷舊', confidence: 'inferred' }],
      reason_zh: 'Leo Sayer 英語流行／soft rock 系譜；D.1 雖判 pop 但 reason 模板化，此處依歌手作品脈絡補 adult_contemporary',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['vocal_language'],
      version_uncertainty: true,
    }),
    base('1ENHNwnyaxwdzajxpMZpZB', 'Vanishing Grace (Devotion)', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'The Last of Us 配樂系譜；是否含人聲未核實' },
      special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
      reason_zh: 'Gustavo Santaolalla TLOU 配樂子曲；D.1 僅因作曲者 regex，改標 game_score 且不加未證實純音樂',
      evidence_used: ['identity.artists', 'identity.title'],
      unverified_fields: ['instrumental_vs_vocal'],
    }),
    base('0cd61fgEIxajNPSz4oE6R0', "It Can't Last (Sunset)", {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '同 TLOU 配樂脈絡' },
      special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
      reason_zh: 'Santaolalla TLOU 場景曲 Sunset 段；配樂合理但非模板「改編 instrumental」理由',
      evidence_used: ['identity.artists', 'identity.title'],
      unverified_fields: ['vocal_language'],
    }),
    base('4QxdflIU3rGc9cdAdwqL4P', 'Forgotten Battlefield - Red Birds are Tied to the Ground', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'Clair Obscur 區域名＋Lorien Testard' },
      special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
      reason_zh: '曲名 Forgotten Battlefield 為遊戲區域 BGM；比 D.1 composer-only 理由更具體',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['vocal_language'],
    }),
    base('6uIXIZmKdEswGUpHJeNSkk', 'Mutter', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'pop', subgenres: ['adult_contemporary'], secondary_genres: ['folk'], confidence: 'inferred' },
      language: { value: '其他', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Milva 義德系 Schlager／流行 repertoire；德語曲名 Mutter' },
      contexts: [{ value: '懷舊', confidence: 'inferred' }],
      reason_zh: 'D.1 fallback unknown；Milva 以德義語流行與實驗曲目著稱，非 metadata 不足',
      evidence_used: ['identity.artists', 'identity.title'],
      unverified_fields: ['vocal_language'],
    }),
    base('46NGj9GORryUhLYkL6nnGs', 'Forgotten Battlefield - Divided Swords', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '同 Clair Obscur 戰場區域命名' },
      special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
      reason_zh: 'Divided Swords 為同區域另一 BGM 變奏；維持 game_score 但理由逐曲具體化',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['vocal_language'],
    }),
    base('6LGyvMY9PF1Q3WZoNK584I', 'Machine Guns And Motorbikes', {
      confidence_tier: 'low',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['film_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'The Newton Brothers 影視配樂系譜；單曲 metadata  sparse' },
      reason_zh: 'Newton Brothers 多為影視配樂，但曲名像動作片 cue；信心降 low 因缺 album',
      evidence_used: ['identity.artists', 'identity.title'],
      unverified_fields: ['primary_genre', 'vocal_language'],
    }),
    base('3WvyU30aU01QBSAig001uL', '前前後後左左右右', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'rock', subgenres: ['pop_rock'], secondary_genres: ['pop'], confidence: 'inferred' },
      language: { value: '國語', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Nicholas Tse 華語搖滾／流行作品系譜' },
      contexts: [{ value: '運動', confidence: 'inferred' }],
      reason_zh: '謝霆鋒中文搖滾單曲；D.1 unknown 為規則 fallback，非真無資料',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['vocal_language'],
    }),
    base('7xdLlJHqhWRxK3WgVV5ROr', '早知', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'pop', subgenres: ['pop_ballad'], secondary_genres: ['rock'], confidence: 'inferred' },
      language: { value: '粵語', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: '謝霆鋒粵語流行 ballad 系譜' },
      contexts: [{ value: '放鬆', confidence: 'inferred' }],
      reason_zh: '粵語情歌標題早知；依歌手港樂作品脈絡，非 metadata 不足 unknown',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['vocal_language'],
    }),
    base('6hNHv8R1k5FChHn80uuYES', 'Photograph - Live', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'pop', subgenres: ['pop_ballad'], secondary_genres: ['folk'], confidence: 'inferred' },
      language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Ed Sheeran 英語現場版代表曲' },
      special_types: [{ value: '現場演唱', confidence: 'inferred' }],
      reason_zh: 'Ed Sheeran Photograph 現場版；D.1 pop 正確但理由為歌手 regex 模板，補 ballad 子類',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['recording_version'],
      version_uncertainty: true,
    }),
  ],
  'g3d4-batch-02': [
    base('2afTwwBpDFlbIwOFJTkYa6', 'Shortcut', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['film_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'David Fleming 影視／預告配樂系譜' },
      reason_zh: 'David Fleming 多為電影配樂 cue；Shortcut 像剪輯用短曲，非僅 composer 名命中',
      evidence_used: ['identity.artists', 'identity.title'],
      unverified_fields: ['vocal_language'],
    }),
    base('3MG5YlfPYsowf41sSA3wTo', '要我怎麼忘了他', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'pop', subgenres: ['pop_ballad'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '國語', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: '謝霆鋒國語抒情流行系譜' },
      contexts: [{ value: '放鬆', confidence: 'inferred' }],
      reason_zh: '中文抒情歌名＋謝霆鋒國語碟系譜；修正 D.1 unknown fallback',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['vocal_language'],
    }),
    base('6BVhfmtV4qoMPHY0tu3nPx', "L'Ultima Carmen - Live At Palast der Republik / 1989", {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'pop', subgenres: ['adult_contemporary'], secondary_genres: ['folk'], confidence: 'inferred' },
      language: { value: '其他', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Milva 1989 東德現場；義德語流行／實驗 repertoire' },
      special_types: [{ value: '現場演唱', confidence: 'inferred' }],
      reason_zh: 'Milva 現場 Carmen 改編；D.1 unknown 忽略歌手系譜，改 pop＋現場標籤',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['vocal_language', 'recording_version'],
      version_uncertainty: true,
    }),
    base('6sjCNpsNZ4JUDy6FgzKXTo', 'The Last of Us (Prevail)', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '標題明示 TLOU 主題音樂' },
      special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
      reason_zh: '曲名 The Last of Us (Prevail) 為遊戲主題延伸；比泛用配樂模板更精準',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['instrumental_vs_vocal'],
    }),
    base('41KpRS8w8Bdrs5ecWbSxtJ', 'Get Out', {
      confidence_tier: 'low',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['film_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'David Fleming 驚悚片配樂系譜推測' },
      reason_zh: 'Get Out 與 Jordan Peele 電影配樂脈絡相符但 metadata 未列電影名；低信心 film_score',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['primary_genre', 'linked_work'],
    }),
    base('2bj1wxQDFjDQ2sOfNHpcIK', 'Sleep Little Baby', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'David García Arise OST 系譜' },
      special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
      reason_zh: '搖籃曲式 BGM 標題；García 與 Arise 遊戲配樂一致，非 composer-only',
      evidence_used: ['identity.artists', 'identity.title'],
      unverified_fields: ['vocal_language'],
    }),
    base('3MPJtSUzQpFn64gqQQwlgz', 'All Gone (Elegy)', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'TLOU All Gone 系列 Elegy 段' },
      special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
      reason_zh: 'All Gone (Elegy) 為 TLOU 情感配樂子題；與 Isolation 版同系不同段',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['vocal_language'],
    }),
    base('38DcjZCFMcrmk7yTiFfAgz', 'Stone Wave Cliffs - Sandfall', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'Clair Obscur 地形區域名' },
      special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
      reason_zh: 'Stone Wave Cliffs 為遊戲探索區 BGM；Sandfall 子區名稱支持 game_score',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['vocal_language'],
    }),
    base('0O6lm9N6qJclxNFHl51nkr', 'Hoe Phase', {
      confidence_tier: 'high',
      genre_profile: { primary_genre: 'hip_hop', subgenres: ['pop_rap'], secondary_genres: ['pop'], confidence: 'inferred' },
      language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Drake 饒舌作品系譜；非僅 #osnrap 標籤' },
      reason_zh: 'Drake Hoe Phase 為 hip-hop 曲目；D.1 hip_hop 合理，理由改為歌手系譜而非 hashtag regex',
      evidence_used: ['identity.artists', 'identity.title'],
      unverified_fields: ['vocal_language'],
    }),
    base('3DDaxZ5Gx8Ud40AvX7BI0Y', 'Ancient Sanctuary - Entrance of the Village', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: '村莊入口場景命名＋Lorien Testard' },
      special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
      reason_zh: 'Ancient Sanctuary 村莊入口為典型 JRPG 式區域音樂；Testard 遊戲配樂脈絡',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['vocal_language'],
    }),
  ],
  'g3d4-batch-03': [
    base('3YA15UkoaKLFNWjaxXcvlR', 'Spring Meadows - Nightfall', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'Spring Meadows 區域夜間變體' },
      special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
      reason_zh: 'Nightfall 後綴表同一區域時段 BGM；非 D.1 泛用「遊戲配樂」一句',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['vocal_language'],
    }),
    base('47tdxjojS4KupiK5m7WWus', 'Perfect', {
      confidence_tier: 'high',
      genre_profile: { primary_genre: 'pop', subgenres: ['pop_ballad'], secondary_genres: ['folk'], confidence: 'inferred' },
      language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Ed Sheeran Perfect 全球流行 ballad 代表曲' },
      contexts: [{ value: '放鬆', confidence: 'inferred' }],
      reason_zh: 'Perfect 為 Sheeran 婚禮 ballad 代表作；子類 pop_ballad 比泛 pop 精準',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: [],
    }),
    base('5t2aCM0P6eLG92u8lulPdE', 'Perfect - Live', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'pop', subgenres: ['pop_ballad'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: '同曲 Live 版本人聲英文' },
      special_types: [{ value: '現場演唱', confidence: 'inferred' }],
      reason_zh: 'Perfect 現場版；版本不確定錄音年份但曲式仍 ballad',
      evidence_used: ['identity.title', 'identity.artists'],
      version_uncertainty: true,
      unverified_fields: ['recording_version'],
    }),
    base('5zZlLKtPS2Qylq5xu0K8ab', 'Lay It All on Me - Live', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'pop', subgenres: ['dance_pop'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Ed Sheeran 與 Rudimental 合作曲 live' },
      special_types: [{ value: '現場演唱', confidence: 'inferred' }],
      reason_zh: 'Lay It All on Me 偏舞曲流行合作曲；live 標記區分 studio 版',
      evidence_used: ['identity.title', 'identity.artists'],
      version_uncertainty: true,
      unverified_fields: ['recording_version'],
    }),
    base('7fo6BI3j3TrA5VkNcEzyA5', 'Romance', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'soundtrack_instrumental', subgenres: ['game_score'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '未確認', confidence: 'unknown', vocal_verification_status: 'unverified', evidence: 'David García 遊戲配樂系譜' },
      special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
      reason_zh: 'Romance 為 Arise OST 情感 cue；不加未證實純音樂標籤',
      evidence_used: ['identity.artists', 'identity.title'],
      unverified_fields: ['vocal_language'],
    }),
    base('6x1Ji00Z81c7vbC3nYwcr1', '悟 (電影 "新少林寺" 宣傳曲)', {
      confidence_tier: 'high',
      genre_profile: { primary_genre: 'pop', subgenres: ['pop_ballad'], secondary_genres: ['rock'], confidence: 'inferred' },
      language: { value: '國語', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: '劉德華《新少林寺》國語宣傳曲標題明示' },
      special_types: [{ value: '電影／電視原聲帶', confidence: 'inferred' }],
      reason_zh: '標題含電影新少林寺宣傳曲；D.1 unknown 忽略電影關係',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: ['vocal_language'],
    }),
    base('2LjvHenWfYY3QbixqBqJYo', 'Afterglow - Live', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'pop', subgenres: ['indie_pop'], secondary_genres: ['folk'], confidence: 'inferred' },
      language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Ed Sheeran Afterglow 單曲 live' },
      special_types: [{ value: '現場演唱', confidence: 'inferred' }],
      reason_zh: 'Afterglow 為 Sheeran 2020 單曲現場；indie_pop 子類貼近原曲編制',
      evidence_used: ['identity.title', 'identity.artists'],
      version_uncertainty: true,
      unverified_fields: ['recording_version'],
    }),
    base('1EPyHDLjefDI9lWM4CyguZ', 'Long Tall Glasses (I Can Dance) - Remastered', {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'pop', subgenres: ['dance_pop'], secondary_genres: ['rock'], confidence: 'inferred' },
      language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Leo Sayer 1970s 迪斯科流行 dance 曲' },
      contexts: [{ value: '懷舊', confidence: 'inferred' }],
      reason_zh: 'Long Tall Glasses 為 Leo Sayer 舞曲流行；Remastered 版 dance_pop 子類',
      evidence_used: ['identity.title', 'identity.artists'],
      version_uncertainty: true,
      unverified_fields: ['vocal_language'],
    }),
    base('7pkMxegKN12Jy0ysqJwBkt', "Eyes Don't Lie - Acoustic", {
      confidence_tier: 'medium',
      genre_profile: { primary_genre: 'pop', subgenres: ['indie_pop'], secondary_genres: [], confidence: 'inferred' },
      language: { value: '英文', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: 'Tones And I 英語 indie pop 系譜' },
      special_types: [{ value: '現場演唱', confidence: 'inferred' }],
      reason_zh: 'Tones And I Acoustic 版；D.1 unknown 忽略歌手 Dance Monkey 系譜',
      evidence_used: ['identity.artists', 'identity.title'],
      unverified_fields: ['vocal_language'],
    }),
    base('54LlZXtMSkChfNvMNEXgZs', '無間道 - 粵', {
      confidence_tier: 'high',
      genre_profile: { primary_genre: 'pop', subgenres: ['pop_ballad'], secondary_genres: ['rock'], confidence: 'inferred' },
      language: { value: '粵語', confidence: 'inferred', vocal_verification_status: 'unverified', evidence: '劉德華《無間道》粵語主題曲標題明示' },
      special_types: [{ value: '電影／電視原聲帶', confidence: 'inferred' }],
      contexts: [{ value: '懷舊', confidence: 'inferred' }],
      reason_zh: '無間道粵語版電影主題曲；D.1 unknown 為規則 fallback',
      evidence_used: ['identity.title', 'identity.artists'],
      unverified_fields: [],
    }),
  ],
};

export function write_g3_d4_batches_01_03() {
  const reconcile = reconcile_d1_d3_d4();
  const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks;
  fs.mkdirSync(G3_D4_AGENT_DRAFTS_DIR, { recursive: true });

  const ids = Object.keys(BATCHES);
  for (let i = 0; i < ids.length; i += 1) {
    const batch_id = ids[i];
    const tracks = BATCHES[batch_id];
    const batch = reconcile.batches.find(function (b) {
      return b.batch_id === batch_id;
    });
    if (!batch) {
      throw new Error('缺少 batch ' + batch_id);
    }
    const doc = {
      schema_version: 1,
      batch_id: batch_id,
      source: G3_D4_AGENT_SOURCE,
      model_note: 'G3-D.4 Cursor Agent ' + batch_id,
      tracks: tracks,
    };
    validate_g3_d4_agent_batch(doc, batch.track_ids, ev);
    write_json_atomic(path.join(G3_D4_AGENT_DRAFTS_DIR, batch_id + '.json'), doc);
  }
  return { batches_written: ids.length, track_count: 30 };
}
