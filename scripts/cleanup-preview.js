import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build_cleanup_preview, select_operations, preview_sync, digest, build_batch_plan, simulate_batch_plan, preview_manual_results } from '../lib/cleanup/preview.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const allowed = new Set(['--batch', '--dry-run', '--ids', '--playlists', '--liked', '--types', '--sync-local', '--sync-incoming', '--ledger', '--baseline', '--results', '--plan']);
for (const a of args) if (!allowed.has(a.split('=')[0])) throw new Error('不支援參數；本工具僅供預覽：' + a);
const arg = n => args.find(x => x.startsWith(n + '='))?.slice(n.length + 1);
const list = n => arg(n)?.split(',').filter(Boolean) || [];
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const out = path.join(root, 'reports', 'cleanup', new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid);
fs.mkdirSync(out, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2), { flag: 'wx' });
if (arg('--results') || arg('--plan')) {
  if (!arg('--results') || !arg('--plan')) throw new Error('人工結果預覽須提供 plan 與 results');
  save('manual-results-preview.json', preview_manual_results(read(arg('--plan')), read(arg('--results'))));
  console.log(JSON.stringify({ output: out }));
} else if (arg('--sync-local') || arg('--sync-incoming') || arg('--ledger')) {
  if (!arg('--sync-local') || !arg('--sync-incoming') || !arg('--ledger')) throw new Error('同步預覽必須提供三個輸入');
  save('sync-preview.json', preview_sync(read(arg('--sync-local')), read(arg('--sync-incoming')), read(arg('--ledger')), { baseline: arg('--baseline') ? read(arg('--baseline')) : null }));
  console.log(JSON.stringify({ output: out }));
} else {
  const files = ['backup/merged/library-v2.json', 'backup/enrichment/track-metadata-cache.json', 'backup/playlists.json',
    'backup/library/saved-albums.json', 'backup/library/album-tracks.json', 'backup/liked-tracks.json', 'backup/playlist-tracks.json'];
  const docs = Object.fromEntries(files.map(p => [p, read(path.join(root, p))]));
  const p = build_cleanup_preview(docs[files[0]], docs[files[1]], {
    playlists: docs[files[2]].playlists, albums_known: docs[files[3]].albums_list_ok === true });
  p.generated_at = new Date().toISOString();
  p.source_files = files.map(f => ({ path: f, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex') }));
  p.backup = { path: '.data-sync-out/pre-cleanup-20261105-unique.zip',
    note: '此為本次備份預期位置；本 CLI 不自行驗證 ZIP。請核對 backup-verification.json，不代表即時 Spotify 全庫可復原。' };
  const ops = select_operations(p, { ids: list('--ids'), playlist_ids: list('--playlists'),
    liked: args.includes('--liked'), types: list('--types') });
  save('preview.json', p); save('selected-operations.json', { mode: 'dry_run', operations: ops, live_apply_supported: false });
  const s = p.summary;
  const esc = v => String(v ?? '').replace(/[|\r\n]/g, ' ');
  const lines = ['# 異常歌曲清理預覽', '', '本報告僅分析本機快照。沒有執行 Spotify 修改。所有候選均需人工確認及即時重新驗證。',
    '', '|項目|數量|', '|---|---:|',
    ...Object.entries({ '全庫歌曲': s.total, '無本次異常': s.without_anomaly, '去重候選': s.candidates,
      '已記錄不可播放或受限': s.recorded_unavailable, '其他待確認': s.needs_confirmation,
      '按讚受影響': s.liked_affected, '收藏專輯內候選': s.saved_album_tracks,
      '受影響收藏專輯': s.saved_album_ids.length, '無完整曲目快照歌單': s.unavailable_playlist_snapshots.length,
      '確定目前永久失效': 0, '本次真實 API 修改': 0 }).map(([k,v]) => '|' + k + '|' + v + '|'),
    '', '## 分類（可能重疊）', '', ...Object.entries(s.categories).map(([k,v]) => '- ' + k + '：' + v),
    '', '## 歌單影響', '', '|歌單|ID|候選歌曲|位置數|', '|---|---|---:|---:|',
    ...Object.values(s.by_playlist).map(x => '|' + esc(x.name) + '|' + x.playlist_id + '|' + x.candidate_tracks + '|' + x.occurrences + '|'),
    '', '## 候選逐首清單', '', '|Spotify ID|歌曲|藝人|播放狀態|補全狀態|原因|歌單數|按讚|收藏專輯|', '|---|---|---|---|---|---|---:|---|---|',
    ...p.candidates.map(c => [c.spotify_id,c.name,c.artists.join(', '),c.playability,c.enrichment_status,c.reasons.join(', '),c.playlists.length,c.liked,c.saved_album].map(esc).join('|')).map(x => '|' + x + '|'),
    '', '## 操作與復原限制', '', '- 預設不選取任何操作；選取後仍只產生 blocked 計畫。無真實 API 刪除入口。',
    '- 可能的未來操作：移除指定歌單指定位置歌曲、取消指定歌曲按讚。收藏專輯與本機原始資料均保留。',
    '- 執行前需新鮮帳號、權限、歌單快照與位置核對。部分他人歌單無讀取或修改權限。',
    '- 舊快照的不可播放不代表永久失效；429、403、404、網路錯誤不證明歌曲失效。',
    '- 重新加入不保證恢復原 added_at、位置或歷史。備份不提供 Spotify 自動還原。',
    '- 收藏專輯依本機 appearances 判讀；不是本次 API 即時確認。無法證明目前不存在。',
    '- 不執行整檔覆蓋匯入。先完成三方關係差異與刪除紀錄驗證，保留家裡獨有項目。',
    '- 詳細位置、資料來源與時間、錯誤、專輯 ID、重複關係及快照缺口見 preview.json。',
    '', '來源摘要：' + p.source_fingerprint];
  fs.writeFileSync(path.join(out, 'preview.md'), lines.join('\n'), { flag: 'wx' });

  if (args.includes('--batch')) {
    const plan = build_batch_plan(docs[files[0]], docs[files[1]], docs[files[2]].playlists, {
      albums_known: docs[files[3]].albums_list_ok === true, backup: p.backup });
    const { projected_library, ...simulation } = simulate_batch_plan(docs[files[0]], docs[files[1]], docs[files[2]].playlists, plan);
    save('final-batch-plan.json', plan); save('batch-simulation.json', simulation);
    save('manual-results-template.json', { schema_version:1,plan_id:plan.plan_id,results:plan.operations.map(x=>({operation_id:x.operation_id,spotify_id:x.spotify_id,container_id:x.container_id,status:'pending',observed_at:null,evidence:null})) });
    save('sync-preparation.json', {
      mode: 'preparation_only', apply_supported: false, plan_id: plan.plan_id,
      home_snapshot_available: false, live_changes: 0, verified_removal_events: 0,
      source_fingerprint: plan.source_fingerprint,
      after_real_removal: '只依已驗證移除事件同步指定關係；保留其他引用與家裡獨有資料',
      after_hide: '保留原始歌單關係，不建立移除 tombstone；隱藏動作另列紀錄，不宣稱 ZIP 可同步 Spotify 隱藏設定',
      pending_or_failed: '不可建立已刪除紀錄，不可清除本機原始資料',
      company_hypothetical_relations_removed: simulation.hypothetical_removed_occurrences,
      local_only_without_verified_ledger: preview_sync(docs[files[0]], projected_library, {
        schema_version:1,user_id:docs[files[0]].user_id,events:[] }).protected_local_only.length,
      required_workflow: ['人工整批核准', '核對實際目標與權限', '記錄已移除／已隱藏／未找到／失敗',
        '只有真實已移除且驗證者可形成 tombstone', '完成後才匯出全新 ZIP',
        '家裡使用同版安全閘，先備份並驗證 ZIP，再做三方預覽；正式套用需另外授權']
    });
    const csv = v => {
      let x = String(v ?? ''); if (/^[=+@\-\t\r\n]/.test(x)) x = "'" + x;
      return '"' + x.replace(/"/g,'""') + '"';
    };
    const csvRows = [['plan_id','playlist_id','playlist_name','spotify_id','name','artists','reasons','capability',
      'import_positions_reference_only','track_url','actual_result','evidence']];
    for (const op of plan.operations) csvRows.push([plan.plan_id,op.container_id,op.playlist_name,op.spotify_id,
      op.name,op.artists.join(', '),op.reasons.join(', '),op.capability,op.positions_reference_only.join(', '),op.track_url,'pending','']);
    fs.writeFileSync(path.join(out,'manual-checklist.csv'),'\uFEFF'+csvRows.map(r=>r.map(csv).join(',')).join('\r\n'),{flag:'wx'});
    const manual = ['# 整批異常歌曲清理方案', '', '狀態：等待一次整批核准；本次沒有修改 Spotify 或原始曲庫。',
      '', '計畫 ID：'+plan.plan_id, '', '|項目|數量|','|---|---:|',
      ...Object.entries(plan.summary).map(([k,v])=>'|'+k+'|'+v+'|'),
      '', '## 建議執行順序', '',
      '1. 一次核准整份清單，不再逐首詢問；139 是清理意願，不是已判定永久失效。',
      '2. 逐份開啟以下歌單，以 Spotify ID／曲目連結核對目標。匯入序號只能協助找歌，不是線上位置。',
      '3. 有編輯權限時才使用「從這份播放清單移除」。目前這 5 份皆為他人非共同編輯歌單，原始關係移除不可執行。',
      '4. 建議對無編輯權限項目整批授權人工「隱藏這首歌曲」；隱藏後略過播放，但不刪除原始關係。介面未提供或找不到目標時記為未處理，停止該項。',
      '5. 逐項在 CSV 記錄 removed_verified／hidden_verified／not_found／failed 及實際時間、目標核對依據；空白或 pending 不算完成。',
      '6. 不退追整份歌單、不改收藏專輯、不清空快取。若一定要從他人原始歌單刪除，必須由歌單擁有者／有權限的共同編輯者處理。',
      '', '## 官方依據', '',
      '- 移除 API：https://developer.spotify.com/documentation/web-api/reference/remove-items-playlist',
      '- 播放清單權限：https://developer.spotify.com/documentation/web-api/concepts/playlists',
      '- 桌面移除：https://support.spotify.com/uk/article/create-playlists/',
      '- 他人歌單隱藏：https://support.spotify.com/eg-en/article/hide-unhide-songs/',
      '', 'API 能力判斷來自本機擁有者／共同編輯旗標；本次沒有呼叫 Spotify API 驗證目前權限。',
      '隱藏設定不保證由本機 ZIP 同步，亦不計入實際移除關係。若改做可編輯副本，需另核准建立副本；不刪除來源或其正常歌曲。'];
    for (const group of plan.by_playlist) {
      manual.push('', '## '+esc(group.name)+'（'+group.desired_removal_relations+' 首）','',
        '[開啟歌單]('+group.playlist_url+')', '',
        '|核對|Spotify ID|歌曲／藝人|異常原因|匯入序號（非線上位置）|結果|','|---|---|---|---|---|---|');
      for (const op of plan.operations.filter(x=>x.container_id===group.playlist_id))
        manual.push('|待處理|['+op.spotify_id+']('+op.track_url+')|'+esc(op.name||'名稱缺失')+' / '+esc(op.artists.join(', '))+
          '|'+esc(op.reasons.join(', '))+'|'+op.positions_reference_only.join(', ')+'|pending|');
    }
    fs.writeFileSync(path.join(out,'final-batch-preview.md'),manual.join('\n'),{flag:'wx'});
    console.log(JSON.stringify({ batch_output:out,plan_id:plan.plan_id,summary:plan.summary },null,2));
  }

  console.log(JSON.stringify({ output: out, summary: s, selected_operations: ops.length }, null, 2));
}
