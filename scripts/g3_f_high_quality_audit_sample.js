/**
 * G3-F High 已採用曲庫 — 品質抽樣盤點（唯讀）
 * node scripts/g3_f_high_quality_audit_sample.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { load_g3_f_adopt_registry } from '../lib/classification/g3_f/g3_f_adopt_registry_store.js';
import { FILE_CLASSIFICATION_INDEX } from '../lib/classification/paths.js';

const SEED = 20261024;
const TARGET_N = 100;
const OUT_DIR = path.join(process.cwd(), 'reports', 'g3-f-quality-audit');

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function csv_escape(s) {
  const t = s == null ? '' : String(s);
  if (/[",\r\n]/.test(t)) {
    return '"' + t.replace(/"/g, '""') + '"';
  }
  return t;
}

function tags_summary(tags) {
  if (!tags || !tags.length) {
    return '';
  }
  const parts = [];
  for (let i = 0; i < tags.length; i += 1) {
    const tg = tags[i];
    parts.push((tg.dimension || '') + ':' + (tg.value || ''));
  }
  return parts.join('; ');
}

function evidence_summary(entry) {
  const snap = entry.inference_snapshot || {};
  const bits = [];
  if (snap.reason_zh) {
    bits.push(snap.reason_zh);
  }
  if (snap.language && snap.language.evidence) {
    bits.push('lang:' + snap.language.evidence);
  }
  if (!bits.length && entry.adopted_classification) {
    bits.push('adopted_classification_only');
  }
  return bits.join(' | ');
}

function has_classification_basis(entry) {
  const snap = entry.inference_snapshot || {};
  if (snap.reason_zh && String(snap.reason_zh).trim().length > 0) {
    return true;
  }
  if (snap.evidence_used && snap.evidence_used.length > 0) {
    return true;
  }
  if (snap.language && snap.language.evidence && String(snap.language.evidence).trim().length > 0) {
    return true;
  }
  return false;
}

function build_track_row(id, entry, index_row) {
  const display = (index_row && index_row.display) || {};
  const gp = (index_row && index_row.genre_profile) || entry.adopted_classification?.genre_profile || {};
  const snap = entry.inference_snapshot || {};
  const artists = (display.artists || []).filter(function (a, i, arr) {
    return arr.indexOf(a) === i;
  });
  return {
    track_id: id,
    title: display.name || snap.title || '',
    artists: artists.join(' / '),
    album: display.album_name || '',
    spotify_url: 'https://open.spotify.com/track/' + id,
    primary_genre: gp.primary_genre || '',
    subgenres: (gp.subgenres || []).join('|'),
    secondary_genres: (gp.secondary_genres || []).join('|'),
    tags: tags_summary(index_row ? index_row.tags : []),
    confidence: gp.confidence || snap.confidence || '',
    confidence_tier: entry.confidence_tier || snap.confidence_tier || '',
    inference_source: entry.inference_source || snap.source || '',
    wave_id: entry.wave_id || '',
    genre_profile_source: gp.source || '',
    evidence_summary: evidence_summary(entry),
    evidence_used: (snap.evidence_used || []).join('|'),
    provenance_unverified: snap.provenance && snap.provenance.provenance_unverified === true,
    has_basis: has_classification_basis(entry),
  };
}

function stratified_sample(rows, targetN, seed) {
  const rand = mulberry32(seed);
  /** @type {Record<string, object[]>} */
  const by_genre = {};
  for (let i = 0; i < rows.length; i += 1) {
    const g = rows[i].primary_genre || 'unknown';
    if (!by_genre[g]) {
      by_genre[g] = [];
    }
    by_genre[g].push(rows[i]);
  }
  const genres = Object.keys(by_genre).sort();
  const total = rows.length;
  /** @type {object[]} */
  let picked = [];
  /** @type {Record<string, number>} */
  const quota = {};
  let allocated = 0;
  for (let i = 0; i < genres.length; i += 1) {
    const g = genres[i];
    const n = by_genre[g].length;
    const q = Math.max(n > 0 ? 1 : 0, Math.round((targetN * n) / total));
    quota[g] = Math.min(q, n);
    allocated += quota[g];
  }
  while (allocated > targetN) {
    let gMax = genres[0];
    for (let i = 0; i < genres.length; i += 1) {
      if (quota[genres[i]] > quota[gMax]) {
        gMax = genres[i];
      }
    }
    if (quota[gMax] <= 1) {
      break;
    }
    quota[gMax] -= 1;
    allocated -= 1;
  }
  while (allocated < targetN) {
    let gMax = genres[0];
    for (let i = 0; i < genres.length; i += 1) {
      const g = genres[i];
      if (by_genre[g].length > quota[g] && by_genre[g].length >= quota[gMax] + (g === gMax ? 0 : 1)) {
        if (by_genre[g].length - quota[g] > by_genre[gMax].length - quota[gMax]) {
          gMax = g;
        }
      }
    }
    if (quota[gMax] >= by_genre[gMax].length) {
      break;
    }
    quota[gMax] += 1;
    allocated += 1;
  }
  for (let i = 0; i < genres.length; i += 1) {
    const g = genres[i];
    const pool = shuffle(by_genre[g], rand);
    picked = picked.concat(pool.slice(0, quota[g]));
  }
  picked = shuffle(picked, rand).slice(0, targetN);
  return { sample: picked, quota_by_genre: quota, strata: genres };
}

function main() {
  const reg = load_g3_f_adopt_registry();
  const index_doc = JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
  const by = reg.adoptions_by_track_id || {};
  const ids = Object.keys(by).filter(function (id) {
    return by[id].status === 'adopted';
  });
  ids.sort();

  /** @type {object[]} */
  const all_rows = [];
  /** @type {Record<string, number>} */
  const genre_counts = {};
  /** @type {Record<string, number>} */
  const wave_counts = {};
  /** @type {Record<string, number>} */
  const inference_source_counts = {};
  let missing_basis = 0;
  let provenance_unverified_count = 0;

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const entry = by[id];
    const index_row = index_doc.tracks_by_id[id];
    const row = build_track_row(id, entry, index_row);
    all_rows.push(row);
    const pg = row.primary_genre || 'unknown';
    genre_counts[pg] = (genre_counts[pg] || 0) + 1;
    const w = row.wave_id || 'unknown';
    wave_counts[w] = (wave_counts[w] || 0) + 1;
    const src = row.inference_source || 'unknown';
    inference_source_counts[src] = (inference_source_counts[src] || 0) + 1;
    if (!row.has_basis) {
      missing_basis += 1;
    }
    if (row.provenance_unverified) {
      provenance_unverified_count += 1;
    }
  }

  const { sample, quota_by_genre, strata } = stratified_sample(all_rows, TARGET_N, SEED);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const dist = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    adopted_high_total: ids.length,
    primary_genre_counts: genre_counts,
    wave_id_counts: wave_counts,
    inference_source_counts: inference_source_counts,
    missing_classification_basis_count: missing_basis,
    provenance_unverified_count: provenance_unverified_count,
    index_track_count: index_doc.track_count,
    note_zh:
      'missing_classification_basis：registry inference_snapshot 無 reason_zh／evidence_used／language.evidence 任一者',
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'high-genre-distribution.json'),
    JSON.stringify(dist, null, 2) + '\n',
    'utf8'
  );

  const headers = [
    'track_id',
    'title',
    'artists',
    'album',
    'spotify_url',
    'primary_genre',
    'subgenres',
    'secondary_genres',
    'tags',
    'confidence',
    'confidence_tier',
    'inference_source',
    'wave_id',
    'genre_profile_source',
    'evidence_summary',
    'evidence_used',
    'provenance_unverified',
  ];
  const lines = [headers.join(',')];
  for (let i = 0; i < sample.length; i += 1) {
    const r = sample[i];
    lines.push(
      [
        r.track_id,
        r.title,
        r.artists,
        r.album,
        r.spotify_url,
        r.primary_genre,
        r.subgenres,
        r.secondary_genres,
        r.tags,
        r.confidence,
        r.confidence_tier,
        r.inference_source,
        r.wave_id,
        r.genre_profile_source,
        r.evidence_summary,
        r.evidence_used,
        r.provenance_unverified ? 'true' : 'false',
      ]
        .map(csv_escape)
        .join(',')
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, 'high-sample-100.csv'), '\uFEFF' + lines.join('\n') + '\n', 'utf8');

  const sample_genre_counts = {};
  for (let i = 0; i < sample.length; i += 1) {
    const g = sample[i].primary_genre || 'unknown';
    sample_genre_counts[g] = (sample_genre_counts[g] || 0) + 1;
  }

  const md = [];
  md.push('# G3-F High 已採用品質抽樣盤點（資料面）');
  md.push('');
  md.push('| 項目 | 值 |');
  md.push('|------|-----|');
  md.push('| **母體** | Registry adopted **' + ids.length + '** 首（High eligible 已全部採用） |');
  md.push('| **抽樣數** | **' + sample.length + '** |');
  md.push('| **隨機種子** | `' + SEED + '`（mulberry32 分層後 shuffle） |');
  md.push('| **分層維度** | `primary_genre`（依母體比例配額，每類至少 1 首若有母體） |');
  md.push('| **未分層** | 「易混淆曲風對」無獨立標籤欄位，**未**人工標註混淆對；僅能從 subgenre 多樣性事後聆聽 |');
  md.push('');
  md.push('## 資料完整性 vs 分類正確性');
  md.push('');
  md.push('- **資料完整性**：本報告只盤點 registry／index 上可讀的 genre、tags、evidence 文字與 `provenance_unverified`。');
  md.push('- **分類正確性**：**未**進行人工聆聽或對照外部真值；**不得**將 `confidence_tier=high` 或 `inferred` 解讀為準確率。');
  md.push('- **缺少分類依據列數**（母體）：**' + missing_basis + '**／' + ids.length);
  md.push('- **provenance_unverified=true**（母體）：**' + provenance_unverified_count + '**（staged 工作流程宣告，非 API session 驗證）');
  md.push('');
  md.push('## 母體 primary_genre 分布');
  md.push('');
  const gkeys = Object.keys(genre_counts).sort(function (a, b) {
    return genre_counts[b] - genre_counts[a];
  });
  for (let i = 0; i < gkeys.length; i += 1) {
    const g = gkeys[i];
    md.push('- `' + g + '`：**' + genre_counts[g] + '**');
  }
  md.push('');
  md.push('## 抽樣 primary_genre 覆蓋（n=' + sample.length + '）');
  md.push('');
  const sk = Object.keys(sample_genre_counts).sort();
  for (let i = 0; i < sk.length; i += 1) {
    const g = sk[i];
    md.push('- `' + g + '`：抽樣 **' + sample_genre_counts[g] + '**（配額目標 ' + (quota_by_genre[g] || 0) + '）');
  }
  md.push('');
  md.push('## 品質風險（現有資料**無法**判定者）');
  md.push('');
  md.push('1. **主觀曲風邊界**（pop vs rnb_soul、folk vs pop_ballad 等）需人工聽音訊，CSV 僅供試聽清單。');
  md.push('2. **語言／人聲未驗證**：多數 `vocal_verification_status=unverified`。');
  md.push('3. **Agent 自報 provenance**：`provenance_unverified=true` 為常態，不代表分類錯誤，但也不代表已獨立核實。');
  md.push('4. **無準確率百分比**：本次未標註人工正確／錯誤計數。');
  md.push('');
  md.push('## 產物');
  md.push('');
  md.push('- `high-sample-100.csv`（UTF-8 BOM）');
  md.push('- `high-genre-distribution.json`');
  md.push('- `high-quality-audit-summary.md`');
  md.push('');

  fs.writeFileSync(path.join(OUT_DIR, 'high-quality-audit-summary.md'), md.join('\n'), 'utf8');

  console.log(
    JSON.stringify(
      {
        adopted: ids.length,
        sample_n: sample.length,
        strata: strata.length,
        missing_basis: missing_basis,
        out_dir: OUT_DIR,
      },
      null,
      2
    )
  );
}

main();
