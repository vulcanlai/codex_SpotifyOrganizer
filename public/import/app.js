/**
 * 匯入 Web UI（ES5 相容語法）
 */
(function () {
  var state = {
    playlists: [],
    selected_id: null,
  };

  var el_select = document.getElementById('playlist_select');
  var el_info = document.getElementById('playlist_info');
  var el_paste = document.getElementById('paste_area');
  var el_preview = document.getElementById('preview_box');
  var el_message = document.getElementById('message_box');
  var el_progress_summary = document.getElementById('progress_summary');
  var el_progress_list = document.getElementById('progress_list');
  var el_allow_dup = document.getElementById('allow_duplicate_batch');

  function api_get(path, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', path, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) {
        return;
      }
      var data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {
        cb(new Error('無法解析回應'), null);
        return;
      }
      if (xhr.status >= 400) {
        cb(new Error(data.error || data.message || '請求失敗'), data);
        return;
      }
      cb(null, data);
    };
    xhr.send();
  }

  function api_post(path, payload, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', path, true);
    xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) {
        return;
      }
      var data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {
        cb(xhr.status, new Error('無法解析回應'), null);
        return;
      }
      if (xhr.status >= 400) {
        cb(xhr.status, new Error(data.message || data.error || '請求失敗'), data);
        return;
      }
      cb(xhr.status, null, data);
    };
    xhr.send(JSON.stringify(payload));
  }

  function show_message(text, kind) {
    el_message.hidden = false;
    el_message.textContent = text;
    el_message.className = 'message_box ' + (kind === 'error' ? 'is_error' : 'is_ok');
  }

  function hide_message() {
    el_message.hidden = true;
  }

  function find_playlist(id) {
    for (var i = 0; i < state.playlists.length; i += 1) {
      if (state.playlists[i].playlist_id === id) {
        return state.playlists[i];
      }
    }
    return null;
  }

  function render_playlist_info() {
    var pl = find_playlist(state.selected_id);
    if (!pl) {
      el_info.textContent = '';
      return;
    }
    var hint = pl.catalog_track_hint != null ? pl.catalog_track_hint : '未知';
    el_info.innerHTML =
      '<div><strong>歌單名稱：</strong>' + escape_html(pl.playlist_name || '') + '</div>' +
      '<div><strong>Playlist ID：</strong><code>' + escape_html(pl.playlist_id) + '</code></div>' +
      '<div><strong>目前已匯入：</strong>' + pl.imported_count + ' 首</div>' +
      '<div><strong>Spotify 列表參考曲數：</strong>' + hint + '（僅供對照）</div>' +
      '<div><strong>播放狀態：</strong>皆為 unknown（無法僅憑網址確認可播放）</div>' +
      '<div><strong>完成狀態：</strong>' +
      (pl.import_marked_complete ? '已人工確認完成' : '尚未確認完成') +
      '</div>';
    if (pl.user_confirmed_total != null) {
      el_info.innerHTML += '<div><strong>您確認的總數：</strong>' + pl.user_confirmed_total + '</div>';
    }
  }

  function escape_html(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render_progress_list() {
    var complete = 0;
    var html = '';
    for (var i = 0; i < state.playlists.length; i += 1) {
      var p = state.playlists[i];
      if (p.import_marked_complete) {
        complete += 1;
      }
      var cls = 'progress_item';
      if (p.import_marked_complete) {
        cls += ' is_complete';
      } else if (p.imported_count > 0) {
        cls += ' is_partial';
      }
      html +=
        '<li class="' + cls + '">' +
        '<div class="progress_name">' + escape_html(p.playlist_name || p.playlist_id) + '</div>' +
        '<div class="progress_meta">' +
        '匯入 ' + p.imported_count + ' 首 · 無效網址 ' + p.invalid_url_count +
        ' · 未確認播放 ' + p.unconfirmed_playability_count +
        ' · 批次 ' + p.batch_count +
        (p.import_marked_complete ? ' · ✓ 已確認' : '') +
        '</div></li>';
    }
    el_progress_list.innerHTML = html;
    el_progress_summary.textContent =
      '已完成 ' + complete + ' / ' + state.playlists.length +
      ' 份（須人工確認曲數，非僅貼上網址即完成）';
  }

  function fill_select() {
    var html = '<option value="">— 請選擇 —</option>';
    for (var i = 0; i < state.playlists.length; i += 1) {
      var p = state.playlists[i];
      html +=
        '<option value="' + escape_html(p.playlist_id) + '">' +
        escape_html(p.playlist_name || p.playlist_id) +
        '</option>';
    }
    el_select.innerHTML = html;
    if (state.selected_id) {
      el_select.value = state.selected_id;
    }
  }

  function load_status(cb) {
    api_get('/api/status', function (err, data) {
      if (err) {
        show_message(err.message, 'error');
        if (cb) {
          cb(err);
        }
        return;
      }
      state.playlists = data.playlists || [];
      if (!state.selected_id && state.playlists.length) {
        state.selected_id = state.playlists[0].playlist_id;
      }
      fill_select();
      render_playlist_info();
      render_progress_list();
      hide_message();
      if (cb) {
        cb(null);
      }
    });
  }

  el_select.addEventListener('change', function () {
    state.selected_id = el_select.value || null;
    render_playlist_info();
    el_preview.hidden = true;
  });

  document.getElementById('btn_preview').addEventListener('click', function () {
    if (!state.selected_id) {
      show_message('請先選擇歌單', 'error');
      return;
    }
    api_post('/api/preview', {
      playlist_id: state.selected_id,
      text: el_paste.value,
    }, function (status, err, data) {
      if (err) {
        show_message(err.message, 'error');
        return;
      }
      var p = data.preview;
      var lines = [
        '有效網址：' + p.valid_count,
        '無效網址：' + p.invalid_count,
        '本批內重複歌曲：' + p.duplicate_entries,
      ];
      if (p.duplicate_batch) {
        lines.push('⚠ ' + p.duplicate_batch_message);
      }
      if (p.invalid_lines && p.invalid_lines.length) {
        lines.push('無效行範例：第 ' + p.invalid_lines[0].line_number + ' 行 — ' + p.invalid_lines[0].error);
      }
      el_preview.hidden = false;
      el_preview.textContent = lines.join('\n');
      hide_message();
    });
  });

  document.getElementById('btn_import').addEventListener('click', function () {
    if (!state.selected_id) {
      show_message('請先選擇歌單', 'error');
      return;
    }
    api_post('/api/import-batch', {
      playlist_id: state.selected_id,
      text: el_paste.value,
      allow_duplicate_batch: el_allow_dup.checked,
    }, function (status, err, data) {
      if (status === 409 && data && data.error === 'duplicate_batch') {
        show_message(data.message + ' 若確定要匯入，請勾選下方選項後再試。', 'error');
        el_preview.hidden = false;
        el_preview.textContent = data.message;
        return;
      }
      if (err) {
        show_message(err.message, 'error');
        return;
      }
      show_message('已成功匯入本批 ' + data.preview.valid_count + ' 首歌曲。', 'ok');
      load_status();
    });
  });

  document.getElementById('btn_confirm').addEventListener('click', function () {
    if (!state.selected_id) {
      show_message('請先選擇歌單', 'error');
      return;
    }
    var total_input = document.getElementById('expected_total');
    api_post('/api/confirm-playlist', {
      playlist_id: state.selected_id,
      expected_total: total_input.value,
    }, function (status, err, data) {
      if (err) {
        show_message(err.message, 'error');
        return;
      }
      show_message(data.message, data.playlist.import_marked_complete ? 'ok' : 'error');
      load_status();
    });
  });

  load_status();
})();
