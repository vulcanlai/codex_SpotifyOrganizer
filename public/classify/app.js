(function () {
  var L = window.ClassifyUiLabels;
  var Pagination = window.ClassifyPaginationModel;
  var summary_data = null;
  var ai_status = null;
  var ai_candidate_version = 2;
  var selected_track_id = null;
  var list_mode = 'all';
  var search_items = [];
  var ai_items = [];
  var ai_id_map = {};
  var ai_form_snapshot = '';
  var ai_form_dirty = false;
  var override_form_snapshot = '';
  var override_form_dirty = false;
  var genre_taxonomy = null;
  var ai_selected_ids = {};
  var preview_settings = null;
  var batch_client_op_id = '';
  var ai_test_batch = 'v2-sample-30';
  var ai_batch_list = [];
  var quality_audit_items = [];
  var quality_selected_id = null;
  var quality_audit_status = null;
  var local_ui_csrf_token = '';
  var current_page = 1;
  var page_by_mode = { all: 1, ai: 1, quality: 1 };
  var current_total = 0;
  var page_size = 100;
  var pagination_radius = 1;
  var search_request_gate = Pagination.create_request_gate();

  var QUALITY_VERDICT_LABELS = {
    unset: '尚未驗證',
    correct: '正確',
    partial: '部分正確',
    incorrect: '錯誤',
    undecidable: '無法判斷',
  };

  var FILTER_DIMENSION_BY_ID = {
    filter_decade: 'decade',
    filter_language: 'language',
    filter_genre: 'genre',
    filter_context: 'context',
  };

  var el_stats_cards = document.getElementById('stats_cards');
  var el_decade_bars = document.getElementById('stats_decade_bars');
  var el_system_status = document.getElementById('system_status');
  var el_search_meta = document.getElementById('search_result_meta');
  var el_track_list = document.getElementById('track_list');
  var el_pagination = document.getElementById('track_pagination');
  var el_detail = document.getElementById('track_detail');
  var el_workspace = document.getElementById('workspace');

  function load_csrf_token() {
    return fetch('/api/csrf')
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            throw new Error(data.error || 'CSRF 載入失敗');
          }
          local_ui_csrf_token = data.csrf_token || '';
        });
      });
  }

  function fetch_json(url, options) {
    var opts = options ? options : {};
    var method = (opts.method || 'GET').toUpperCase();
    var headers = opts.headers ? Object.assign({}, opts.headers) : {};
    if (
      method === 'POST' ||
      method === 'PUT' ||
      method === 'PATCH' ||
      method === 'DELETE'
    ) {
      headers['X-Local-Ui-Csrf'] = local_ui_csrf_token;
    }
    opts.headers = headers;
    return fetch(url, opts).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          throw new Error(data.error || '請求失敗');
        }
        return data;
      });
    });
  }

  function show_toast(message, is_error) {
    var el = document.getElementById('toast');
    if (!el) {
      return;
    }
    el.textContent = message;
    el.hidden = false;
    el.className = 'toast' + (is_error ? ' toast_error' : '');
    window.setTimeout(function () {
      el.hidden = true;
    }, 4000);
  }

  function show_error(err) {
    var msg = err && err.message ? err.message : String(err);
    show_toast(msg, true);
    window.alert(msg);
  }

  function escape_html(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 顯示層中文化（不修改儲存值） */
  function display_freeform(text) {
    if (!text) {
      return text;
    }
    if (L.localize_freeform_text) {
      return L.localize_freeform_text(text, genre_taxonomy);
    }
    return text;
  }

  function load_taxonomy() {
    return fetch_json('/api/taxonomy/genres').then(function (data) {
      genre_taxonomy = data;
      fill_genre_taxonomy_filters(summary_data);
    });
  }

  function main_genre_label(code) {
    if (!code || code === 'unknown') {
      return '未確認';
    }
    if (!genre_taxonomy || !genre_taxonomy.main_genres) {
      return code;
    }
    for (var i = 0; i < genre_taxonomy.main_genres.length; i += 1) {
      if (genre_taxonomy.main_genres[i].code === code) {
        return genre_taxonomy.main_genres[i].label_zh;
      }
    }
    return code;
  }

  function subgenre_label(code) {
    if (!genre_taxonomy || !genre_taxonomy.subgenres) {
      return code;
    }
    var row = genre_taxonomy.subgenres[code];
    return row ? row.label_zh : code;
  }

  function fill_genre_taxonomy_filters(summary) {
    var primary_sel = document.getElementById('filter_primary_genre');
    var sub_sel = document.getElementById('filter_subgenre');
    if (!primary_sel || !sub_sel) {
      return;
    }
    var counts = (summary && summary.primary_genre) || {};
    primary_sel.innerHTML = '';
    var all_p = document.createElement('option');
    all_p.value = '';
    all_p.textContent = '（全部）';
    primary_sel.appendChild(all_p);
    if (genre_taxonomy && genre_taxonomy.main_genres) {
      for (var i = 0; i < genre_taxonomy.main_genres.length; i += 1) {
        var mg = genre_taxonomy.main_genres[i];
        var opt = document.createElement('option');
        opt.value = mg.code;
        var n = counts[mg.code] || 0;
        opt.textContent = mg.label_zh + ' (' + n + ')';
        primary_sel.appendChild(opt);
      }
    }
    var unknown_n = counts.unknown || 0;
    if (unknown_n) {
      var unk = document.createElement('option');
      unk.value = 'unknown';
      unk.textContent = '未確認 (' + unknown_n + ')';
      primary_sel.appendChild(unk);
    }
    refresh_subgenre_filter_options();
    primary_sel.onchange = refresh_subgenre_filter_options;
  }

  function refresh_subgenre_filter_options() {
    var sub_sel = document.getElementById('filter_subgenre');
    var primary_sel = document.getElementById('filter_primary_genre');
    if (!sub_sel || !primary_sel || !genre_taxonomy) {
      return;
    }
    var main_code = primary_sel.value;
    sub_sel.innerHTML = '';
    var all_s = document.createElement('option');
    all_s.value = '';
    all_s.textContent = '（全部）';
    sub_sel.appendChild(all_s);
    var sub_counts = (summary_data && summary_data.subgenre) || {};
    var subs = genre_taxonomy.subgenres || {};
    var keys = Object.keys(subs).sort();
    for (var i = 0; i < keys.length; i += 1) {
      var row = subs[keys[i]];
      if (main_code && row.main !== main_code) {
        continue;
      }
      var o = document.createElement('option');
      o.value = row.code;
      var c = sub_counts[row.code] || 0;
      o.textContent = row.label_zh + ' (' + c + ')';
      sub_sel.appendChild(o);
    }
  }

  var g3_c1_summary = null;

  function load_g3_c1_summary() {
    return fetch_json('/api/g3/c1/summary')
      .then(function (data) {
        g3_c1_summary = data;
      })
      .catch(function () {
        g3_c1_summary = null;
      });
  }

  function load_status() {
    return fetch_json('/api/status').then(function (data) {
      summary_data = data.summary;
      render_overview(summary_data);
      fill_filter_options(summary_data);
      fill_genre_taxonomy_filters(summary_data);
      el_system_status.textContent = '索引就緒 · ' + summary_data.track_count + ' 首';
    });
  }

  function load_external_verify_hint() {
    var el = document.getElementById('external_verify_line');
    if (!el) {
      return Promise.resolve();
    }
    return fetch_json('/api/external-verify/status')
      .then(function (data) {
        var ev = data.external_verify;
        if (!ev || !ev.track_count) {
          el.textContent =
            '外部資料查證（G1）：尚未建立試驗樣本。可執行 npm run verify:g1-build-sample';
          return;
        }
        el.textContent =
          '外部資料查證（G1 · MusicBrainz）：' +
          ev.verified_final_count +
          '／' +
          ev.track_count +
          ' 首已完成 · 模式 ' +
          ev.mode +
          ' · 快取命中 ' +
          (ev.cache_hits || 0);
      })
      .catch(function () {
        el.textContent = '';
      });
  }

  function render_ai_batch_meta(summary) {
    var el = document.getElementById('ai_batch_meta');
    if (!el || !summary) {
      return;
    }
    el.textContent =
      '候選 ' +
      summary.ai_candidates_count +
      '/' +
      summary.track_count +
      ' · 待審 ' +
      summary.review_stats.pending +
      ' · 已接受 ' +
      summary.review_stats.accepted +
      ' · 已拒絕 ' +
      summary.review_stats.rejected;
  }

  function fill_ai_batch_select(batches, active) {
    var sel = document.getElementById('ai_test_batch');
    if (!sel) {
      return;
    }
    sel.innerHTML = '';
    for (var i = 0; i < batches.length; i += 1) {
      var b = batches[i];
      var opt = document.createElement('option');
      opt.value = b.test_batch_id;
      opt.textContent =
        b.label_zh + ' (' + b.track_count + ' 首，AI ' + b.ai_candidates_count + ')';
      sel.appendChild(opt);
    }
    if (active) {
      sel.value = active;
    }
    ai_test_batch = sel.value || ai_test_batch;
  }

  function load_ai_batches() {
    return fetch_json('/api/ai/batches').then(function (data) {
      ai_batch_list = data.batches || [];
      fill_ai_batch_select(ai_batch_list, data.active_test_batch || ai_test_batch);
      if (data.active_test_batch) {
        ai_test_batch = data.active_test_batch;
      }
      for (var i = 0; i < ai_batch_list.length; i += 1) {
        if (ai_batch_list[i].test_batch_id === ai_test_batch) {
          render_ai_batch_meta(ai_batch_list[i]);
          break;
        }
      }
    });
  }

  function load_ai_review() {
    return fetch_json('/api/ai/status')
      .then(function (st) {
        ai_status = st;
        ai_candidate_version =
          st.active_candidate_version ||
          (st.has_candidates_v2 ? 2 : 1);
        if (st.active_test_batch) {
          ai_test_batch = st.active_test_batch;
        }
        render_overview(summary_data);
        return load_ai_batches();
      })
      .then(function () {
        return fetch_json(
          '/api/ai/tracks?candidate_version=' +
            ai_candidate_version +
            '&test_batch_id=' +
            encodeURIComponent(ai_test_batch)
        );
      })
      .then(function (data) {
        if (!data) {
          ai_items = [];
          ai_id_map = {};
          if (list_mode === 'ai') {
            render_current_list();
          }
          return;
        }
        if (data.batch_summary) {
          render_ai_batch_meta(data.batch_summary);
        }
        ai_items = data.items || [];
        ai_id_map = {};
        for (var i = 0; i < ai_items.length; i += 1) {
          ai_id_map[ai_items[i].spotify_id] = ai_items[i];
        }
        if (list_mode === 'ai') {
          render_current_list();
        }
      })
      .catch(function () {
        ai_items = [];
        ai_id_map = {};
      });
  }

  function render_stat_card(label, value, extra_class) {
    return (
      '<div class="stat_card' +
      (extra_class ? ' ' + extra_class : '') +
      '"><div class="stat_card_value">' +
      escape_html(String(value)) +
      '</div><div class="stat_card_label">' +
      escape_html(label) +
      '</div></div>'
    );
  }

  function render_overview(s) {
    if (!s) {
      el_stats_cards.textContent = '無摘要資料';
      return;
    }
    var use_v2 =
      ai_status &&
      ai_status.has_candidates_v2 &&
      ai_candidate_version === 2;
    var rs =
      ai_status && use_v2 && ai_status.review_stats_v2
        ? ai_status.review_stats_v2
        : ai_status && ai_status.review_stats
          ? ai_status.review_stats
          : {};
    var ai_pending = rs.pending || 0;
    var ai_done =
      (rs.accepted || 0) + (rs.rejected || 0) + (rs.modified || 0);
    var html = '';
    html += render_stat_card('音樂庫總歌曲', s.track_count);
    html += render_stat_card('已有歌曲資訊', s.metadata_complete);
    html += render_stat_card('待補齊資訊', s.metadata_missing, 'stat_warn');
    html += render_stat_card(
      use_v2 ? 'AI 新版待審核' : 'AI 待審核',
      ai_pending,
      'stat_ai'
    );
    html += render_stat_card('AI 已審核', ai_done);
    if (g3_c1_summary && g3_c1_summary.summary) {
      html += render_stat_card(
        'G3 試驗 AI 覆蓋',
        g3_c1_summary.summary.g3_ai_integrated_in_sample_100 + ' / 100',
        'stat_ai'
      );
      if (g3_c1_summary.tasks) {
        html += render_stat_card(
          '待補證據任務',
          g3_c1_summary.tasks.task_count || 0,
          'stat_warn'
        );
        html += render_stat_card(
          '需人工決策任務',
          g3_c1_summary.tasks.human_required_task_count || 0,
          'stat_warn'
        );
      }
    }
    el_stats_cards.innerHTML = html;

    var decade = s.decade || {};
    var keys = Object.keys(decade).sort();
    var max = 0;
    for (var k = 0; k < keys.length; k += 1) {
      if (decade[keys[k]] > max) {
        max = decade[keys[k]];
      }
    }
    var bars = '';
    for (var i = 0; i < keys.length; i += 1) {
      var count = decade[keys[i]];
      var pct = max > 0 ? Math.round((count / max) * 100) : 0;
      bars +=
        '<div class="decade_row"><div class="decade_label">' +
        escape_html(L.format_decade_value(keys[i])) +
        '</div><div class="decade_bar_track"><div class="decade_bar_fill" style="width:' +
        pct +
        '%"></div></div><div class="decade_count">' +
        count +
        '</div></div>';
    }
    el_decade_bars.innerHTML = bars || '<p class="muted">無年代統計</p>';
  }

  function fill_filter_options(s) {
    fill_select('filter_decade', s.decade, true);
    fill_select('filter_language', s.language, true);
    fill_select('filter_genre', s.genre, true);
    fill_select('filter_context', s.context, true);
  }

  function fill_select(id, counts, include_all) {
    var sel = document.getElementById(id);
    if (!sel) {
      return;
    }
    var dimension = FILTER_DIMENSION_BY_ID[id] || 'decade';
    sel.innerHTML = '';
    if (include_all) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（全部）';
      sel.appendChild(opt);
    }
    var keys = Object.keys(counts || {}).sort();
    for (var i = 0; i < keys.length; i++) {
      var o = document.createElement('option');
      o.value = keys[i];
      o.textContent = L.format_filter_option_text(dimension, keys[i], counts[keys[i]]);
      sel.appendChild(o);
    }
  }

  function run_search(reset_page, locate_track_id) {
    if (reset_page) {
      page_by_mode.all = 1;
      if (list_mode === 'all') {
        current_page = 1;
      }
    }
    var search_page = page_by_mode.all;
    var params = new URLSearchParams();
    var q = document.getElementById('search_q').value.trim();
    if (q) {
      params.set('q', q);
    }
    var decade = document.getElementById('filter_decade').value;
    var language = document.getElementById('filter_language').value;
    var genre = document.getElementById('filter_genre').value;
    var context = document.getElementById('filter_context').value;
    var primary_genre = document.getElementById('filter_primary_genre').value;
    var subgenre = document.getElementById('filter_subgenre').value;
    if (decade) {
      params.set('decade', decade);
    }
    if (language) {
      params.set('language', language);
    }
    if (genre) {
      params.set('genre', genre);
    }
    if (context) {
      params.set('context', context);
    }
    if (primary_genre) {
      params.set('primary_genre', primary_genre);
    }
    if (subgenre) {
      params.set('subgenre', subgenre);
    }
    if (locate_track_id) {
      params.set('locate_track_id', locate_track_id);
      params.set('locate_page', '1');
    }
    params.set('limit', String(page_size));
    params.set('offset', String((search_page - 1) * page_size));
    var request_id = search_request_gate.next();
    return fetch_json('/api/tracks?' + params.toString()).then(function (data) {
      if (!search_request_gate.is_current(request_id)) {
        return;
      }
      search_items = data.items || [];
      current_total = data.total || 0;
      var located = typeof data.located_index === 'number' && data.located_index >= 0;
      var valid_page = located
        ? Math.floor(data.located_index / page_size) + 1
        : Pagination.clamp_page(search_page, current_total, page_size);
      page_by_mode.all = valid_page;
      if (valid_page !== search_page) {
        if (list_mode === 'all') current_page = valid_page;
        if (!located) {
          return run_search(false);
        }
      }
      if (list_mode === 'all') {
        current_page = valid_page;
        el_search_meta.textContent =
          '符合 ' + data.total + ' 首（本頁 ' + data.items.length + ' 首）';
        render_track_list(search_items, false);
        render_pagination();
        if (located) {
          schedule_scroll_track_into_list(locate_track_id);
        }
      }
    });
  }

  function get_ai_pending_items() {
    var out = [];
    for (var i = 0; i < ai_items.length; i += 1) {
      var rev =
        ai_items[i].review && ai_items[i].review.status
          ? ai_items[i].review.status
          : 'pending';
      if (rev === 'pending') {
        out.push(ai_items[i]);
      }
    }
    return out;
  }

  function render_current_list() {
    if (list_mode === 'quality') {
      render_quality_track_list();
      return;
    }
    if (list_mode === 'ai') {
      var pending = get_ai_pending_items();
      current_total = pending.length;
      clamp_current_page();
      var page_items = paginate_items(pending);
      el_search_meta.textContent =
        (ai_candidate_version === 2 ? 'AI 新版待審核 ' : 'AI 待審核 ') +
        pending.length +
        ' 首（v' +
        ai_candidate_version +
        ' 樣本共 ' +
        ai_items.length +
        ' 首）';
      render_track_list(page_items, true);
      render_pagination();
      return;
    }
    current_total = current_total || search_items.length;
    render_track_list(search_items, false);
    render_pagination();
  }

  function quality_filter_params() {
    var tier_el = document.getElementById('quality_filter_tier');
    var verdict_el = document.getElementById('quality_filter_verdict');
    var params = [];
    if (tier_el && tier_el.value) {
      params.push('confidence_tier=' + encodeURIComponent(tier_el.value));
    }
    if (verdict_el && verdict_el.value) {
      params.push('verdict=' + encodeURIComponent(verdict_el.value));
    }
    return params.length ? '?' + params.join('&') : '';
  }

  function load_quality_audit_tracks() {
    return fetch_json('/api/quality-audit/tracks' + quality_filter_params()).then(
      function (data) {
        quality_audit_items = data.items || [];
        current_total = quality_audit_items.length;
        clamp_current_page();
        return fetch_json('/api/quality-audit/status');
      }
    ).then(function (status) {
      quality_audit_status = status;
      render_quality_summary(status);
      render_quality_track_list();
    });
  }

  function render_quality_summary(status) {
    var box = document.getElementById('quality_summary');
    if (!box) {
      return;
    }
    var rep = status && status.report_summary ? status.report_summary : null;
    var prog = rep && rep.verification_progress ? rep.verification_progress : null;
    var rates = rep && rep.rates ? rep.rates : null;
    var vc = rep && rep.verdict_counts ? rep.verdict_counts : null;
    var html =
      '<p class="quality_progress"><strong>驗證進度</strong>：' +
      (prog ? prog.reviewed + '／' + prog.total + ' 已填寫' : '—') +
      '</p>';
    if (rates && rates.has_human_verification && vc) {
      html +=
        '<p class="quality_rates">可判斷子集（不含無法判斷）：正確 ' +
        (rates.correct_pct != null ? rates.correct_pct + '%' : '—') +
        '、部分正確 ' +
        (rates.partial_pct != null ? rates.partial_pct + '%' : '—') +
        '、錯誤 ' +
        (rates.incorrect_pct != null ? rates.incorrect_pct + '%' : '—') +
        '（分母 ' +
        rates.denominator_judged +
        ' 首）</p>';
    } else {
      html +=
        '<p class="muted">尚無人工驗證結果，不顯示準確率。20 首為分層抽樣，不可外推全庫。</p>';
    }
    box.innerHTML = html;
  }

  function render_quality_track_list() {
    var batch_bar = document.getElementById('batch_toolbar');
    if (batch_bar) {
      batch_bar.hidden = true;
    }
    el_track_list.innerHTML = '';
    var prog =
      quality_audit_status &&
      quality_audit_status.report_summary &&
      quality_audit_status.report_summary.verification_progress;
    current_total = quality_audit_items.length;
    clamp_current_page();
    var page_items = paginate_items(quality_audit_items);
    el_search_meta.textContent =
      '品質驗證抽樣 ' +
      quality_audit_items.length +
      ' 首' +
      (prog ? '（已驗證 ' + prog.reviewed + '／' + prog.total + '）' : '');
    for (var i = 0; i < page_items.length; i += 1) {
      var item = page_items[i];
      var li = document.createElement('li');
      li.className = 'track_list_item';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'track_list_btn';
      btn.setAttribute('data-id', item.spotify_id);
      if (item.spotify_id === selected_track_id) {
        btn.className += ' track_list_btn_active';
      }
      var title = document.createElement('div');
      title.className = 'track_title';
      title.textContent = display_track_title(item);
      var verdict = item.quality_review ? item.quality_review.verdict : 'unset';
      var sub = document.createElement('div');
      sub.className = 'track_sub';
      var id_span = document.createElement('span');
      id_span.className = 'track_spotify_id';
      id_span.textContent = item.spotify_id;
      var status_span = document.createElement('span');
      status_span.textContent =
        '· ' +
        L.format_confidence_tier(item.confidence_tier, { short: true }) +
        ' · ' +
        (QUALITY_VERDICT_LABELS[verdict] || verdict);
      sub.appendChild(id_span);
      sub.appendChild(status_span);
      btn.appendChild(title);
      btn.appendChild(sub);
      btn.addEventListener('click', function (id) {
        return function () {
          select_quality_track(id);
        };
      }(item.spotify_id));
      li.appendChild(btn);
      el_track_list.appendChild(li);
    }
    if (!page_items.length) {
      el_track_list.innerHTML = '<li class="list_empty muted">沒有符合的歌曲</li>';
    }
    el_track_list.scrollTop = 0;
    render_pagination();
  }

  function page_count() {
    return Pagination.page_count(current_total, page_size);
  }

  function clamp_current_page() {
    current_page = Pagination.clamp_page(current_page, current_total, page_size);
    page_by_mode[list_mode] = current_page;
  }

  function paginate_items(items) {
    return Pagination.slice_page(items, current_page, page_size);
  }

  function pagination_pages(total_pages, radius) {
    return Pagination.visible_pages(total_pages, current_page, radius);
  }

  function pagination_button(label, page, disabled, extra_class, current) {
    return '<button type="button" class="pagination_btn ' + (extra_class || '') +
      '" data-page="' + page + '"' + (disabled ? ' disabled' : '') +
      (current ? ' aria-current="page"' : '') + '>' + label + '</button>';
  }

  function render_pagination() {
    if (!el_pagination) return;
    var total_pages = page_count();
    if (current_total <= page_size) {
      el_pagination.innerHTML = '';
      el_pagination.hidden = true;
      return;
    }
    el_pagination.hidden = false;
    pagination_radius = el_pagination.clientWidth >= 520 ? 2 : 1;
    var html = '<div class="pagination_full">';
    html += pagination_button('上一頁', current_page - 1, current_page === 1, '', false);
    var pages = pagination_pages(total_pages, pagination_radius);
    for (var i = 0; i < pages.length; i += 1) {
      if (typeof pages[i] === 'string') {
        html += '<span class="pagination_ellipsis" aria-hidden="true">…</span>';
      } else {
        html += pagination_button(String(pages[i]), pages[i], false, 'pagination_number', pages[i] === current_page);
      }
    }
    html += pagination_button('下一頁', current_page + 1, current_page === total_pages, '', false);
    html += '</div><div class="pagination_compact">';
    html += pagination_button('上一頁', current_page - 1, current_page === 1, '', false);
    html += '<span class="pagination_status">第 ' + current_page + ' / ' + total_pages + ' 頁</span>';
    html += pagination_button('下一頁', current_page + 1, current_page === total_pages, '', false);
    html += '</div>';
    el_pagination.innerHTML = html;
  }

  function change_page(page) {
    var next = Math.min(Math.max(1, page), page_count());
    if (next === current_page || !confirm_leave_if_dirty()) return;
    current_page = next;
    page_by_mode[list_mode] = current_page;
    if (list_mode === 'all') {
      run_search(false).catch(show_error);
    } else {
      render_current_list();
    }
  }

  function find_track_index(items, track_id) {
    if (!track_id) return -1;
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].spotify_id === track_id) return i;
    }
    return -1;
  }

  function scroll_track_into_list(track_id) {
    if (!track_id) return;
    var rows = el_track_list.querySelectorAll('[data-id]');
    var target = null;
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].getAttribute('data-id') === track_id) {
        target = rows[i];
        break;
      }
    }
    if (!target) return;
    var list_rect = el_track_list.getBoundingClientRect();
    var target_rect = target.getBoundingClientRect();
    if (target_rect.top < list_rect.top) {
      el_track_list.scrollTop -= list_rect.top - target_rect.top;
    } else if (target_rect.bottom > list_rect.bottom) {
      el_track_list.scrollTop += target_rect.bottom - list_rect.bottom;
    }
  }

  function schedule_scroll_track_into_list(track_id) {
    var schedule = window.requestAnimationFrame || function (callback) {
      window.setTimeout(callback, 0);
    };
    schedule(function () {
      scroll_track_into_list(track_id);
    });
  }

  function locate_selected_in_client_list(items) {
    var index = find_track_index(items, selected_track_id);
    if (index < 0) return false;
    current_page = Math.floor(index / page_size) + 1;
    page_by_mode[list_mode] = current_page;
    render_current_list();
    schedule_scroll_track_into_list(selected_track_id);
    return true;
  }

  function select_quality_track(track_id) {
    if (!confirm_leave_if_dirty()) {
      return;
    }
    quality_selected_id = track_id;
    selected_track_id = track_id;
    el_workspace.classList.add('workspace_has_selection');
    render_quality_track_list();
    fetch_json(
      '/api/quality-audit/track/' + encodeURIComponent(track_id)
    ).then(function (data) {
      render_quality_detail(data.track);
      open_detail_mobile();
    }).catch(show_error);
  }

  function render_quality_detail(track) {
    if (!track) {
      el_detail.innerHTML = '<p class="muted">無資料</p>';
      return;
    }
    var ai = track.ai || {};
    var prim = ai.primary_genre || {};
    var html =
      '<div class="detail_section detail_section_quality">' +
      '<h2 class="detail_title">' +
      escape_html(track.display.name || track.spotify_id) +
      '</h2>' +
      '<p class="detail_meta">' +
      escape_html((track.display.artists || []).join('、')) +
      ' · ' +
      escape_html(track.display.album_name || '') +
      ' · ' +
      escape_html(L.format_decade_value(track.decade)) +
      '</p>';
    if (track.spotify_open_url) {
      html +=
        '<p><a class="spotify_link" href="' +
        escape_html(track.spotify_open_url) +
        '" target="_blank" rel="noopener noreferrer">在 Spotify 開啟（需自行登入，不自動播放）</a></p>';
    }
    html +=
      '<p class="tier_badge">分類可信度：<strong>' +
      escape_html(L.format_confidence_tier(track.confidence_tier, { short: true })) +
      '</strong></p>';
    if (track.uncertainty_hints && track.uncertainty_hints.length) {
      html += '<ul class="hint_list">';
      for (var h = 0; h < track.uncertainty_hints.length; h += 1) {
        html +=
          '<li>' + escape_html(track.uncertainty_hints[h]) + '</li>';
      }
      html += '</ul>';
    }
    html +=
      '<h3 class="subsection_title">AI 分類（僅供驗證）</h3>' +
      '<dl class="detail_dl">' +
      '<dt>主曲風</dt><dd>' +
      escape_html(prim.label_zh || prim.code) +
      ' — ' +
      escape_html(display_freeform(prim.evidence || '')) +
      '</dd>';
    if (ai.language) {
      html +=
        '<dt>語言</dt><dd>' +
        escape_html(ai.language.value) +
        ' — ' +
        escape_html(display_freeform(ai.language.evidence || '')) +
        '</dd>';
    }
    html += '</dl>';
    if (ai.analysis_note) {
      html +=
        '<p class="analysis_note"><strong>分析備註</strong>：' +
        escape_html(display_freeform(ai.analysis_note)) +
        '</p>';
    }
    var rev = track.quality_review || {};
    html +=
      '<h3 class="subsection_title">人工品質驗證</h3>' +
      '<p class="muted">此表單不會接受 AI 或寫入正式覆寫。</p>' +
      '<form id="quality_review_form" class="form_stack">' +
      '<fieldset class="quality_verdict_fieldset"><legend>判定</legend>' +
      '<label><input type="radio" name="quality_verdict" value="correct"' +
      (rev.verdict === 'correct' ? ' checked' : '') +
      '> 正確</label> ' +
      '<label><input type="radio" name="quality_verdict" value="partial"' +
      (rev.verdict === 'partial' ? ' checked' : '') +
      '> 部分正確</label> ' +
      '<label><input type="radio" name="quality_verdict" value="incorrect"' +
      (rev.verdict === 'incorrect' ? ' checked' : '') +
      '> 錯誤</label> ' +
      '<label><input type="radio" name="quality_verdict" value="undecidable"' +
      (rev.verdict === 'undecidable' ? ' checked' : '') +
      '> 無法判斷</label> ' +
      '<label><input type="radio" name="quality_verdict" value="unset"' +
      (rev.verdict === 'unset' || !rev.verdict ? ' checked' : '') +
      '> 清除／尚未驗證</label></fieldset>' +
      '<fieldset class="quality_dims_fieldset"><legend>錯誤維度（可複選）</legend>' +
      '<label><input type="checkbox" class="quality_dim_cb" value="primary_genre"> 主曲風</label> ' +
      '<label><input type="checkbox" class="quality_dim_cb" value="secondary_genre"> 次要曲風</label> ' +
      '<label><input type="checkbox" class="quality_dim_cb" value="subgenre"> 子曲風</label> ' +
      '<label><input type="checkbox" class="quality_dim_cb" value="language"> 語言</label> ' +
      '<label><input type="checkbox" class="quality_dim_cb" value="context"> 情境</label> ' +
      '<label><input type="checkbox" class="quality_dim_cb" value="special_type"> 特殊標籤</label></fieldset>' +
      '<label class="field_label" for="quality_note">備註</label>' +
      '<textarea id="quality_note" class="field_input" rows="3">' +
      escape_html(rev.note || '') +
      '</textarea>' +
      '<button type="submit" class="btn btn_primary">儲存品質驗證</button>' +
      '</form></div>';
    el_detail.innerHTML = html;
    var dims = rev.wrong_dimensions || [];
    var cbs = el_detail.querySelectorAll('.quality_dim_cb');
    for (var c = 0; c < cbs.length; c += 1) {
      if (dims.indexOf(cbs[c].value) >= 0) {
        cbs[c].checked = true;
      }
    }
    var form = document.getElementById('quality_review_form');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        submit_quality_review(track.spotify_id);
      });
    }
  }

  function submit_quality_review(track_id) {
    var verdict_input = el_detail.querySelector(
      'input[name="quality_verdict"]:checked'
    );
    var verdict = verdict_input ? verdict_input.value : 'unset';
    var note_el = document.getElementById('quality_note');
    var note = note_el ? note_el.value : '';
    var wrong = [];
    var cbs = el_detail.querySelectorAll('.quality_dim_cb:checked');
    for (var i = 0; i < cbs.length; i += 1) {
      wrong.push(cbs[i].value);
    }
    fetch_json('/api/quality-audit/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spotify_id: track_id,
        verdict: verdict,
        wrong_dimensions: wrong,
        note: note,
      }),
    })
      .then(function () {
        show_toast('品質驗證已儲存（未寫入正式審核）', false);
        return load_quality_audit_tracks();
      })
      .then(function () {
        return select_quality_track(track_id);
      })
      .catch(show_error);
  }

  function toggle_quality_mode_ui(on) {
    var notice = document.getElementById('quality_audit_notice');
    var filters = document.getElementById('quality_audit_filters');
    var summary = document.getElementById('quality_summary');
    var filter_coll = document.getElementById('filter_collapsible');
    var search_block = document.querySelector('.search_block');
    var ai_batch_row = document.querySelector('.ai_batch_row');
    if (notice) {
      notice.hidden = !on;
    }
    if (filters) {
      filters.hidden = !on;
    }
    if (summary) {
      summary.hidden = !on;
    }
    if (filter_coll) {
      filter_coll.hidden = on;
    }
    if (search_block) {
      search_block.hidden = on;
    }
    if (ai_batch_row) {
      ai_batch_row.hidden = on;
    }
    var btn_search = document.getElementById('btn_search');
    if (btn_search) {
      btn_search.hidden = on;
    }
  }

  function render_track_list(items, show_review_badge) {
    el_track_list.innerHTML = '';
    var show_batch =
      show_review_badge && ai_candidate_version === 2 && ai_items.length > 0;
    var batch_bar = document.getElementById('batch_toolbar');
    if (batch_bar) {
      batch_bar.hidden = !show_batch;
    }
    update_batch_selection_meta(items, show_batch);
    for (var i = 0; i < items.length; i += 1) {
      var row = items[i];
      var li = document.createElement('li');
      li.className = 'track_list_item';
      if (show_batch) {
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'track_list_cb';
        cb.setAttribute('data-id', row.spotify_id);
        cb.checked = !!ai_selected_ids[row.spotify_id];
        cb.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var tid = this.getAttribute('data-id');
          if (this.checked) {
            ai_selected_ids[tid] = true;
          } else {
            delete ai_selected_ids[tid];
          }
          update_batch_selection_meta(items, show_batch);
        });
        li.appendChild(cb);
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'track_list_btn';
      btn.setAttribute('data-id', row.spotify_id);
      if (row.spotify_id === selected_track_id) {
        btn.className += ' track_list_btn_active';
      }
      var title = document.createElement('div');
      title.className = 'track_title';
      title.textContent = display_track_title(row);
      var sub = document.createElement('div');
      sub.className = 'track_sub';
      if (show_review_badge) {
        var rev =
          row.review && row.review.status ? row.review.status : 'pending';
        var tier_txt = row.confidence_tier
          ? ' · ' + L.format_confidence_tier(row.confidence_tier, { short: true })
          : '';
        sub.innerHTML =
          '<span class="track_spotify_id">' +
          escape_html(row.spotify_id) +
          '</span> <span class="review_badge ' +
          review_badge_class(rev) +
          '">' +
          escape_html(
            L.format_review_status_label(rev, {
              candidate_version: ai_candidate_version,
              label: row.review && row.review.label,
            })
          ) +
          '</span><span class="tier_badge muted">' +
          escape_html(tier_txt) +
          '</span>';
      } else {
        sub.className += ' track_spotify_id';
        sub.textContent = row.spotify_id;
      }
      btn.appendChild(title);
      btn.appendChild(sub);
      btn.addEventListener('click', function () {
        select_track(this.getAttribute('data-id'));
      });
      li.appendChild(btn);
      el_track_list.appendChild(li);
    }
    if (!items.length) {
      el_track_list.innerHTML = '<li class="list_empty muted">沒有符合的歌曲</li>';
    }
    el_track_list.scrollTop = 0;
  }

  function count_selected_in_scope(items) {
    var n = 0;
    for (var i = 0; i < items.length; i += 1) {
      if (ai_selected_ids[items[i].spotify_id]) {
        n += 1;
      }
    }
    return n;
  }

  function update_batch_selection_meta(items, show_batch) {
    var meta = document.getElementById('batch_selection_meta');
    var scope = document.getElementById('batch_scope_count');
    var sel_all = document.getElementById('batch_select_all');
    if (!meta || !show_batch) {
      return;
    }
    var selected_n = count_selected_in_scope(items);
    meta.textContent =
      '已選 ' + selected_n + ' 首（目前清單 ' + items.length + ' 首）';
    if (scope) {
      scope.textContent = String(items.length);
    }
    if (sel_all) {
      sel_all.checked = items.length > 0 && selected_n === items.length;
    }
  }

  function get_selected_track_ids(items) {
    var out = [];
    for (var i = 0; i < items.length; i += 1) {
      var id = items[i].spotify_id;
      if (ai_selected_ids[id]) {
        out.push(id);
      }
    }
    return out;
  }

  function new_batch_client_op_id() {
    return 'ui-' + String(Date.now()) + '-' + String(Math.random()).slice(2, 8);
  }

  function current_ai_list_items() {
    return paginate_items(get_ai_pending_items());
  }

  function run_batch_review(action) {
    var items = current_ai_list_items();
    var ids = get_selected_track_ids(items);
    if (!ids.length) {
      show_toast('請先勾選曲目', true);
      return Promise.resolve();
    }
    var max_n =
      (preview_settings && preview_settings.batch_review_max) || 30;
    if (ids.length > max_n) {
      show_toast('超過單次上限 ' + max_n + ' 首', true);
      return Promise.resolve();
    }
    var action_label =
      action === 'accept'
        ? '接受'
        : action === 'reject'
          ? '拒絕'
          : '保留待審核';
    return fetch_json('/api/ai/batch-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: action,
        spotify_ids: ids,
        candidate_version: 2,
        test_batch_id: ai_test_batch,
        confirm: false,
      }),
    })
      .then(function (preview_data) {
        var p = preview_data.preview;
        var msg =
          '批次「' +
          action_label +
          '」預覽：\n將套用 ' +
          p.would_apply +
          ' 首\n跳過 ' +
          p.skipped +
          ' 首\n失敗 ' +
          p.failed +
          ' 首\n\n確定執行？';
        if (!window.confirm(msg)) {
          return null;
        }
        if (
          !window.confirm(
            '再次確認：最多 ' + p.would_apply + ' 首將變更審核狀態。'
          )
        ) {
          return null;
        }
        batch_client_op_id = new_batch_client_op_id();
        return fetch_json('/api/ai/batch-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: action,
            spotify_ids: ids,
            candidate_version: 2,
            test_batch_id: ai_test_batch,
            confirm: true,
            client_operation_id: batch_client_op_id,
          }),
        });
      })
      .then(function (exec_data) {
        if (!exec_data) {
          return;
        }
        var r = exec_data.result;
        show_toast(
          '批次完成：成功 ' +
            r.success +
            ' · 跳過 ' +
            r.skipped +
            ' · 失敗 ' +
            r.failed,
          false
        );
        ai_selected_ids = {};
        return load_ai_review();
      })
      .then(function () {
        render_current_list();
        if (summary_data) {
          return fetch_json('/api/status').then(function (d) {
            summary_data = d.summary;
            render_overview(summary_data);
          });
        }
      })
      .catch(show_error);
  }

  function load_preview_settings() {
    return fetch_json('/api/preview/settings').then(function (data) {
      preview_settings = data.settings;
      var sel = document.getElementById('preview_mode');
      if (sel && preview_settings.preview_mode) {
        sel.value = preview_settings.preview_mode;
      }
    });
  }

  function save_preview_mode(mode) {
    return fetch_json('/api/preview/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preview_mode: mode }),
    }).then(function (data) {
      preview_settings = data.settings;
    });
  }

  function run_playlist_preview() {
    var params = new URLSearchParams();
    var decade = document.getElementById('filter_decade').value;
    var language = document.getElementById('filter_language').value;
    var context = document.getElementById('filter_context').value;
    var primary_genre = document.getElementById('filter_primary_genre').value;
    var subgenre = document.getElementById('filter_subgenre').value;
    var special_type_el = document.getElementById('filter_special_type');
    var special_type = special_type_el ? special_type_el.value : '';
    var mode_el = document.getElementById('preview_mode');
    var mode = mode_el ? mode_el.value : 'balanced';
    if (decade) {
      params.set('decade', decade);
    }
    if (language) {
      params.set('language', language);
    }
    if (context) {
      params.set('context', context);
    }
    if (primary_genre) {
      params.set('primary_genre', primary_genre);
    }
    if (subgenre) {
      params.set('subgenre', subgenre);
    }
    params.set('preview_mode', mode);
    if (special_type) {
      params.set('special_type', special_type);
    }
    return fetch_json('/api/preview/playlist?' + params.toString()).then(
      function (data) {
        var box = document.getElementById('preview_result');
        if (!box) {
          return;
        }
        var b = data.preview.breakdown;
        var html =
          '<p><strong>正式索引預覽</strong>（模式：' +
          escape_html(L.format_preview_mode(data.preview.preview_mode)) +
          '）</p>' +
          '<ul class="preview_stats_list">' +
          '<li>符合條件（去重）：' +
          b.total_unique +
          '</li>' +
          '<li>已人工確認：' +
          b.confirmed +
          '</li>' +
          '<li>AI 待審核：' +
          b.ai_unreviewed +
          '</li>' +
          '<li>資料不足／未納入：' +
          b.insufficient +
          '</li>' +
          '<li>可信度 高／中／低：' +
          b.tier.high +
          '／' +
          b.tier.medium +
          '／' +
          b.tier.low +
          '</li></ul>';
        if (data.g3_unified_preview && data.g3_unified_preview.g3_unified) {
          var g = data.g3_unified_preview.breakdown;
          html +=
            '<p><strong>G3 統一檢視預覽</strong>（含 G3-B AI 建議；區分來源）</p>' +
            '<ul class="preview_stats_list">' +
            '<li>符合條件（有曲名）：' +
            g.total_unique +
            '</li>' +
            '<li>人工確認：' +
            g.by_provenance.human_confirmed +
            '</li>' +
            '<li>有證據支持：' +
            g.by_provenance.verified_evidence +
            '</li>' +
            '<li>AI 建議：' +
            g.by_provenance.ai_suggestion +
            '</li>' +
            '<li>未知／規則：' +
            g.by_provenance.unknown +
            '</li>' +
            '<li>試驗樣本 100 命中：' +
            g.in_g3_sample_100 +
            '</li></ul>';
          if (data.g3_unified_preview.sample_100_balanced_gap) {
            var sg = data.g3_unified_preview.sample_100_balanced_gap;
            html +=
              '<p class="muted">試驗 100 首：納入 ' +
              sg.included_in_balanced_empty_filter +
              '／排除 ' +
              sg.excluded_count +
              '（多為 balanced 排除 low tier；非資料遺失）</p>';
          }
        }
        box.innerHTML = html;
        box.className = 'preview_result';
      }
    );
  }

  function display_track_title(row) {
    if (row.metadata_status !== 'complete') {
      return '（歌曲資訊待補齊）';
    }
    var d = row.display || {};
    var artists = L.format_artists_display(d.artists || [], '、');
    return (d.name || '（無歌名）') + (artists ? ' — ' + artists : '');
  }

  function confirm_leave_if_dirty() {
    if (!ai_form_dirty && !override_form_dirty) {
      return true;
    }
    return window.confirm('尚有未儲存的分類修改，確定要離開目前歌曲嗎？');
  }

  function select_track(track_id) {
    if (!confirm_leave_if_dirty()) {
      return Promise.resolve();
    }
    selected_track_id = track_id;
    el_workspace.classList.add('workspace_has_selection');
    ai_form_dirty = false;
    override_form_dirty = false;
    render_current_list();

    if (ai_id_map[track_id]) {
      return fetch_json(
        '/api/ai/track/' +
          encodeURIComponent(track_id) +
          '?candidate_version=' +
          ai_candidate_version +
          '&test_batch_id=' +
          encodeURIComponent(ai_test_batch)
      ).then(function (data) {
        render_unified_detail(
          data.track,
          data.candidate,
          data.review,
          data.genre_profile_suggested,
          data
        );
        open_detail_mobile();
      });
    }
    return fetch_json('/api/track/' + encodeURIComponent(track_id)).then(
      function (data) {
        render_unified_detail(data.track, null, null, null);
        open_detail_mobile();
      }
    );
  }

  function render_genre_profile_block(profile, title) {
    if (!profile) {
      return '';
    }
    var html = '<div class="genre_profile_block">';
    if (title) {
      html += '<h4 class="genre_profile_title">' + escape_html(title) + '</h4>';
    }
    html +=
      '<p><span class="detail_label">主要曲風</span> ' +
      escape_html(main_genre_label(profile.primary_genre)) +
      '</p>';
    if (profile.secondary_genres && profile.secondary_genres.length) {
      html += '<p><span class="detail_label">次要曲風</span> ';
      var sec = [];
      for (var i = 0; i < profile.secondary_genres.length; i += 1) {
        sec.push(main_genre_label(profile.secondary_genres[i]));
      }
      html += escape_html(sec.join('、')) + '</p>';
    }
    if (profile.subgenres && profile.subgenres.length) {
      html += '<p><span class="detail_label">子曲風</span> ';
      var subs = [];
      for (var s = 0; s < profile.subgenres.length; s += 1) {
        subs.push(subgenre_label(profile.subgenres[s]));
      }
      html += escape_html(subs.join('、')) + '</p>';
    }
    if (profile.legacy_genre_labels && profile.legacy_genre_labels.length) {
      html +=
        '<p class="muted"><span class="detail_label">舊版標籤</span> ' +
        escape_html(profile.legacy_genre_labels.join('、')) +
        '</p>';
    }
    if (profile.unmigrated_legacy_labels && profile.unmigrated_legacy_labels.length) {
      html +=
        '<p class="hint_text">待人工確認的舊版標籤：' +
        escape_html(profile.unmigrated_legacy_labels.join('、')) +
        '</p>';
    }
    html += '</div>';
    return html;
  }

  function open_detail_mobile() {
    if (window.matchMedia('(max-width: 767px)').matches) {
      el_workspace.classList.add('workspace_show_detail');
    }
  }

  function review_badge_class(status) {
    if (status === 'accepted') {
      return 'review_accepted';
    }
    if (status === 'rejected') {
      return 'review_rejected';
    }
    if (status === 'modified') {
      return 'review_modified';
    }
    return 'review_pending';
  }

  function render_ai_compare_block(api_data) {
    if (!api_data || !api_data.compare) {
      return '';
    }
    var cmp = api_data.compare;
    var html =
      '<div class="detail_subblock detail_section_compare"><h4 class="detail_subtitle">新舊 AI 分類對照</h4>';
    if (api_data.v1_human_confirmed) {
      html +=
        '<p class="hint_text v1_confirmed_badge">v1 已有人工確認（' +
        escape_html(
          L.format_review_status_label(
            api_data.v1_review && api_data.v1_review.status
              ? api_data.v1_review.status
              : 'pending'
          )
        ) +
        '）；以下為 v2 建議，不會自動覆寫。</p>';
    }
    html += render_genre_profile_block(cmp.v1_profile, 'v1 AI 曲風');
    html += render_genre_profile_block(cmp.v2_profile, 'v2 AI 曲風');
    if (cmp.changed) {
      html += '<p class="compare_changed">與 v1 分類有差異</p><ul class="compare_fields">';
      var fields = cmp.fields || {};
      var keys = Object.keys(fields);
      for (var i = 0; i < keys.length; i += 1) {
        if (fields[keys[i]]) {
          html += '<li>' + escape_html(keys[i]) + '</li>';
        }
      }
      html += '</ul>';
    } else {
      html += '<p class="muted">v1 與 v2 曲風／維度建議一致。</p>';
    }
    html += '</div>';
    return html;
  }

  function render_unified_detail(
    track,
    candidate,
    review,
    genre_profile_suggested,
    api_extra
  ) {
    if (!track) {
      el_detail.innerHTML = '<p class="muted">找不到曲目。</p>';
      return;
    }
    var html = '';
    html += '<header class="detail_header">';
    if (track.metadata_status === 'complete') {
      var d = track.display || {};
      html +=
        '<h2 class="detail_title">' + escape_html(d.name || '（無歌名）') + '</h2>';
      html +=
        '<p class="detail_artists">' +
        escape_html(L.format_artists_display(d.artists || [], '、')) +
        '</p>';
      if (d.album_name) {
        html +=
          '<p class="detail_album"><span class="detail_label">專輯</span> ' +
          escape_html(d.album_name) +
          '</p>';
      }
    } else {
      html += '<h2 class="detail_title">（歌曲資訊待補齊）</h2>';
    }
    html +=
      '<p class="track_spotify_id detail_id"><span class="label_muted">Spotify ID</span> ' +
      '<code class="id_code">' +
      escape_html(track.spotify_id) +
      '</code> <button type="button" class="btn_copy btn_link" data-copy-id="' +
      escape_html(track.spotify_id) +
      '">複製</button></p>';
    html +=
      '<p class="meta_status">' +
      escape_html(L.format_metadata_status_label(track.metadata_status)) +
      '</p>';
    html += '</header>';

    html +=
      '<section class="detail_section detail_section_official" aria-labelledby="sec_official_title">';
    html += '<div class="section_head">';
    html +=
      '<h3 class="detail_section_title" id="sec_official_title">目前正式分類</h3>';
    html +=
      '<p class="section_notice section_notice_live">此區為索引中<strong>已生效</strong>的分類（含人工覆寫）。與下方 AI 建議無關。</p>';
    html += '</div>';
    html += render_genre_profile_block(track.genre_profile, '曲風（新版）');
    html += render_tags_section(track.tags || []);
    html += '</section>';

    if (candidate) {
      var rev = review && review.status ? review.status : 'pending';
      html +=
        '<section class="detail_section detail_section_ai_suggest" aria-labelledby="sec_ai_suggest_title">';
      html += '<div class="section_head">';
      html +=
        '<h3 class="detail_section_title" id="sec_ai_suggest_title">AI 建議分類</h3>';
      html +=
        '<p class="section_notice section_notice_preview">此為 AI 候選建議，<strong>尚未寫入正式分類</strong>；須在「AI 人工審核」接受後才會生效。</p>';
      html +=
        '<p class="ai_review_status">審核狀態（v' +
        ai_candidate_version +
        '）：<span class="review_badge ' +
        review_badge_class(rev) +
        '">' +
        escape_html(
          L.format_review_status_label(rev, {
            candidate_version: ai_candidate_version,
            label: review && review.label,
          })
        ) +
        '</span></p>';
      html += '</div>';
      html += render_ai_compare_block(api_extra);
      html += render_genre_profile_block(
        genre_profile_suggested,
        'AI 建議曲風（v' + ai_candidate_version + '）'
      );
      html += format_ai_candidate(candidate);
      html += '</section>';
      html += render_ai_review_form(
        track.spotify_id,
        candidate,
        genre_profile_suggested
      );
    } else if (ai_status && ai_status.has_candidates) {
      html +=
        '<section class="detail_section"><p class="muted">此曲不在 AI 30 首測試樣本中。</p></section>';
    }

    html += render_override_form(track);
    el_detail.innerHTML = html;
    bind_copy_buttons();
    bind_override_form(track);
    bind_genre_profile_override_controls(track);
    if (candidate) {
      bind_ai_review_form(track.spotify_id);
    }
  }

  function bind_genre_profile_override_controls(track) {
    var gp = track.genre_profile || {};
    var wrap = document.getElementById('ov_secondary_wrap');
    var primary_sel = document.getElementById('ov_primary_genre');
    var sub_sel = document.getElementById('ov_subgenres');
    if (!wrap || !primary_sel || !sub_sel) {
      return;
    }
    function rebuild_secondary() {
      wrap.innerHTML = '';
      if (!genre_taxonomy) {
        return;
      }
      var selected = gp.secondary_genres || [];
      for (var i = 0; i < genre_taxonomy.main_genres.length; i += 1) {
        var mg = genre_taxonomy.main_genres[i];
        if (mg.code === primary_sel.value) {
          continue;
        }
        var id = 'ov_sec_' + mg.code;
        var label = document.createElement('label');
        label.className = 'checkbox_item';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = mg.code;
        cb.id = id;
        if (selected.indexOf(mg.code) >= 0) {
          cb.checked = true;
        }
        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + mg.label_zh));
        wrap.appendChild(label);
      }
    }
    function rebuild_subgenres() {
      sub_sel.innerHTML = '';
      if (!genre_taxonomy) {
        return;
      }
      var mains = [primary_sel.value];
      var cbs = wrap.querySelectorAll('input[type=checkbox]:checked');
      for (var c = 0; c < cbs.length; c += 1) {
        mains.push(cbs[c].value);
      }
      var selected_sub = gp.subgenres || [];
      var subs = genre_taxonomy.subgenres || {};
      var keys = Object.keys(subs).sort();
      for (var k = 0; k < keys.length; k += 1) {
        var row = subs[keys[k]];
        if (mains.indexOf(row.main) < 0) {
          continue;
        }
        var opt = document.createElement('option');
        opt.value = row.code;
        opt.textContent = row.label_zh;
        if (selected_sub.indexOf(row.code) >= 0) {
          opt.selected = true;
        }
        sub_sel.appendChild(opt);
      }
    }
    rebuild_secondary();
    rebuild_subgenres();
    primary_sel.addEventListener('change', function () {
      rebuild_secondary();
      rebuild_subgenres();
    });
    wrap.addEventListener('change', rebuild_subgenres);
  }

  function read_genre_profile_from_form() {
    var primary = document.getElementById('ov_primary_genre');
    if (!primary) {
      return null;
    }
    var secondary = [];
    var wrap = document.getElementById('ov_secondary_wrap');
    if (wrap) {
      var cbs = wrap.querySelectorAll('input[type=checkbox]:checked');
      for (var i = 0; i < cbs.length && secondary.length < 2; i += 1) {
        secondary.push(cbs[i].value);
      }
    }
    var sub_sel = document.getElementById('ov_subgenres');
    var subgenres = [];
    if (sub_sel) {
      for (var s = 0; s < sub_sel.options.length; s += 1) {
        if (sub_sel.options[s].selected) {
          subgenres.push(sub_sel.options[s].value);
        }
      }
    }
    return {
      primary_genre: primary.value || 'unknown',
      secondary_genres: secondary,
      subgenres: subgenres,
    };
  }

  function render_tags_section(tags) {
    if (!tags.length) {
      return '<p class="muted">尚無分類標籤</p>';
    }
    var html = '<ul class="tag_list">';
    for (var i = 0; i < tags.length; i++) {
      var t = tags[i];
      var manual_badge = t.is_manual_override
        ? ' <span class="tag_badge tag_badge_manual">人工覆寫</span>'
        : '';
      html +=
        '<li class="' +
        (t.is_manual_override ? 'tag_manual' : '') +
        '"><span class="tag_head">' +
        escape_html(L.format_tag_line(t)) +
        manual_badge +
        '</span><span class="tag_evidence">' +
        escape_html(display_freeform(t.evidence || '（無判斷依據說明）')) +
        '</span></li>';
    }
    html += '</ul>';
    return html;
  }

  function render_override_form(track) {
    var gp = track.genre_profile || {};
    var html =
      '<section class="detail_section detail_section_override override_form" aria-labelledby="sec_override_title">';
    html += '<div class="section_head">';
    html +=
      '<h3 class="detail_section_title" id="sec_override_title">人工覆寫分類</h3>';
    html +=
      '<p class="section_notice">直接編輯並保存後寫入正式分類；與 AI 審核接受為不同路徑。</p>';
    html += '</div>';
    html += '<div class="form_stack">';
    html += '<h4 class="form_subgroup_title">曲風（新版）</h4>';
    html += '<div class="form_field">';
    html += '<label class="field_label" for="ov_primary_genre">主要曲風</label>';
    html += '<select id="ov_primary_genre" class="field_select">';
    html += '<option value="unknown">未確認</option>';
    if (genre_taxonomy && genre_taxonomy.main_genres) {
      for (var i = 0; i < genre_taxonomy.main_genres.length; i += 1) {
        var mg = genre_taxonomy.main_genres[i];
        html +=
          '<option value="' +
          escape_html(mg.code) +
          '"' +
          (gp.primary_genre === mg.code ? ' selected' : '') +
          '>' +
          escape_html(mg.label_zh) +
          '</option>';
      }
    }
    html += '</select></div>';
    html += '<div class="form_field">';
    html += '<span class="field_label">次要曲風（最多 2 個）</span>';
    html += '<div id="ov_secondary_wrap" class="checkbox_group"></div></div>';
    html += '<div class="form_field">';
    html += '<label class="field_label" for="ov_subgenres">子曲風（可多選）</label>';
    html +=
      '<select id="ov_subgenres" class="field_select field_select_multi" multiple size="5"></select></div>';
    html += '<div class="form_field">';
    html += '<label class="field_label" for="ov_language">語言</label>';
    html +=
      '<select id="ov_language" class="field_select"><option value="">（不變）</option>' +
      option_list([
        '國語',
        '台語',
        '粵語',
        '英文',
        '日文',
        '韓文',
        '其他',
      ]) +
      '</select></div>';
    html += '<div class="form_field">';
    html += '<label class="field_label" for="ov_genre">曲風（舊版標籤，逗號分隔）</label>';
    html +=
      '<input id="ov_genre" class="field_input" placeholder="例：流行, 搖滾"></div>';
    html += '<div class="form_field">';
    html += '<label class="field_label" for="ov_context">情境（逗號分隔）</label>';
    html +=
      '<input id="ov_context" class="field_input" placeholder="例：懷舊, 開車"></div>';
    html += '<div class="form_field">';
    html += '<label class="field_label" for="ov_special">特殊類型（逗號分隔）</label>';
    html +=
      '<input id="ov_special" class="field_input" placeholder="例：完整專輯收藏"></div>';
    html += '</div>';
    html += '<div class="btn_row btn_row_actions btn_row_form_submit">';
    html +=
      '<button type="button" id="btn_save_override" class="btn btn_primary">保存覆寫</button>';
    html +=
      '<button type="button" id="btn_clear_override" class="btn btn_secondary">清除此曲覆寫</button>';
    html += '</div></section>';
    return html;
  }

  function render_ai_review_form(track_id, cand, genre_profile_suggested) {
    var html =
      '<section class="detail_section detail_section_ai_review" aria-labelledby="sec_ai_review_title">';
    html += '<div class="section_head">';
    html +=
      '<h3 class="detail_section_title" id="sec_ai_review_title">AI 人工審核</h3>';
    html +=
      '<p class="hint_text">接受前可修改下列欄位；已有非 AI 人工覆寫時，接受可能遭 API 拒絕。</p>';
    html += '</div>';
    html += '<div class="form_stack">';
    html += '<div class="form_field">';
    html += '<label class="field_label" for="ai_ov_primary">主要曲風（修改後接受）</label>';
    html +=
      '<select id="ai_ov_primary" class="field_select">' +
      build_main_genre_options(
        genre_profile_suggested ? genre_profile_suggested.primary_genre : 'unknown'
      ) +
      '</select></div>';
    html += '<div class="form_field">';
    html += '<label class="field_label" for="ai_ov_language">語言</label>';
    html +=
      '<input id="ai_ov_language" class="field_input" placeholder="例：國語或未確認" value="' +
      escape_html(cand.language ? cand.language.value : '') +
      '"></div>';
    html += '<div class="form_field">';
    html +=
      '<label class="field_label" for="ai_ov_genre">曲風（舊版標籤，逗號分隔）</label>';
    html +=
      '<input id="ai_ov_genre" class="field_input" value="' +
      escape_html(join_values(cand.genres)) +
      '"></div>';
    html += '<div class="form_field">';
    html += '<label class="field_label" for="ai_ov_context">情境（逗號分隔）</label>';
    html +=
      '<input id="ai_ov_context" class="field_input" value="' +
      escape_html(join_values(cand.moods || cand.contexts)) +
      '"></div>';
    html += '</div>';
    html += '<div class="btn_row btn_row_actions btn_row_review">';
    html +=
      '<button type="button" id="ai_btn_accept" class="btn btn_primary">接受建議</button>';
    html +=
      '<button type="button" id="ai_btn_modify" class="btn btn_secondary">修改後接受</button>';
    html +=
      '<button type="button" id="ai_btn_reject" class="btn btn_secondary">拒絕建議</button>';
    html +=
      '<button type="button" id="ai_btn_pending" class="btn btn_secondary">稍後審核</button>';
    html += '</div></section>';
    return html;
  }

  function option_list(values) {
    var html = '';
    for (var i = 0; i < values.length; i++) {
      html +=
        '<option value="' + escape_html(values[i]) + '">' + values[i] + '</option>';
    }
    return html;
  }

  function bind_copy_buttons() {
    var btns = el_detail.querySelectorAll('[data-copy-id]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var id = this.getAttribute('data-copy-id');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(id).then(function () {
            show_toast('已複製 Spotify ID', false);
          });
        }
      });
    }
  }

  function capture_ai_form_snapshot() {
    var lang = document.getElementById('ai_ov_language');
    if (!lang) {
      return '';
    }
    return (
      lang.value +
      '|' +
      (document.getElementById('ai_ov_genre').value || '') +
      '|' +
      (document.getElementById('ai_ov_context').value || '')
    );
  }

  function bind_ai_review_form(track_id) {
    ai_form_snapshot = capture_ai_form_snapshot();
    ai_form_dirty = false;
    var inputs = ['ai_ov_language', 'ai_ov_genre', 'ai_ov_context'];
    for (var i = 0; i < inputs.length; i++) {
      var el = document.getElementById(inputs[i]);
      if (el) {
        el.addEventListener('input', function () {
          ai_form_dirty = capture_ai_form_snapshot() !== ai_form_snapshot;
        });
      }
    }
    document.getElementById('ai_btn_accept').addEventListener('click', function () {
      post_ai_review(track_id, 'accept', null);
    });
    document.getElementById('ai_btn_modify').addEventListener('click', function () {
      post_ai_review(track_id, 'accept_modified', {
        language: document.getElementById('ai_ov_language').value.trim(),
        genres: split_csv(document.getElementById('ai_ov_genre').value),
        contexts: split_csv(document.getElementById('ai_ov_context').value),
        genre_profile: {
          primary_genre: document.getElementById('ai_ov_primary').value,
          secondary_genres: [],
          subgenres: [],
        },
      });
    });
    document.getElementById('ai_btn_reject').addEventListener('click', function () {
      post_ai_review(track_id, 'reject', null);
    });
    document.getElementById('ai_btn_pending').addEventListener('click', function () {
      post_ai_review(track_id, 'pending', null);
    });
  }

  function bind_override_form(track) {
    var btn_save = document.getElementById('btn_save_override');
    var btn_clear = document.getElementById('btn_clear_override');
    if (!btn_save) {
      return;
    }
    var override_fields = el_detail.querySelectorAll(
      '#ov_primary_genre, #ov_secondary_wrap input, #ov_subgenres, #ov_language, #ov_genre, #ov_context, #ov_special'
    );
    function capture_override_form_snapshot() {
      var values = [];
      for (var i = 0; i < override_fields.length; i += 1) {
        values.push(
          override_fields[i].type === 'checkbox'
            ? String(override_fields[i].checked)
            : Array.prototype.map.call(override_fields[i].selectedOptions || [], function (o) { return o.value; }).join(',') || override_fields[i].value
        );
      }
      return values.join('|');
    }
    override_form_snapshot = capture_override_form_snapshot();
    override_form_dirty = false;
    for (var f = 0; f < override_fields.length; f += 1) {
      override_fields[f].addEventListener('change', function () {
        override_form_dirty = capture_override_form_snapshot() !== override_form_snapshot;
      });
      override_fields[f].addEventListener('input', function () {
        override_form_dirty = capture_override_form_snapshot() !== override_form_snapshot;
      });
    }
    btn_save.addEventListener('click', function () {
      var body = {
        spotify_id: track.spotify_id,
        source: 'classify:ui',
      };
      var lang = document.getElementById('ov_language').value;
      if (lang) {
        body.language = lang;
      }
      var genres = split_csv(document.getElementById('ov_genre').value);
      if (genres.length) {
        body.genres = genres;
      }
      var contexts = split_csv(document.getElementById('ov_context').value);
      if (contexts.length) {
        body.contexts = contexts;
      }
      var special = split_csv(document.getElementById('ov_special').value);
      if (special.length) {
        body.special_types = special;
      }
      var gp_form = read_genre_profile_from_form();
      if (gp_form) {
        body.genre_profile = gp_form;
      }
      fetch_json('/api/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (data) {
          override_form_dirty = false;
          show_toast('人工覆寫已保存', false);
          summary_data = data.summary;
          render_overview(summary_data);
          fill_filter_options(summary_data);
          return select_track(track.spotify_id);
        })
        .then(function () {
          return run_search();
        })
        .catch(show_error);
    });
    btn_clear.addEventListener('click', function () {
      fetch_json('/api/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotify_id: track.spotify_id, clear: true }),
      })
        .then(function (data) {
          override_form_dirty = false;
          show_toast('已清除此曲覆寫', false);
          summary_data = data.summary;
          render_overview(summary_data);
          fill_filter_options(summary_data);
          return select_track(track.spotify_id);
        })
        .then(function () {
          return run_search();
        })
        .catch(show_error);
    });
  }

  function split_csv(text) {
    if (!text) {
      return [];
    }
    var parts = text.split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/^\s+|\s+$/g, '');
      if (p) {
        out.push(p);
      }
    }
    return out;
  }

  function build_main_genre_options(selected) {
    var html = '<option value="unknown">未確認</option>';
    if (!genre_taxonomy || !genre_taxonomy.main_genres) {
      return html;
    }
    for (var i = 0; i < genre_taxonomy.main_genres.length; i += 1) {
      var mg = genre_taxonomy.main_genres[i];
      html +=
        '<option value="' +
        escape_html(mg.code) +
        '"' +
        (selected === mg.code ? ' selected' : '') +
        '>' +
        escape_html(mg.label_zh) +
        '</option>';
    }
    return html;
  }

  function join_values(arr) {
    if (!arr || !arr.length) {
      return '';
    }
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      out.push(arr[i].value);
    }
    return out.join(', ');
  }

  function format_ai_candidate(cand) {
    var html = '<div class="ai_candidate_block">';
    if (cand.language) {
      html += format_ai_field('語言', 'language', cand.language, null);
    }
    html += format_ai_field('曲風', 'genre', null, cand.genres);
    html += format_ai_field('情境', 'context', null, cand.moods || cand.contexts);
    html += format_ai_field('特殊類型', 'special_type', null, cand.special_types);
    html += '</div>';
    return html;
  }

  function format_ai_field(label, dimension, single, list) {
    var html = '<div class="ai_field">';
    html += '<p class="ai_field_label">' + escape_html(label) + '</p>';
    if (single) {
      html += format_ai_tag_chip(single, dimension);
      if (single.evidence) {
        html += '<p class="tag_evidence">' + escape_html(display_freeform(single.evidence)) + '</p>';
      }
    } else {
      html += format_ai_tag_list_html(list, dimension);
    }
    html += '</div>';
    return html;
  }

  function format_ai_tag_list_html(arr, dimension) {
    if (!arr || !arr.length) {
      return '<p class="muted">（無建議）</p>';
    }
    var html = '<ul class="ai_tag_chips">';
    for (var i = 0; i < arr.length; i += 1) {
      html += '<li>' + format_ai_tag_chip(arr[i], dimension);
      if (arr[i].evidence) {
        html += '<p class="tag_evidence">' + escape_html(display_freeform(arr[i].evidence)) + '</p>';
      }
      html += '</li>';
    }
    html += '</ul>';
    return html;
  }

  function format_ai_tag_chip(tag, dimension) {
    var val = L.format_classification_value(dimension, tag.value);
    var conf = L.format_confidence_label(tag.confidence, {});
    return (
      '<span class="tag_chip"><span class="tag_chip_value">' +
      escape_html(val) +
      '</span> <span class="tag_chip_conf">' +
      escape_html(conf) +
      '</span></span>'
    );
  }

  function post_ai_review(track_id, action, patch) {
    var body = {
      spotify_id: track_id,
      action: action,
      candidate_version: ai_candidate_version,
      test_batch_id: ai_test_batch,
    };
    if (patch) {
      body.language = patch.language;
      body.genres = patch.genres;
      body.contexts = patch.contexts;
      body.genre_profile = patch.genre_profile;
    }
    return fetch_json('/api/ai/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function () {
        ai_form_dirty = false;
        show_toast('審核狀態已更新', false);
        return load_ai_review();
      })
      .then(function () {
        return select_track(track_id);
      })
      .then(function () {
        if (summary_data && action.indexOf('accept') === 0) {
          return fetch_json('/api/status').then(function (d) {
            summary_data = d.summary;
            render_overview(summary_data);
          });
        }
      })
      .catch(show_error);
  }

  function set_list_mode(mode) {
    if (mode === list_mode || !confirm_leave_if_dirty()) {
      return;
    }
    page_by_mode[list_mode] = current_page;
    list_mode = mode;
    current_page = page_by_mode[mode] || 1;
    document.getElementById('tab_all').className =
      'list_tab' + (mode === 'all' ? ' list_tab_active' : '');
    document.getElementById('tab_ai').className =
      'list_tab' + (mode === 'ai' ? ' list_tab_active' : '');
    var tab_q = document.getElementById('tab_quality');
    if (tab_q) {
      tab_q.className =
        'list_tab' + (mode === 'quality' ? ' list_tab_active' : '');
      tab_q.setAttribute(
        'aria-selected',
        mode === 'quality' ? 'true' : 'false'
      );
    }
    document.getElementById('tab_all').setAttribute(
      'aria-selected',
      mode === 'all' ? 'true' : 'false'
    );
    document.getElementById('tab_ai').setAttribute(
      'aria-selected',
      mode === 'ai' ? 'true' : 'false'
    );
    toggle_quality_mode_ui(mode === 'quality');
    if (mode === 'quality') {
      load_quality_audit_tracks()
        .then(function () {
          locate_selected_in_client_list(quality_audit_items);
        })
        .catch(show_error);
      return;
    }
    if (mode === 'all') {
      run_search(false, selected_track_id).catch(show_error);
      return;
    }
    if (!locate_selected_in_client_list(get_ai_pending_items())) {
      render_current_list();
    }
  }

  document.getElementById('btn_search').addEventListener('click', function () {
    if (confirm_leave_if_dirty()) {
      run_search(true).catch(show_error);
    }
  });
  document.getElementById('btn_rebuild').addEventListener('click', function () {
    fetch_json('/api/rebuild', { method: 'POST' })
      .then(function (data) {
        show_toast('分類索引已重新整理', false);
        summary_data = data.summary;
        render_overview(summary_data);
        fill_filter_options(summary_data);
        return run_search();
      })
      .catch(show_error);
  });
  document.getElementById('tab_all').addEventListener('click', function () {
    set_list_mode('all');
  });
  document.getElementById('tab_ai').addEventListener('click', function () {
    set_list_mode('ai');
  });
  var tab_quality = document.getElementById('tab_quality');
  if (tab_quality) {
    tab_quality.addEventListener('click', function () {
      set_list_mode('quality');
    });
  }
  var btn_qf = document.getElementById('btn_quality_apply_filter');
  if (btn_qf) {
    btn_qf.addEventListener('click', function () {
      if (confirm_leave_if_dirty()) {
        page_by_mode.quality = 1;
        current_page = 1;
        load_quality_audit_tracks().catch(show_error);
      }
    });
  }
  if (el_pagination) {
    el_pagination.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button[data-page]');
      if (btn && !btn.disabled) change_page(parseInt(btn.getAttribute('data-page'), 10));
    });
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        var next_radius = el_pagination.clientWidth >= 520 ? 2 : 1;
        if (!el_pagination.hidden && next_radius !== pagination_radius) {
          render_pagination();
        }
      }).observe(el_pagination);
    }
  }
  document.getElementById('btn_back_list').addEventListener('click', function () {
    el_workspace.classList.remove('workspace_show_detail');
  });

  var el_batch_all = document.getElementById('batch_select_all');
  if (el_batch_all) {
    el_batch_all.addEventListener('change', function () {
      var items = current_ai_list_items();
      if (this.checked) {
        for (var i = 0; i < items.length; i += 1) {
          ai_selected_ids[items[i].spotify_id] = true;
        }
      } else {
        ai_selected_ids = {};
      }
      render_current_list();
    });
  }
  var btn_ba = document.getElementById('btn_batch_accept');
  if (btn_ba) {
    btn_ba.addEventListener('click', function () {
      run_batch_review('accept');
    });
  }
  var btn_br = document.getElementById('btn_batch_reject');
  if (btn_br) {
    btn_br.addEventListener('click', function () {
      run_batch_review('reject');
    });
  }
  var btn_bp = document.getElementById('btn_batch_pending');
  if (btn_bp) {
    btn_bp.addEventListener('click', function () {
      run_batch_review('pending');
    });
  }
  var el_preview_mode = document.getElementById('preview_mode');
  if (el_preview_mode) {
    el_preview_mode.addEventListener('change', function () {
      save_preview_mode(this.value).catch(show_error);
    });
  }
  var btn_pp = document.getElementById('btn_preview_playlist');
  if (btn_pp) {
    btn_pp.addEventListener('click', function () {
      run_playlist_preview().catch(show_error);
    });
  }
  var el_ai_batch = document.getElementById('ai_test_batch');
  if (el_ai_batch) {
    el_ai_batch.addEventListener('change', function () {
      if (!confirm_leave_if_dirty()) {
        this.value = ai_test_batch;
        return;
      }
      ai_test_batch = this.value;
      page_by_mode.ai = 1;
      if (list_mode === 'ai') {
        current_page = 1;
      }
      ai_selected_ids = {};
      fetch_json('/api/preview/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_test_batch: ai_test_batch }),
      })
        .then(function () {
          return load_ai_review();
        })
        .catch(show_error);
    });
  }

  load_csrf_token()
    .catch(function (err) {
      show_error(err);
    })
    .then(function () {
      return load_taxonomy();
    })
    .catch(function () {
      return null;
    })
    .then(function () {
      return load_g3_c1_summary().then(function () {
        return load_status();
      });
    })
    .then(function () {
      return load_external_verify_hint();
    })
    .then(function () {
      return load_preview_settings();
    })
    .then(function () {
      return run_search();
    })
    .then(function () {
      return load_ai_review();
    })
    .catch(show_error);
})();
