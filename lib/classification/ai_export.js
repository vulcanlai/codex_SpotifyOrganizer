/**
 * AI 測試樣本匯出
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  AI_TEST_DIR,
  FILE_AI_SAMPLE,
  FILE_AI_SAMPLE_SUMMARY,
  FILE_AI_CURSOR_INPUT,
  FILE_CLASSIFICATION_INDEX,
  AI_SAMPLE_SCHEMA_VERSION,
} from './paths.js';
import { write_json_atomic } from '../atomic_json.js';
import {
  select_ai_sample_track_ids,
  primary_artist_name,
  decade_from_tags,
} from './ai_sample_select.js';

export class AiExportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiExportError';
  }
}

function read_index() {
  if (!fs.existsSync(FILE_CLASSIFICATION_INDEX)) {
    throw new AiExportError(
      '缺少 classification-index.json，請先執行 npm run classify:build。'
    );
  }
  return JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
}

/**
 * @param {object} track_row
 */
function sample_track_payload(track_row) {
  const disp = track_row.display || {};
  return {
    spotify_id: track_row.spotify_id,
    name: disp.name,
    artists: disp.artists || [],
    album_name: disp.album_name || null,
    release_date: disp.release_date || null,
    release_date_precision: disp.release_date_precision || null,
    existing_tags: track_row.tags || [],
    metadata_status: track_row.metadata_status,
  };
}

/**
 * @param {object[]} tracks
 */
function build_cursor_ai_input_md(tracks, meta) {
  let md = '# Cursor AI 智慧分類測試（30 首）\n\n';
  md += '請依下列歌曲的本機 metadata 產生 `backup/classification/ai-test/ai-candidates.json`。\n\n';
  md += '## 規則\n\n';
  md += '1. 僅使用本檔與模型知識，不得呼叫 Spotify API 或付費 AI API。\n';
  md += '2. 不得捏造歌名、藝人、專輯或 Track ID。\n';
  md += '3. 中文歌名 ≠ 國語；英文歌名 ≠ 英文演唱；藝人國籍 ≠ 歌曲語言。\n';
  md += '4. confidence 僅能 `inferred` 或 `unknown`，禁止 `confirmed`。\n';
  md += '5. 證據不足時語言用「未確認」、曲風／情境可空陣列或 unknown。\n';
  md += '6. 語言：國語、台語、粵語、英文、日文、韓文、其他、未確認。\n';
  md += '7. 曲風（舊版相容）：流行、搖滾、電子、舞曲、嘻哈、爵士、古典、民謠、其他、未確認。\n';
  md += '8. **新版曲風（建議使用 genre_profile）**：先判斷主曲風（12 類：pop、rock、electronic、rnb_soul、hip_hop、folk、jazz、classical、country_blues、metal_punk、reggae_world、soundtrack_instrumental 或 unknown）；有依據時才填子曲風（40 類，見 genre_taxonomy）；次要主曲風最多 2 個；每個標籤需 evidence/method/source，confidence 僅 inferred/unknown。\n';
  md += '9. 不得因歌名語言、歌手慣常曲風或專輯類型就猜測；證據不足時 primary=unknown、subgenres=[]。\n';
  md += '10. 情境：運動、開車、放鬆、睡前、工作、派對、懷舊、其他（與曲風分開， moods 陣列）。\n';
  md += '11. 特殊類型：電影／電視原聲帶、動漫、遊戲音樂、純音樂、現場演唱、完整專輯收藏、其他、未確認。\n\n';
  md += `## 樣本資訊\n\n`;
  md += `- 樣本 ID：${meta.sample_id}\n`;
  md += `- 匯出時間（UTC）：${meta.exported_at}\n`;
  md += `- 曲目數：${tracks.length}\n\n`;
  md += '## 歌曲清單\n\n';

  for (let i = 0; i < tracks.length; i += 1) {
    const t = tracks[i];
    md += `### ${i + 1}. ${t.name}\n\n`;
    md += `- **Spotify Track ID**：\`${t.spotify_id}\`\n`;
    md += `- **藝人**：${(t.artists || []).join('、')}\n`;
    md += `- **專輯**：${t.album_name || '（無）'}\n`;
    md += `- **發行日期**：${t.release_date || '（無）'}`;
    if (t.release_date_precision) {
      md += `（precision: ${t.release_date_precision}）`;
    }
    md += '\n';
    if (t.existing_tags && t.existing_tags.length) {
      md += '- **現有分類**：\n';
      for (let k = 0; k < t.existing_tags.length; k += 1) {
        const tag = t.existing_tags[k];
        md += `  - ${tag.dimension}：${tag.value}（${tag.confidence}）— ${tag.evidence || ''}\n`;
      }
    }
    md += '\n';
  }

  md += '## 輸出格式\n\n';
  md += '寫入 `backup/classification/ai-test/ai-candidates.json`，';
  md += 'schema_version=1、source=cursor_ai、sample_size 與 candidates 陣列。\n';
  md += '每首含 language（物件）、genres（舊版相容陣列）、可選 genre_profile（主／次／子曲風代碼 + 標籤物件）、moods/special_types 陣列。\n';
  md += '情境維度請用 moods 陣列（對應 context）。\n';
  return md;
}

/**
 * @param {object} opts
 */
export function export_ai_test_sample(opts) {
  const options = opts || {};
  const count = typeof options.count === 'number' ? options.count : 30;
  const index_doc = options.index_doc || read_index();
  const tracks_by_id = index_doc.tracks_by_id || {};
  const selection = select_ai_sample_track_ids(tracks_by_id, count);

  if (!selection.ok) {
    throw new AiExportError(selection.reason || '無法選出足夠樣本');
  }

  /** @type {object[]} */
  const tracks = [];
  for (let i = 0; i < selection.selected_ids.length; i += 1) {
    const id = selection.selected_ids[i];
    tracks.push(sample_track_payload(tracks_by_id[id]));
  }

  const exported_at = new Date().toISOString();
  const sample_id = crypto
    .createHash('sha256')
    .update(selection.selected_ids.join('|'))
    .digest('hex')
    .slice(0, 16);

  const sample_doc = {
    schema_version: AI_SAMPLE_SCHEMA_VERSION,
    exported_at,
    sample_id,
    requested_count: count,
    track_count: tracks.length,
    track_ids: selection.selected_ids,
    tracks,
  };

  const summary_doc = {
    schema_version: AI_SAMPLE_SCHEMA_VERSION,
    exported_at,
    sample_id,
    eligible_count: selection.eligible_count,
    selected_count: tracks.length,
    decades: count_by_field(tracks_by_id, selection.selected_ids, decade_from_tags),
    unique_artists: count_unique_artists(tracks_by_id, selection.selected_ids),
  };

  if (options.write !== false) {
    if (!fs.existsSync(AI_TEST_DIR)) {
      fs.mkdirSync(AI_TEST_DIR, { recursive: true });
    }
    write_json_atomic(FILE_AI_SAMPLE, sample_doc);
    write_json_atomic(FILE_AI_SAMPLE_SUMMARY, summary_doc);
    fs.writeFileSync(
      FILE_AI_CURSOR_INPUT,
      build_cursor_ai_input_md(tracks, { sample_id, exported_at }),
      { encoding: 'utf8' }
    );
  }

  return { sample_doc, summary_doc, selection };
}

function count_by_field(tracks_by_id, ids, fn) {
  const out = {};
  for (let i = 0; i < ids.length; i += 1) {
    const key = fn(tracks_by_id[ids[i]]);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function count_unique_artists(tracks_by_id, ids) {
  const set = {};
  for (let i = 0; i < ids.length; i += 1) {
    set[primary_artist_name(tracks_by_id[ids[i]])] = true;
  }
  return Object.keys(set).length;
}
