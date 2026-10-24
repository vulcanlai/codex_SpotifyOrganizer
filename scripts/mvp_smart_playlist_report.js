/**
 * MVP 智慧歌單目錄與曲目數（唯讀 index，寫入試驗目錄）
 * node scripts/mvp_smart_playlist_report.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../lib/atomic_json.js';
import { build_mvp_playlist_summary_counts } from '../lib/classification/mvp_smart_playlists.js';

const OUT_DIR = path.join(
  process.cwd(),
  'backup',
  'classification',
  'mvp-smart-playlists'
);

const result = build_mvp_playlist_summary_counts();
const catalog = result.catalog;

const catalog_public = {
  schema_version: catalog.schema_version,
  library_track_count: catalog.library_track_count,
  policies: catalog.policies,
  language_genre_playlists: (catalog.language_genre_playlists || []).map(function (p) {
    return {
      playlist_id: p.playlist_id,
      label_zh: p.label_zh,
      language_bucket: p.language_bucket,
      primary_genre: p.primary_genre,
      track_count: p.track_count,
      playable_count: p.playable_count,
      by_genre_confidence: p.by_genre_confidence,
    };
  }),
  language_stats: catalog.language_stats,
  emotion_playlists_tentative: catalog.emotion_playlists_tentative.map(function (p) {
    return {
      playlist_id: p.playlist_id,
      label_zh: p.label_zh,
      track_count: p.track_count,
      playable_count: p.playable_count,
      source: p.source,
    };
  }),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
write_json_atomic(path.join(OUT_DIR, 'catalog.json'), catalog_public);
write_json_atomic(path.join(OUT_DIR, 'summary.json'), {
  generated_at: result.generated_at,
  library_track_count: result.library_track_count,
  genre_counts: result.genre_counts,
  emotion_counts: result.emotion_counts,
});

console.log('library:', result.library_track_count);
console.log('language×genre playlists:', result.genre_counts.length);
if (result.catalog.language_stats) {
  const st = result.catalog.language_stats;
  console.log('語言未知／純音樂桶曲目數:', st.tracks_in_unknown_or_instrumental_bucket);
  console.log('  其中純音樂 special:', st.pure_instrumental_special_type);
  console.log('  其中語言未確認:', st.language_tag_unconfirmed);
}
for (let i = 0; i < result.genre_counts.length; i += 1) {
  const g = result.genre_counts[i];
  console.log(' ', g.playlist_id, g.label_zh, g.track_count);
}
console.log('emotion (tentative):', result.emotion_counts.length);
for (let j = 0; j < result.emotion_counts.length; j += 1) {
  const e = result.emotion_counts[j];
  console.log(' ', e.playlist_id, e.track_count);
}
console.log('輸出:', OUT_DIR);
