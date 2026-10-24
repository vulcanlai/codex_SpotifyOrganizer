/**
 * G3-B AI 草稿匯入前驗證（不放寬安全規則）
 */
import fs from 'node:fs';
import { SUBGENRES_BY_CODE, is_main_genre_code } from '../genre_taxonomy.js';
import {
  LANGUAGE_VALUES,
  AI_CANDIDATE_CONFIDENCE_VALUES,
  CONFIDENCE_CONFIRMED,
} from '../dimensions.js';
import { VOCAL_VERIFICATION_UNVERIFIED } from './language_evidence.js';
import { validate_genre_profile_draft } from './rule_classify.js';
import { FILE_G3_B_AI_PENDING } from './paths.js';
import { FILE_G3_B3_STILL_NEEDS_GEN } from './paths_b3.js';
import { G3BImportError } from './import_ai_draft.js';

function read_pending_ids() {
  if (fs.existsSync(FILE_G3_B3_STILL_NEEDS_GEN)) {
    const doc = JSON.parse(fs.readFileSync(FILE_G3_B3_STILL_NEEDS_GEN, 'utf8'));
    const list = doc.pending || [];
    if (list.length) {
      return list.map(function (p) {
        return p.track_id;
      });
    }
  }
  if (!fs.existsSync(FILE_G3_B_AI_PENDING)) {
    throw new G3BImportError('缺少 ai-pending-tracks.json');
  }
  const doc = JSON.parse(fs.readFileSync(FILE_G3_B_AI_PENDING, 'utf8'));
  const list = doc.pending || [];
  return list.map(function (p) {
    return p.track_id;
  });
}

/**
 * @param {object} doc
 * @param {{ allowed_track_ids?: string[], evidence_by_id?: Record<string, object> }} [ctx]
 */
export function validate_g3_b_ai_draft(doc, ctx) {
  const options = ctx || {};
  const errors = [];
  if (!doc || !Array.isArray(doc.tracks)) {
    throw new G3BImportError('AI 草稿缺少 tracks 陣列');
  }

  const allowed =
    options.allowed_track_ids && options.allowed_track_ids.length
      ? options.allowed_track_ids.slice()
      : read_pending_ids();
  const allowed_set = {};
  for (let a = 0; a < allowed.length; a += 1) {
    allowed_set[allowed[a]] = true;
  }

  const seen = {};
  for (let i = 0; i < doc.tracks.length; i += 1) {
    const row = doc.tracks[i];
    const prefix = 'tracks[' + i + ']';
    if (!row.track_id || typeof row.track_id !== 'string') {
      errors.push(prefix + ' 缺少 track_id');
      continue;
    }
    if (seen[row.track_id]) {
      errors.push('重複 track_id：' + row.track_id);
    }
    seen[row.track_id] = true;

    if (!allowed_set[row.track_id]) {
      errors.push('非待 AI 清單曲目：' + row.track_id);
    }

    if (row.human_locked === true) {
      continue;
    }

    const ev = options.evidence_by_id ? options.evidence_by_id[row.track_id] : null;
    if (ev && ev.human_confirmation && ev.human_confirmation.locked) {
      errors.push('不得覆寫人工鎖定：' + row.track_id);
    }

    if (row.confidence === 'confirmed') {
      errors.push('不得使用 confirmed：' + row.track_id);
    }
    if (
      row.confidence &&
      AI_CANDIDATE_CONFIDENCE_VALUES.indexOf(row.confidence) < 0
    ) {
      errors.push('非法 confidence：' + row.track_id);
    }

    if (row.genre_profile) {
      if (!validate_genre_profile_draft(row.genre_profile)) {
        errors.push('非法主曲風：' + row.track_id);
      }
      const subs = row.genre_profile.subgenres || [];
      const primary = row.genre_profile.primary_genre;
      for (let s = 0; s < subs.length; s += 1) {
        const code = subs[s];
        if (!SUBGENRES_BY_CODE[code]) {
          errors.push(row.track_id + ' 非法子曲風：' + code);
        } else if (primary !== 'unknown' && SUBGENRES_BY_CODE[code].main !== primary) {
          errors.push(row.track_id + ' 子曲風與主曲風不符：' + code);
        }
      }
      if (
        row.genre_profile.confidence === 'confirmed' ||
        row.genre_profile.confidence === undefined
      ) {
        /* genre confidence optional; if present must be inferred/unknown */
      }
      if (
        row.genre_profile.confidence &&
        AI_CANDIDATE_CONFIDENCE_VALUES.indexOf(row.genre_profile.confidence) < 0
      ) {
        errors.push(row.track_id + ' genre_profile.confidence 非法');
      }
    }

    if (row.language) {
      const val = row.language.value;
      if (val && LANGUAGE_VALUES.indexOf(val) < 0) {
        errors.push(row.track_id + ' 非法語言：' + val);
      }
      if (
        row.language.confidence &&
        AI_CANDIDATE_CONFIDENCE_VALUES.indexOf(row.language.confidence) < 0
      ) {
        errors.push(row.track_id + ' language.confidence 非法');
      }
      if (row.language.confidence === CONFIDENCE_CONFIRMED) {
        errors.push(row.track_id + ' 語言不得 confirmed');
      }
      const ev_text = row.language.evidence || '';
      if (/musicbrainz|MB 查證.*語言/i.test(ev_text)) {
        errors.push(row.track_id + ' 不得宣稱 MB 提供演唱語言');
      }
      if (val && val !== '未確認' && !row.language.vocal_verification_status) {
        errors.push(
          row.track_id + ' 語言需 vocal_verification_status（通常 unverified）'
        );
      }
      if (
        val &&
        val !== '未確認' &&
        row.language.vocal_verification_status === VOCAL_VERIFICATION_UNVERIFIED &&
        row.language.confidence === 'inferred' &&
        !ev_text
      ) {
        errors.push(row.track_id + ' 推論語言需簡述 evidence（非歌名即可）');
      }
    }

    if (row.secondary_genres) {
      for (let g = 0; g < row.secondary_genres.length; g += 1) {
        if (!is_main_genre_code(row.secondary_genres[g])) {
          errors.push(row.track_id + ' 非法 secondary_genre');
        }
      }
    }
  }

  if (errors.length) {
    throw new G3BImportError(errors.join('\n'));
  }
  return { allowed_count: allowed.length, imported_count: doc.tracks.length };
}
