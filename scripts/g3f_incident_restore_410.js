/**
 * G3-F 事故還原（410）— 單次執行腳本；還原前檢查 → 710 備份 → 快照還原 → 驗收
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  FILE_CLASSIFICATION_INDEX,
  FILE_CLASSIFICATION_SUMMARY,
  FILE_FORMAL_CLASSIFICATION_STATE,
  FILE_G3_F_ADOPT_REGISTRY,
  FILE_MANUAL_OVERRIDES,
  FILE_AI_REVIEW,
  CLASSIFICATION_DIR,
} from '../lib/classification/paths.js';
import { FILE_AI_REVIEW_V2 } from '../lib/classification/paths.js';
import { G3_F_ADOPT_BACKUP_FILES } from '../lib/classification/g3_f/g3_f_adopt_backup.js';
import { build_classification_index } from '../lib/classification/build_index.js';
import { build_formal_classification_state } from '../lib/classification/formal_state_build.js';
import { load_g3_f_adopt_registry } from '../lib/classification/g3_f/g3_f_adopt_registry_store.js';
import { select_g3_f_adopt_batch } from '../lib/classification/g3_f/g3_f_eligible.js';

const SNAPSHOT_ID = '2026-10-23T16-08-49-047Z';
const SNAPSHOT_DIR = path.join(
  CLASSIFICATION_DIR,
  'g3-f-adopt-snapshots',
  SNAPSHOT_ID
);

const FORMAL_FILES = [
  { name: 'g3-f-adopt-registry.json', path: FILE_G3_F_ADOPT_REGISTRY },
  { name: 'classification-index.json', path: FILE_CLASSIFICATION_INDEX },
  { name: 'classification-summary.json', path: FILE_CLASSIFICATION_SUMMARY },
  { name: 'formal-classification-state.json', path: FILE_FORMAL_CLASSIFICATION_STATE },
];

function sha256_file(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function adopted_ids_from_reg_file(p) {
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  const map = doc.adoptions_by_track_id || {};
  return Object.keys(map).filter(function (id) {
    return map[id] && map[id].status === 'adopted';
  });
}

function fail(msg) {
  console.error('[ABORT]', msg);
  process.exit(1);
}

function load_dry_batch(rel) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), 'utf8')).batch_track_ids;
}

// --- pre-checks ---
if (!fs.existsSync(SNAPSHOT_DIR)) {
  fail('指定快照不存在：' + SNAPSHOT_DIR);
}
const snapManifest = JSON.parse(
  fs.readFileSync(path.join(SNAPSHOT_DIR, 'manifest.json'), 'utf8')
);
for (let i = 0; i < G3_F_ADOPT_BACKUP_FILES.length; i += 1) {
  const name = G3_F_ADOPT_BACKUP_FILES[i];
  const fp = path.join(SNAPSHOT_DIR, name);
  if (!fs.existsSync(fp)) {
    fail('快照缺少檔案：' + name);
  }
  try {
    JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    fail('快照 JSON 無法解析：' + name);
  }
  if ((snapManifest.copied_files || []).indexOf(name) < 0) {
    fail('manifest 未列舉：' + name);
  }
}

const snap410 = adopted_ids_from_reg_file(path.join(SNAPSHOT_DIR, 'g3-f-adopt-registry.json'));
const cur710 = adopted_ids_from_reg_file(FILE_G3_F_ADOPT_REGISTRY);
if (snap410.length !== 410 || new Set(snap410).size !== 410) {
  fail('快照 registry 非 410 唯一 adopted');
}
if (cur710.length !== 710 || new Set(cur710).size !== 710) {
  fail('目前 registry 非 710 唯一 adopted');
}
const set410 = new Set(snap410);
const set710 = new Set(cur710);
for (let i = 0; i < snap410.length; i += 1) {
  if (!set710.has(snap410[i])) {
    fail('快照 410 不在目前 710 內：' + snap410[i]);
  }
}
const diff = cur710.filter(function (id) {
  return !set410.has(id);
});
if (diff.length !== 300) {
  fail('差集非 300：' + diff.length);
}
const snap410Doc = JSON.parse(
  fs.readFileSync(path.join(SNAPSHOT_DIR, 'g3-f-adopt-registry.json'), 'utf8')
);
const sel = select_g3_f_adopt_batch({
  batch_size: 300,
  batch_index: 0,
  registry_doc: snap410Doc,
  skip_registry_adopted: true,
});
const next300 = sel.batch.map(function (t) {
  return t.track_id;
});
const diffSet = new Set(diff);
for (let i = 0; i < next300.length; i += 1) {
  if (!diffSet.has(next300[i])) {
    fail('差集與誤採第四批不符：' + next300[i]);
  }
}

const untouchedBefore = {};
const untouchedPaths = [
  FILE_MANUAL_OVERRIDES,
  FILE_AI_REVIEW,
  FILE_AI_REVIEW_V2,
];
for (let i = 0; i < untouchedPaths.length; i += 1) {
  const p = untouchedPaths[i];
  if (fs.existsSync(p)) {
    untouchedBefore[p] = sha256_file(p);
  }
}

// --- incident backup 710 ---
const incidentRoot = path.join(CLASSIFICATION_DIR, 'incident-pre-restore-710');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const incidentDir = path.join(incidentRoot, stamp);
fs.mkdirSync(incidentDir, { recursive: true });

/** @type {object[]} */
const incidentEntries = [];
for (let i = 0; i < FORMAL_FILES.length; i += 1) {
  const f = FORMAL_FILES[i];
  const dest = path.join(incidentDir, f.name);
  fs.copyFileSync(f.path, dest);
  const srcSha = sha256_file(f.path);
  const destSha = sha256_file(dest);
  if (srcSha !== destSha) {
    fail('事故備份雜湊不一致：' + f.name);
  }
  incidentEntries.push({
    name: f.name,
    source_path: f.path,
    backup_path: dest,
    size_bytes: fs.statSync(f.path).size,
    sha256: srcSha,
  });
}
const incidentAdopted = adopted_ids_from_reg_file(path.join(incidentDir, 'g3-f-adopt-registry.json'));
if (incidentAdopted.length !== 710) {
  fail('事故備份 registry 非 710');
}
const incidentManifest = {
  schema_version: 1,
  purpose: 'incident_pre_restore_710',
  created_at: new Date().toISOString(),
  registry_adopted_count: 710,
  files: incidentEntries,
  restore_target_snapshot: SNAPSHOT_ID,
};
fs.writeFileSync(
  path.join(incidentDir, 'manifest.json'),
  JSON.stringify(incidentManifest, null, 2),
  'utf8'
);

// --- restore from snapshot (byte copy) ---
const snapShas = {};
for (let i = 0; i < FORMAL_FILES.length; i += 1) {
  const f = FORMAL_FILES[i];
  const src = path.join(SNAPSHOT_DIR, f.name);
  snapShas[f.name] = sha256_file(src);
  const tmp = path.join(CLASSIFICATION_DIR, '.restore-tmp-' + f.name);
  fs.copyFileSync(src, tmp);
  if (sha256_file(tmp) !== snapShas[f.name]) {
    fail('暫存檔雜湊不符：' + f.name);
  }
  fs.copyFileSync(tmp, f.path);
  fs.unlinkSync(tmp);
  if (sha256_file(f.path) !== snapShas[f.name]) {
    fail('還原後正式檔雜湊不符：' + f.name);
  }
}

for (let i = 0; i < untouchedPaths.length; i += 1) {
  const p = untouchedPaths[i];
  if (untouchedBefore[p] && fs.existsSync(p)) {
    if (sha256_file(p) !== untouchedBefore[p]) {
      fail('還原後意外變更：' + p);
    }
  }
}

// --- post verification ---
const after410 = adopted_ids_from_reg_file(FILE_G3_F_ADOPT_REGISTRY);
if (after410.length !== 410 || new Set(after410).size !== 410) {
  fail('還原後 registry 非 410');
}
const BATCH0 = load_dry_batch('reports/g3-f-adopt/pre-apply-verification-2026-10-24/dry-run.json');
const BATCH100 = load_dry_batch('reports/g3-f-adopt/batch-100-dry-run-2026-10-24/dry-run.json');
const BATCH300 = load_dry_batch('reports/g3-f-adopt/batch-300-dry-run/dry-run.json');
const afterSet = new Set(after410);
function allIn(ids) {
  for (let i = 0; i < ids.length; i += 1) {
    if (!afterSet.has(ids[i])) {
      return false;
    }
  }
  return true;
}
for (let i = 0; i < diff.length; i += 1) {
  if (afterSet.has(diff[i])) {
    fail('誤採 ID 仍在 registry：' + diff[i]);
  }
}

const idx = JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
const sum = JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_SUMMARY, 'utf8'));
const formal = JSON.parse(fs.readFileSync(FILE_FORMAL_CLASSIFICATION_STATE, 'utf8'));
if (sum.track_count !== 7759) {
  fail('track_count 非 7759');
}
let b300gp = true;
let b300formal = true;
for (let i = 0; i < BATCH300.length; i += 1) {
  const id = BATCH300[i];
  const gp = idx.tracks_by_id[id] && idx.tracks_by_id[id].genre_profile;
  if (!gp || gp.confidence !== 'inferred' || gp.source !== 'g3-f-adopt-registry.json') {
    b300gp = false;
  }
  const fs1 = formal.states_by_track_id[id] && formal.states_by_track_id[id].formal_state;
  if (fs1 !== 'ai_suggested') {
    b300formal = false;
  }
}

const reg = load_g3_f_adopt_registry();
const built = build_classification_index({ write: false, g3_f_registry_doc: reg });
const formalBuilt = build_formal_classification_state(built.index_doc, {
  write: false,
  g3_f_registry_doc: reg,
});
let gpDiff = 0;
let tagDiff = 0;
let formalDiff = 0;
for (const id of Object.keys(idx.tracks_by_id)) {
  if (
    JSON.stringify(idx.tracks_by_id[id].genre_profile) !==
    JSON.stringify(built.index_doc.tracks_by_id[id].genre_profile)
  ) {
    gpDiff += 1;
  }
  if (JSON.stringify(idx.tracks_by_id[id].tags) !== JSON.stringify(built.index_doc.tracks_by_id[id].tags)) {
    tagDiff += 1;
  }
}
for (const id of Object.keys(formal.states_by_track_id || {})) {
  if (
    formal.states_by_track_id[id].formal_state !== formalBuilt.states_by_track_id[id].formal_state
  ) {
    formalDiff += 1;
  }
}

const shaMatch = FORMAL_FILES.every(function (f) {
  return sha256_file(f.path) === snapShas[f.name];
});

const report = {
  status: 'restored_verified',
  snapshot_id: SNAPSHOT_ID,
  registry_before: 710,
  registry_after: 410,
  extra_300_removed: diff.length,
  sha256_matches_snapshot: shaMatch,
  track_count: sum.track_count,
  index_rebuild_diff: { gp: gpDiff, tags: tagDiff, formal: formalDiff },
  batch_checks: {
    batch0: allIn(BATCH0),
    batch100: allIn(BATCH100),
    batch300: allIn(BATCH300),
    batch300_inferred: b300gp,
    batch300_ai_suggested: b300formal,
  },
  incident_backup_dir: incidentDir,
  formal_file_sha256: snapShas,
};

const reportPath = path.join(
  process.cwd(),
  'reports',
  'g3-f-incident-restore-verification-2026-10-24.md'
);
const md = [
  '# G3-F 事故還原驗收（410）',
  '',
  '| 項目 | 值 |',
  '|------|-----|',
  '| **狀態** | **restored_verified** |',
  '| **快照** | `' + SNAPSHOT_ID + '` |',
  '| **Registry** | 710 → **410** |',
  '| **撤回誤採** | **300** 首 |',
  '| **SHA-256 與快照** | **一致**（四檔） |',
  '| **track_count** | **7759** |',
  '| **rebuild 對照** | gp ' + gpDiff + '／tags ' + tagDiff + '／formal ' + formalDiff + ' |',
  '| **710 事故備份** | `' + incidentDir.replace(/\\/g, '/') + '` |',
  '',
  'manual-overrides／ai-review 雜湊還原前後未變；staged 未納入還原範圍。',
  '',
].join('\n');
fs.writeFileSync(reportPath, md, 'utf8');
fs.writeFileSync(
  path.join(process.cwd(), 'reports', 'g3-f-incident-restore-verification-2026-10-24.json'),
  JSON.stringify(report, null, 2),
  'utf8'
);

console.log(JSON.stringify(report, null, 2));
