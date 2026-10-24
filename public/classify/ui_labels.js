/**
 * 同步 lib/classification/ui_labels.js + ui_display_localize.js（瀏覽器 ES5 版）
 */
(function (global) {
  var DECADE_DISPLAY = {
    '1970s': '1970 年代',
    '1980s': '1980 年代',
    '1990s': '1990 年代',
    '2000s': '2000 年代',
    '2010s': '2010 年代',
    '2020s': '2020 年代',
    其他年代: '其他年代',
    年代未知: '年代未知',
  };

  var DIMENSION_DISPLAY = {
    decade: '年代',
    language: '語言',
    genre: '曲風',
    context: '情境',
    special_type: '特殊類型',
  };

  var CONFIDENCE_DISPLAY = {
    inferred: 'AI 推測',
    unknown: '資料不足',
    confirmed: '已人工確認',
  };

  var REVIEW_STATUS_DISPLAY = {
    pending: '待審核',
    accepted: '已接受',
    rejected: '已拒絕',
    modified: '已修改',
  };

  var METADATA_STATUS_DISPLAY = {
    complete: '歌曲資訊完整',
    metadata_missing: '歌曲資訊缺失',
  };

  var TIER_DISPLAY = {
    high: '高可信度',
    medium: '中可信度',
    low: '低可信度',
  };

  var TIER_DISPLAY_SHORT = {
    high: '高',
    medium: '中',
    low: '低',
  };

  var PREVIEW_MODE_DISPLAY = {
    strict: '嚴格（僅人工確認）',
    balanced: '平衡（預設）',
    relaxed: '寬鬆（標示未確認風險）',
  };

  var PHRASE_REPLACEMENTS = [
    ['mainstream mandopop', '主流華語流行'],
    ['contemporary R&B／pop', '當代 R&B／流行'],
    ['contemporary R&B', '當代 R&B'],
    ['metadata 未完整', '歌曲基本資料未完整'],
    ['metadata', '歌曲基本資料'],
    ['待 enrich 或人工听音', '待補齊歌曲資訊或經人工聆聽確認'],
    ['待 enrich 或人工聽音', '待補齊歌曲資訊或經人工聆聽確認'],
    ['待 enrich', '待補齊歌曲資訊'],
    ['enrichment', '補齊歌曲資訊'],
    ['enrich', '補齊歌曲資訊'],
    ['mandopop', '華語流行'],
    ['主曲風保留 unknown', '主曲風尚缺可靠依據'],
  ];

  function format_decade_value(decade_code) {
    if (!decade_code) {
      return '';
    }
    if (Object.prototype.hasOwnProperty.call(DECADE_DISPLAY, decade_code)) {
      return DECADE_DISPLAY[decade_code];
    }
    return decade_code;
  }

  function format_dimension_label(dimension) {
    if (!dimension) {
      return '';
    }
    if (Object.prototype.hasOwnProperty.call(DIMENSION_DISPLAY, dimension)) {
      return DIMENSION_DISPLAY[dimension];
    }
    return dimension;
  }

  function format_classification_value(dimension, value) {
    if (value == null || value === '') {
      return '';
    }
    if (dimension === 'decade') {
      return format_decade_value(value);
    }
    return value;
  }

  function format_confidence_label(confidence, opts) {
    var options = opts || {};
    if (options.is_manual_override) {
      return '人工確認';
    }
    if (!confidence) {
      return '';
    }
    if (Object.prototype.hasOwnProperty.call(CONFIDENCE_DISPLAY, confidence)) {
      return CONFIDENCE_DISPLAY[confidence];
    }
    return confidence;
  }

  function format_review_status_label(status, opts) {
    var options = opts || {};
    if (
      (options.label === 'v2_pending' || options.candidate_version === 2) &&
      status === 'pending'
    ) {
      return '新版待審核';
    }
    if (!status) {
      return REVIEW_STATUS_DISPLAY.pending;
    }
    if (Object.prototype.hasOwnProperty.call(REVIEW_STATUS_DISPLAY, status)) {
      return REVIEW_STATUS_DISPLAY[status];
    }
    return status;
  }

  function format_metadata_status_label(status) {
    if (!status) {
      return METADATA_STATUS_DISPLAY.metadata_missing;
    }
    if (Object.prototype.hasOwnProperty.call(METADATA_STATUS_DISPLAY, status)) {
      return METADATA_STATUS_DISPLAY[status];
    }
    return status;
  }

  function format_confidence_tier(tier, opts) {
    var options = opts || {};
    var map = options.short ? TIER_DISPLAY_SHORT : TIER_DISPLAY;
    if (!tier) {
      return '';
    }
    if (Object.prototype.hasOwnProperty.call(map, tier)) {
      return map[tier];
    }
    return tier;
  }

  function format_preview_mode(mode) {
    if (!mode) {
      return '';
    }
    if (Object.prototype.hasOwnProperty.call(PREVIEW_MODE_DISPLAY, mode)) {
      return PREVIEW_MODE_DISPLAY[mode];
    }
    return mode;
  }

  function escape_regexp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function localize_freeform_text(text, taxonomy) {
    if (text == null || text === '') {
      return '';
    }
    var out = String(text);
    var p;
    for (p = 0; p < PHRASE_REPLACEMENTS.length; p += 1) {
      out = out.split(PHRASE_REPLACEMENTS[p][0]).join(PHRASE_REPLACEMENTS[p][1]);
    }
    if (taxonomy && taxonomy.subgenres) {
      var sub_keys = Object.keys(taxonomy.subgenres);
      sub_keys.sort(function (a, b) {
        return b.length - a.length;
      });
      var si;
      for (si = 0; si < sub_keys.length; si += 1) {
        var sc = sub_keys[si];
        var sl = taxonomy.subgenres[sc].label_zh;
        if (sl && sl !== sc) {
          out = out.split(sc).join(sl);
        }
      }
    }
    if (taxonomy && taxonomy.main_genres) {
      var main_codes = [];
      for (var mi = 0; mi < taxonomy.main_genres.length; mi += 1) {
        main_codes.push(taxonomy.main_genres[mi].code);
      }
      main_codes.sort(function (a, b) {
        return b.length - a.length;
      });
      for (var mj = 0; mj < main_codes.length; mj += 1) {
        var mc = main_codes[mj];
        var ml = '';
        for (var mk = 0; mk < taxonomy.main_genres.length; mk += 1) {
          if (taxonomy.main_genres[mk].code === mc) {
            ml = taxonomy.main_genres[mk].label_zh;
            break;
          }
        }
        if (ml) {
          var re = new RegExp('\\b' + escape_regexp(mc) + '\\b', 'g');
          out = out.replace(re, ml);
        }
      }
    }
    out = out.replace(/\bunknown\b/gi, '未確認');
    out = out.replace(/\binferred\b/gi, 'AI 推測');
    out = out.replace(/\bmetadata\b/gi, '歌曲基本資料');
    return out;
  }

  function dedupe_display_artists(artists) {
    if (!artists || !artists.length) {
      return [];
    }
    var out = [];
    var seen = {};
    for (var i = 0; i < artists.length; i += 1) {
      var raw = artists[i];
      var name = raw == null ? '' : String(raw).replace(/^\s+|\s+$/g, '');
      if (!name) {
        continue;
      }
      var key = name.toLowerCase();
      if (seen[key]) {
        continue;
      }
      seen[key] = true;
      out.push(name);
    }
    return out;
  }

  function format_artists_display(artists, separator) {
    var sep = separator || '、';
    return dedupe_display_artists(artists).join(sep);
  }

  function format_filter_option_text(dimension, code, count) {
    var label = format_classification_value(dimension, code);
    if (count == null) {
      return label;
    }
    return label + ' (' + count + ')';
  }

  function format_tag_line(tag, dimension) {
    var dim = format_dimension_label(dimension || tag.dimension);
    var val = format_classification_value(tag.dimension || dimension, tag.value);
    var conf = format_confidence_label(tag.confidence, {
      is_manual_override: tag.is_manual_override,
    });
    return dim + '：' + val + '（' + conf + '）';
  }

  global.ClassifyUiLabels = {
    format_decade_value: format_decade_value,
    format_dimension_label: format_dimension_label,
    format_classification_value: format_classification_value,
    format_confidence_label: format_confidence_label,
    format_review_status_label: format_review_status_label,
    format_metadata_status_label: format_metadata_status_label,
    format_confidence_tier: format_confidence_tier,
    format_preview_mode: format_preview_mode,
    localize_freeform_text: localize_freeform_text,
    dedupe_display_artists: dedupe_display_artists,
    format_artists_display: format_artists_display,
    format_filter_option_text: format_filter_option_text,
    format_tag_line: format_tag_line,
  };
})(typeof window !== 'undefined' ? window : this);
