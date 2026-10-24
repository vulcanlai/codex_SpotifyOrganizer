/**
 * 舊版中文曲風標籤 → 新版主曲風代碼（可重複、可追溯）
 */
import { GENRE_PRIMARY_UNKNOWN } from './genre_taxonomy.js';

/** @type {Record<string, { primary: string, auto: boolean, note: string }>} */
export const LEGACY_GENRE_LABEL_MAP = {
  流行: { primary: 'pop', auto: true, note: '一對一對應新版 pop' },
  搖滾: { primary: 'rock', auto: true, note: '一對一對應新版 rock' },
  電子: { primary: 'electronic', auto: true, note: '一對一對應新版 electronic' },
  民謠: { primary: 'folk', auto: true, note: '一對一對應新版 folk' },
  嘻哈: { primary: 'hip_hop', auto: true, note: '一對一對應新版 hip_hop' },
  爵士: { primary: 'jazz', auto: true, note: '一對一對應新版 jazz' },
  古典: { primary: 'classical', auto: true, note: '一對一對應新版 classical' },
  未確認: { primary: GENRE_PRIMARY_UNKNOWN, auto: true, note: '維持未確認' },
};

/** 無法自動對應，保留原標籤等待人工 */
export const LEGACY_AMBIGUOUS_LABELS = ['舞曲', '其他'];

/**
 * @param {string} label
 * @returns {{ primary: string|null, legacy_label: string, migrated: boolean, pending_manual: boolean, note: string }}
 */
export function migrate_legacy_genre_label(label) {
  const raw = String(label || '').trim();
  if (!raw) {
    return {
      primary: GENRE_PRIMARY_UNKNOWN,
      legacy_label: raw,
      migrated: true,
      pending_manual: false,
      note: '空標籤視為未確認',
    };
  }
  if (LEGACY_AMBIGUOUS_LABELS.indexOf(raw) >= 0) {
    return {
      primary: GENRE_PRIMARY_UNKNOWN,
      legacy_label: raw,
      migrated: false,
      pending_manual: true,
      note: '舊版「' + raw + '」無法自動對應新版主曲風，保留原標籤',
    };
  }
  const hit = LEGACY_GENRE_LABEL_MAP[raw];
  if (hit) {
    return {
      primary: hit.primary,
      legacy_label: raw,
      migrated: hit.auto,
      pending_manual: false,
      note: hit.note,
    };
  }
  return {
    primary: GENRE_PRIMARY_UNKNOWN,
    legacy_label: raw,
    migrated: false,
    pending_manual: true,
    note: '未知舊版曲風標籤，保留原標籤',
  };
}

/**
 * @param {string[]} legacy_labels
 */
export function migrate_legacy_genre_labels(legacy_labels) {
  const labels = legacy_labels || [];
  const secondaries = [];
  const unmigrated = [];
  let primary = GENRE_PRIMARY_UNKNOWN;
  const notes = [];

  for (let i = 0; i < labels.length; i += 1) {
    const m = migrate_legacy_genre_label(labels[i]);
    notes.push(m.note);
    if (m.pending_manual) {
      unmigrated.push(m.legacy_label);
    }
    if (m.primary === GENRE_PRIMARY_UNKNOWN) {
      continue;
    }
    if (primary === GENRE_PRIMARY_UNKNOWN) {
      primary = m.primary;
    } else if (primary !== m.primary && secondaries.indexOf(m.primary) < 0) {
      secondaries.push(m.primary);
    }
  }

  return {
    primary_genre: primary,
    secondary_genres: secondaries.slice(0, 2),
    legacy_genre_labels: labels.slice(),
    unmigrated_legacy_labels: unmigrated,
    migration_notes: notes,
  };
}
