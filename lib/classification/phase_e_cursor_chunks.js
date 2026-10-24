/**
 * phase-e-100：Cursor 分批輸入（每批 20 首）
 */
import fs from 'node:fs';
import {
  PHASE_E_CURSOR_CHUNKS_DIR,
  PHASE_E_CHUNK_SIZE,
  FILE_PHASE_E_CANDIDATES_DRAFT,
} from './ai_test_batches.js';

function build_chunk_md(tracks, meta, chunk_index, chunk_total) {
  let md = '# Cursor AI 智慧分類 — phase-e-100（第 ' + chunk_index + ' / ' + chunk_total + ' 批）\n\n';
  md += '請依下列歌曲的本機 metadata 產生 **partial** JSON，';
  md += '存成 `backup/classification/ai-test/phase-e-100/partial-candidates/chunk-' + String(chunk_index).padStart(2, '0') + '.json`。\n\n';
  md += '## 規則\n\n';
  md += '1. 僅使用本檔與模型知識，**不得**呼叫 Spotify API 或付費 AI API。\n';
  md += '2. 不得捏造歌名、藝人、專輯或 Track ID；不得假裝已聽過音訊。\n';
  md += '3. 中文歌名 ≠ 國語；不得因歌名文字直接認定演唱語言。\n';
  md += '4. 不得僅憑藝人常見曲風判定該曲；證據不足時 primary=unknown。\n';
  md += '5. confidence 僅能 `inferred` 或 `unknown`；禁止 `confirmed`。\n';
  md += '6. 使用 12 主曲風 + 40 子曲風字典（genre_taxonomy）；不得新增未定義代碼。\n';
  md += '7. 每首需 genre_profile（主／次／子）、language、moods/contexts、special_types、evidence。\n\n';
  md += '## 樣本\n\n';
  md += '- 樣本 ID：' + meta.sample_id + '\n';
  md += '- 批次：' + chunk_index + '/' + chunk_total + '\n';
  md += '- 本批曲目數：' + tracks.length + '\n\n';
  md += '## 歌曲清單\n\n';

  for (let i = 0; i < tracks.length; i += 1) {
    const t = tracks[i];
    md += '### ' + t.name + '\n\n';
    md += '- **Spotify Track ID**：`' + t.spotify_id + '`\n';
    md += '- **藝人**：' + (t.artists || []).join('、') + '\n';
    md += '- **專輯**：' + (t.album_name || '（無）') + '\n';
    md += '- **發行日期**：' + (t.release_date || '（無）') + '\n\n';
  }

  md += '## 輸出格式\n\n';
  md += 'partial JSON：`{ "candidates": [ ... ] }`，schema 同 v2 ai-candidates（schema_version=2）。\n';
  md += '完成後執行：`npm run classify:ai-merge-phase-e` 合併，`npm run classify:ai-import-phase-e` 匯入。\n';
  return md;
}

/**
 * @param {object[]} tracks
 * @param {{ sample_id: string, exported_at: string }} meta
 */
export function write_phase_e_cursor_chunks(tracks, meta) {
  fs.mkdirSync(PHASE_E_CURSOR_CHUNKS_DIR, { recursive: true });
  const chunk_size = PHASE_E_CHUNK_SIZE;
  const total = Math.ceil(tracks.length / chunk_size) || 0;
  const manifest_chunks = [];

  for (let c = 0; c < total; c += 1) {
    const start = c * chunk_size;
    const slice = tracks.slice(start, start + chunk_size);
    const name = 'chunk-' + String(c + 1).padStart(2, '0') + '.md';
    const path = PHASE_E_CURSOR_CHUNKS_DIR + '/' + name;
    fs.writeFileSync(
      path,
      build_chunk_md(slice, meta, c + 1, total),
      'utf8'
    );
    manifest_chunks.push({
      chunk_index: c + 1,
      file: name,
      track_count: slice.length,
      track_ids: slice.map(function (t) {
        return t.spotify_id;
      }),
    });
  }

  const draft_stub = {
    schema_version: 2,
    candidate_version: 2,
    source: 'cursor_ai_pending',
    test_batch_id: 'phase-e-100',
    sample_id: meta.sample_id,
    taxonomy_version: 1,
    candidates: [],
    note: '請以 partial-candidates 合併後匯入，勿以規則式程式冒充 AI 結果',
  };
  fs.writeFileSync(
    FILE_PHASE_E_CANDIDATES_DRAFT,
    JSON.stringify(draft_stub, null, 2) + '\n',
    'utf8'
  );

  return { chunk_total: total, chunks: manifest_chunks };
}
