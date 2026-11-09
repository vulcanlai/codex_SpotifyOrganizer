/**
 * 人可檢查的讀回差異報告（繁體中文）。
 */
export function render_readback_report(plan) {
  const p = plan || {};
  const s = p.summary || {};
  const lines = [
    '# 🎵 人工歌單讀回預覽',
    '',
    '- 模式：唯讀預覽，**尚未確認保存**',
    '- 帳號：' + (p.account_id || '（未知）'),
    '- plan hash：`' + (p.plan_hash || '') + '`',
    '- 建立時間：' + (p.created_at || ''),
    '- 歌單數：' + (s.playlist_count || 0),
    '- 新建：' + (s.new_count || 0) + '／改名：' + (s.renamed_count || 0) + '／未變更：' + (s.unchanged_count || 0),
    '- 不完整：' + (s.incomplete_count || 0) + '／衝突：' + (s.conflict_count || 0),
    '- 可套用：' + (p.apply_supported ? '是（仍須確認）' : '否'),
    '',
    '讀回未修改 Spotify。確認前不會更新正式人工規則或同步基準。',
    '',
  ];
  if (p.human_baseline) {
    const hb = p.human_baseline;
    lines.push('## 歷史基準與人工優先語意');
    lines.push('');
    lines.push('- 名稱歷史來源：' + hb.name_history_source);
    lines.push('- 曲目歷史來源：' + hb.item_history_source);
    lines.push('- 分類缺席是否已證明：' + (hb.catalog_absences_proven ? '是' : '否（推定）'));
    lines.push('- 確認保存後：鎖定目前名稱與曲目；分類多出的曲目列為該歌單人工移除。');
    lines.push('- ' + (hb.note_zh || ''));
    lines.push('');
  }
  if (p.read_cost) {
    lines.push('## 讀取成本');
    lines.push('');
    lines.push('- 歌單清單頁：' + p.read_cost.playlist_list_pages);
    lines.push('- 歌單 metadata：' + p.read_cost.playlist_detail_calls);
    lines.push('- 曲目分頁：' + p.read_cost.playlist_item_pages);
    lines.push('- 完整抓取歌單：' + p.read_cost.playlists_item_fetched);
    lines.push('- 沿用同版本基準：' + p.read_cost.playlists_reused_baseline);
    lines.push('- 沿用已重驗 snapshot 的快取：' + (p.read_cost.playlists_reused_checkpoint || 0));
    lines.push('');
  }
  lines.push('## 歌單差異');
  lines.push('');
  const rows = p.playlists || [];
  if (!rows.length) {
    lines.push('（沒有 🎵 歌單差異）');
    lines.push('');
  }
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    lines.push('### ' + (row.current_name || row.previous_name || row.spotify_playlist_id));
    lines.push('');
    lines.push('- ID：`' + row.spotify_playlist_id + '`');
    lines.push('- 狀態：' + row.status + (row.can_edit ? '（可編輯）' : '（不可寫）'));
    if (row.is_new) {
      lines.push('- 新建自訂歌單，確認後才納管');
    }
    if (row.name_changed) {
      lines.push('- 改名：`' + (row.previous_name || '') + '` → `' + (row.current_name || '') + '`');
    }
    if (row.skipped_unchanged) {
      lines.push(
        row.item_history_proven
          ? '- 相對正式曲目基準未變更'
          : '- 相對名稱基準未變更（無可信曲目歷史，不列出虛構增刪）'
      );
    }
    if (row.incomplete || row.changed_during_read) {
      lines.push('- **不完整**：讀取中版本變動或未抓完，不能當完整快照');
    }
    lines.push(
      '- 曲目歷史：' + (row.item_history_proven ? '相對正式基準（可證明）' : '無可信曲目基準（不捏造週末操作）')
    );
    lines.push('- 加入：' + ((row.added && row.added.length) || 0) + '／移除：' + ((row.removed && row.removed.length) || 0));
    if ((row.inferred_catalog_only && row.inferred_catalog_only.length) || (row.inferred_live_only && row.inferred_live_only.length)) {
      lines.push(
        '- 推定（對分類，非已證明人工操作）：分類有、Spotify 無 ' +
          ((row.inferred_catalog_only && row.inferred_catalog_only.length) || 0) +
          '／Spotify 有、分類無 ' +
          ((row.inferred_live_only && row.inferred_live_only.length) || 0)
      );
    }
    if (row.order_changed) {
      lines.push('- 順序變更（重複次數已保留）');
    }
    append_item_lines(lines, '加入', row.added);
    append_item_lines(lines, '移除', row.removed);
    if (row.conflicts && row.conflicts.length) {
      lines.push('- 衝突：');
      for (let c = 0; c < row.conflicts.length; c += 1) {
        lines.push('  - ' + (row.conflicts[c].note_zh || row.conflicts[c].type));
      }
    }
    lines.push('');
  }
  if (p.possible_moves && p.possible_moves.length) {
    lines.push('## 可能的跨歌單移動（未證實）');
    lines.push('');
    for (let m = 0; m < p.possible_moves.length; m += 1) {
      const mv = p.possible_moves[m];
      lines.push(
        '- `' +
          mv.track_id +
          '`：' +
          (mv.from_playlist_ids || []).join(',') +
          ' → ' +
          (mv.to_playlist_ids || []).join(',') +
          '（分別保存，不偽造移動事件）'
      );
    }
    lines.push('');
  }
  lines.push('## 下一步');
  lines.push('');
  if (p.apply_supported === false || (p.summary && p.summary.incomplete_count) || (p.read_cost && p.read_cost.errors && p.read_cost.errors.length)) {
    lines.push('此 plan 含不完整讀取、不可用快照或錯誤，**不能確認保存**。冷卻結束後用 `npm run playlists:preview -- --resume` 重跑。');
    lines.push('');
    lines.push('舊 plan `10e36ed5…`、`82f29b5…` 都不是可正式套用的完整 plan。');
    lines.push('');
  }
  lines.push('完整且檢查後若要保存本機人工優先調整：');
  lines.push('');
  lines.push('```');
  lines.push('npm run playlists:apply -- --plan=' + (p.plan_hash || '<hash>') + ' --confirm=I_UNDERSTAND_MANAGED_PLAYLIST_APPLY');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

function append_item_lines(lines, title, items) {
  if (!items || !items.length) {
    return;
  }
  const max = Math.min(items.length, 20);
  for (let i = 0; i < max; i += 1) {
    const it = items[i];
    const name = it.name || it.track_id || it.uri || it.kind;
    lines.push('  - ' + title + '：' + name + (it.kind && it.kind !== 'track' ? '（' + it.kind + '）' : ''));
  }
  if (items.length > max) {
    lines.push('  - …另有 ' + (items.length - max) + ' 筆');
  }
}
