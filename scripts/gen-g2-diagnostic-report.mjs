/**
 * 離線產生 G2 診斷報告（不呼叫外部 API）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const g1 = JSON.parse(
  fs.readFileSync(
    path.join(root, 'backup/enrichment/external/g1-30/verification-results.json'),
    'utf8'
  )
);
const g2 = JSON.parse(
  fs.readFileSync(
    path.join(root, 'backup/enrichment/external/g2-30/verification-results.json'),
    'utf8'
  )
);

function mb(r) {
  return r?.best_match?.external_id || '—';
}
function sc(r) {
  return r?.best_match?.match_score ?? '—';
}

function reason(a, b) {
  if (a.verify_status === 'error' && b.verify_status === 'not_found' && b.fallback_search_used) {
    return 'G1 ISRC 404 整首 error；G2 執行 fallback 但 Lucene 0 結果 → not_found。';
  }
  if (a.verify_status === 'matched' && b.verify_status === 'insufficient' && b.isrc_conflict) {
    return 'ISRC 直配錄音未變；G2 isrc_conflict（英/中藝人字串不吻合）將 matched 降為 insufficient。';
  }
  if (a.verify_status === 'error' && b.verify_status === 'matched') {
    return 'G1 ISRC 404 error；G2 fallback 找到候選且交叉比對達標 → matched。';
  }
  return '狀態依新引擎規則重新判定。';
}

const ids = Object.keys(g1.tracks).sort(function (a, b) {
  return (g1.tracks[a].source_title || '').localeCompare(
    g1.tracks[b].source_title || '',
    'zh-Hant'
  );
});

const lines = [];
lines.push('# G2 線上試驗診斷報告');
lines.push('');
lines.push('產生時間：2026-10-22（離線分析，未呼叫 MusicBrainz / Spotify API）');
lines.push('');
lines.push('資料來源：');
lines.push('- `backup/enrichment/external/g1-30/verification-results.json`');
lines.push('- `backup/enrichment/external/g2-30/verification-results.json`');
lines.push('- `backup/enrichment/external/g2-30/g1-vs-g2-compare.json`');
lines.push('');
lines.push('## 摘要');
lines.push('');
lines.push('| 指標 | G1 | G2 |');
lines.push('|---|---:|---:|');
lines.push('| matched | 12 | 9 |');
lines.push('| error | 12 | 0 |');
lines.push('| ambiguous | 2 | 2 |');
lines.push('| insufficient | 1 | 5 |');
lines.push('| not_found | 3 | 14 |');
lines.push('| 有候選 | 15 | 16 |');
lines.push('| 曲風標籤 | 9 | 9 |');
lines.push('| 網路請求 | 30 | 42 |');
lines.push('');
lines.push(
  '**matched 淨減 3**：4 首 G1 matched → G2 insufficient（ISRC 錄音相同，新增 `isrc_conflict`）；1 首 G1 error → G2 matched（fallback，`那些年`）。'
);
lines.push('');
lines.push(
  '**error 歸零**：G1 在 ISRC HTTP 404 時標 error 且無搜尋；G2 改 fallback，11 首仍無候選 → not_found。'
);
lines.push('');

lines.push('## 一、30 首逐首比較');
lines.push('');
lines.push(
  '| # | 歌名 | Spotify ID | G1 | G2 | G1 MB 錄音 | G2 MB 錄音 | G1 分 | G2 分 | G2 tier | ISRC 衝突 | Fallback | 狀態變化 |'
);
lines.push(
  '|---:|---|---|---|---|---|---|---:|---:|---|:---:|:---:|---|'
);

let n = 0;
for (let i = 0; i < ids.length; i += 1) {
  const id = ids[i];
  n += 1;
  const a = g1.tracks[id];
  const b = g2.tracks[id];
  const ch =
    a.verify_status === b.verify_status ? '—' : a.verify_status + '→' + b.verify_status;
  lines.push(
    '| ' +
      n +
      ' | ' +
      a.source_title +
      ' | `' +
      id +
      '` | ' +
      a.verify_status +
      ' | ' +
      b.verify_status +
      ' | `' +
      mb(a) +
      '` | `' +
      mb(b) +
      '` | ' +
      sc(a) +
      ' | ' +
      sc(b) +
      ' | ' +
      (b.match_tier || '—') +
      ' | ' +
      (b.isrc_conflict ? '是' : '否') +
      ' | ' +
      (b.fallback_search_used ? '是' : '否') +
      ' | ' +
      ch +
      ' |'
  );
}

lines.push('');
lines.push('## 二、所有狀態改變曲目（共 16 首）');
lines.push('');

const changed = ids.filter(function (id) {
  return g1.tracks[id].verify_status !== g2.tracks[id].verify_status;
});

for (let c = 0; c < changed.length; c += 1) {
  const id = changed[c];
  const a = g1.tracks[id];
  const b = g2.tracks[id];
  const search_keys = (b.query_keys_used || []).filter(function (k) {
    return k.indexOf('search:') === 0;
  });
  lines.push('### ' + a.source_title + ' (`' + id + '`)');
  lines.push('');
  lines.push('- **G1 → G2**：' + a.verify_status + ' → ' + b.verify_status);
  lines.push(
    '- **MusicBrainz 錄音**：G1 `' +
      mb(a) +
      '` → G2 `' +
      mb(b) +
      '`' +
      (mb(a) === mb(b) && mb(a) !== '—' ? '（相同）' : '')
  );
  lines.push('- **分數**：G1 ' + sc(a) + ' / G2 ' + sc(b));
  lines.push(
    '- **G2 match_tier**：' + (b.match_tier || '—') + ' — ' + (b.match_tier_note || '')
  );
  lines.push('- **ISRC 衝突**：' + (b.isrc_conflict ? '是' : '否'));
  lines.push(
    '- **Fallback**：' +
      (b.fallback_search_used ? '是（' + (search_keys.join('；') || '—') + '）' : '否')
  );
  lines.push('- **本機藝人**：' + JSON.stringify(a.source_artists));
  if (b.best_match) {
    lines.push('- **MB 藝人**：' + JSON.stringify(b.best_match.artist_names));
  }
  lines.push('- **原因說明**：' + reason(a, b));
  lines.push('');
}

lines.push('## 三、matched 下降專項分析');
lines.push('');
lines.push('### 3.1 因 ISRC 衝突檢查而降級（4 首）');
lines.push('');
lines.push('| 歌名 | Spotify ID | MB 錄音（G1=G2） | 本機藝人 vs MB 藝人 |');
lines.push('|---|---|---|---|');

const down = [
  '07BLMnpZYg6RT0H1elobry',
  '0OsnKPaV2R8FmE2HRw1WTS',
  '0cdD41ei03AR3cAynWDIoV',
  '0kowEmoCAdTMJj5dm44eGK',
];
for (let d = 0; d < down.length; d += 1) {
  const id = down[d];
  const a = g1.tracks[id];
  const b = g2.tracks[id];
  lines.push(
    '| ' +
      a.source_title +
      ' | `' +
      id +
      '` | `' +
      mb(b) +
      '` | `' +
      (a.source_artists[0] || '') +
      '` vs `' +
      (b.best_match ? b.best_match.artist_names.join('、') : '') +
      '` |'
  );
}

lines.push('');
lines.push(
  '四首皆 **ISRC 直配、錄音 ID 不變、match_score 仍 60**；G2 因 `artist_best_ratio=0`（拉丁/英文 display 對中文/韓文 MB 藝人）設 `isrc_conflict=true`，`verify_status` 由 matched 改 insufficient。`artist_name_variants` 目前僅含 display 拉丁名，未改善跨語系比對。'
);
lines.push('');
lines.push('### 3.2 其他假設');
lines.push('');
lines.push('- **歌手名格式**：是，降級 4 首主因；非版本或曲長問題。');
lines.push('- **match_tier 不一致**：否；insufficient 對應 text_weak。');
lines.push('- **G1 誤判成功**：4 首在 ISRC 可信前提下 G1 偏寬。');
lines.push('- **G2 規則誤判**：4 首 ISRC 衝突過嚴（非錄音錯配）。');
lines.push('- **fallback 升 matched**：`那些年` 需人工確認版本。');
lines.push('');

lines.push('## 四、G1 十二首 error 的 fallback 成效');
lines.push('');

const errs = ids.filter(function (id) {
  return g1.tracks[id].verify_status === 'error';
});
const buckets = { matched: [], ambiguous: [], insufficient: [], not_found: [] };
for (let e = 0; e < errs.length; e += 1) {
  const id = errs[e];
  const st = g2.tracks[id].verify_status;
  if (buckets[st]) {
    buckets[st].push(g1.tracks[id].source_title);
  }
}

lines.push('| G2 結果 | 首數 | 曲目 |');
lines.push('|---|---:|---|');
lines.push('| matched | ' + buckets.matched.length + ' | ' + buckets.matched.join('、') + ' |');
lines.push(
  '| ambiguous | ' + buckets.ambiguous.length + ' | ' + (buckets.ambiguous.join('、') || '—') + ' |'
);
lines.push(
  '| insufficient | ' +
    buckets.insufficient.length +
    ' | ' +
    (buckets.insufficient.join('、') || '—') +
    ' |'
);
lines.push(
  '| not_found | ' + buckets.not_found.length + ' | ' + buckets.not_found.join('、') + ' |'
);
lines.push('');
lines.push('- 12/12 執行 fallback（+12 請求）。');
lines.push('- 11/12：查詢有跑、**0 候選**（非 error）。');
lines.push('- 1/12：有候選且 matched。');
lines.push('');
lines.push('**典型 fallback 查詢**（G1 error 且 G2 not_found）：');
lines.push('');
for (let f = 0; f < errs.length; f += 1) {
  const id = errs[f];
  const b = g2.tracks[id];
  if (b.verify_status !== 'not_found' || !b.fallback_search_used) {
    continue;
  }
  const sk = (b.query_keys_used || []).filter(function (k) {
    return k.indexOf('search:') === 0;
  });
  lines.push('- ' + g1.tracks[id].source_title + '：' + (sk[0] || '—'));
}
lines.push('');

lines.push('## 五、Lemon Tree');
lines.push('');
const lt = '05B8gt3dCepBPmGe7SPAUo';
const la = g1.tracks[lt];
const lb = g2.tracks[lt];
lines.push('- Spotify ID：`05B8gt3dCepBPmGe7SPAUo`');
lines.push('- G1 / G2：**matched**（無變化）');
lines.push('- MB 錄音：`0d88cdc0-f5c9-4dff-a7a5-98944b4af2bf`（蘇慧倫）');
lines.push('- G2 tier：**isrc_direct**；無 fallback；無 ISRC 衝突');
lines.push('- 未誤配 Fool\'s Garden。');
lines.push('');

lines.push('## 六、查證規則評估');
lines.push('');
lines.push('| 項目 | 結論 |');
lines.push('|---|---|');
lines.push('| ISRC 404 → fallback | 機制正確；本批命中率 1/12 |');
lines.push('| 取消假 error | 合理；改以 not_found 呈現 |');
lines.push('| ISRC 衝突 | 方向對，實作未併入本機多語藝人名，誤降 4 首 |');
lines.push('| 單次 AND artist 搜尋 | 對多數 G1 error 曲過嚴 |');
lines.push('');

lines.push('## 七、最小修正建議（待確認，本次不實作）');
lines.push('');
lines.push(
  '1. **ISRC 衝突**：ISRC 唯一候選且歌名高相似時，以 `extra_artist_names` 計算藝人比；或禁止「僅跨書寫系統字串 0 分」觸發 conflict。'
);
lines.push('2. **artist_name_variants**：擴大讀取本機已有中文/別名字段（不臆造），改善 fallback 的 CJK `search_artist`。');
lines.push('3. **fallback**：維持 1 次 HTTP，可改寬 Lucene 查詢並用既有 `score_candidate` 篩選（舞月光、費翔等）。');
lines.push('4. **那些年**：人工核對 MB `38801136-b027-40a8-bbf0-00bc06991a6f`。');
lines.push('');

lines.push('## 八、下一步');
lines.push('');
lines.push('1. 修正衝突與 variant 後跑離線測試，再決定是否重跑 G2 線上。');
lines.push('2. `npm run verify:g2-compare` 更新前後對照。');
lines.push('3. G2-2 評估 Wikidata 藝人 label（有來源、僅搜尋輔助）。');
lines.push('');

const out = path.join(root, 'backup/enrichment/external/g2-30/g2-diagnostic-report-zh.md');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log('Wrote', out);
