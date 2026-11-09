/**
 * 整檔匯入前的語意安全閘：ledger 存在時禁止整檔覆蓋，改走關係層預覽。
 */
import fs from 'node:fs';
import path from 'node:path';
import { relations, validate_library } from '../cleanup/preview.js';
import { build_relation_merge_plan } from '../managed_playlists/zip_relation_merge.js';

function read_optional_json(root, rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function cleanup_import_safety(project_root, extract_root, options) {
  const rel = 'backup/merged/library-v2.json';
  const ledger = 'backup/library/cleanup-ledger.json';
  const opts = options || {};
  for (const root of [project_root, extract_root]) {
    if (fs.existsSync(path.join(root, ledger))) {
      const relation_preview = opts.include_relation_preview === false
        ? null
        : build_relation_preview(project_root, extract_root, opts);
      return {
        allow_apply: false,
        allow_whole_file: false,
        requires_relation_preview: true,
        relation_preview: relation_preview,
        reason_zh: '偵測到清理紀錄；必須先做關係層級同步預覽，禁止整檔覆蓋以免歌曲復活。',
      };
    }
  }
  try {
    const incoming = JSON.parse(fs.readFileSync(path.join(extract_root, rel), 'utf8'));
    validate_library(incoming);
    if (!fs.existsSync(path.join(project_root, rel))) return { allow_apply: true, local_only: [] };
    const local = JSON.parse(fs.readFileSync(path.join(project_root, rel), 'utf8'));
    validate_library(local);
    if (!local.user_id || local.user_id !== incoming.user_id) throw new Error('來源帳號不一致');
    const k = r => JSON.stringify([r.kind, r.container_id, r.spotify_id, r.position]);
    const target = new Set(relations(incoming).map(k));
    const local_only = relations(local).filter(r => !target.has(k(r)));
    return { allow_apply: local_only.length === 0, local_only,
      reason_zh: local_only.length ? '本機有來源 ZIP 未包含的歌曲關係或位置差異；禁止整檔覆蓋。請先人工核對同步預覽。' : null };
  } catch (e) {
    return { allow_apply: false, reason_zh: '無法安全比較本機與來源曲庫：' + e.message };
  }
}

export function build_relation_preview(project_root, extract_root, options) {
  const opts = options || {};
  try {
    const local = read_optional_json(project_root, 'backup/merged/library-v2.json');
    const incoming = read_optional_json(extract_root, 'backup/merged/library-v2.json');
    const ledger =
      read_optional_json(project_root, 'backup/library/cleanup-ledger.json') ||
      read_optional_json(extract_root, 'backup/library/cleanup-ledger.json');
    return build_relation_merge_plan({
      local: local,
      incoming: incoming,
      ledger: ledger,
      baseline: opts.baseline || null,
      common_baseline_ok: opts.common_baseline_ok === true,
      local_rules: read_optional_json(project_root, 'backup/classification/managed-playlist-rules.json'),
      incoming_rules: read_optional_json(extract_root, 'backup/classification/managed-playlist-rules.json'),
      baseline_rules: opts.baseline_rules || null,
    });
  } catch (err) {
    return {
      ok: false,
      allow_apply: false,
      reason_zh: '無法建立關係層預覽：' + (err && err.message ? err.message : String(err)),
    };
  }
}
