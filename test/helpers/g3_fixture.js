import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeEach, after } from 'node:test';
import { fixture_documents, evidence_row, track_id } from '../fixtures/g3_data.js';

// 每個測試檔的 worker 有自己的專案／模組根目錄，不變更正式 config 或 backup。
export function create_g3_fixture() {
  const original_cwd = process.cwd();
  const source = fileURLToPath(new URL('../../lib', import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-g3-fixture-'));
  fs.cpSync(source, path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  const old_evidence_dir = process.env.SPOTIFYORG_G3_EVIDENCE_DIR;
  process.env.SPOTIFYORG_G3_EVIDENCE_DIR = path.join(root, 'backup/classification/g3-evidence');
  process.chdir(root);
  function write(rel, doc) {
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) throw new Error('Fixture path outside test root');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(doc));
  }
  function reset() {
    fs.rmSync(path.join(root, 'backup'), { recursive: true, force: true });
    for (const [rel, doc] of Object.entries(fixture_documents())) write(rel, doc);
    fs.mkdirSync(path.join(root, 'backup/classification/g3-d1-wave-200/batch-drafts'), { recursive: true });
  }
  reset();
  beforeEach(reset);
  after(() => {
    process.chdir(original_cwd);
    if (old_evidence_dir === undefined) delete process.env.SPOTIFYORG_G3_EVIDENCE_DIR;
    else process.env.SPOTIFYORG_G3_EVIDENCE_DIR = old_evidence_dir;
    const base = path.resolve(os.tmpdir());
    if (path.dirname(root).toLowerCase() !== base.toLowerCase() || !path.basename(root).startsWith('spotify-g3-fixture-')) {
      throw new Error('Unsafe fixture cleanup');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root, write,
    read: rel => {
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep)) throw new Error('Fixture read outside test root');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    load: rel => import(pathToFileURL(path.join(root, 'lib', rel)).href),
    context(count = 140) {
      const ids = Array.from({ length: count }, (_, n) => track_id(n + 500));
      return {
        all_ids: ids, identifiable_ids: ids,
        ev_tracks: Object.fromEntries(ids.map((id, n) => [id, evidence_row(n + 500)])),
        index_by: Object.fromEntries(ids.map(id => [id, { tags: [] }])),
        bundle: { manual_overrides: { overrides_by_track_id: {} } },
        qualified_set: new Set(), e_wave_done: new Set(), d5_unverified: new Set(),
        inv_by_id: new Map(), evidence_fingerprint: 'fixture',
        helpers: { has_valid_title: s => !!s, artists_identifiable: a => a.length > 0 },
      };
    },
  };
}
