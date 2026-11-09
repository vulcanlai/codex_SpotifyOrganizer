/**
 * 正式規則／基準／操作紀錄與讀回快取分離。確認前只寫 readback。
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../atomic_json.js';
import {
  DEFAULT_MANAGED_PATHS,
  MANAGED_PLAYLIST_BASELINE_SCHEMA,
  MANAGED_PLAYLIST_OPS_SCHEMA,
  MANAGED_PLAYLIST_RULES_SCHEMA,
  managed_playlist_paths,
} from './constants.js';

export function resolve_paths(options) {
  if (options && options.paths) {
    return options.paths;
  }
  if (options && options.root) {
    return managed_playlist_paths(options.root);
  }
  return DEFAULT_MANAGED_PATHS;
}

export function empty_rules(account_id) {
  return {
    schema_version: MANAGED_PLAYLIST_RULES_SCHEMA,
    account_id: account_id || null,
    updated_at: null,
    operation_generation: 0,
    playlists: {},
    additional_track_index_by_id: {},
    additional_tracks_user_id: account_id || null,
    exclusion_conflicts: [],
  };
}

export function empty_baseline(account_id) {
  return {
    schema_version: MANAGED_PLAYLIST_BASELINE_SCHEMA,
    account_id: account_id || null,
    captured_at: null,
    playlists: {},
  };
}

export function empty_operations() {
  return {
    schema_version: MANAGED_PLAYLIST_OPS_SCHEMA,
    entries: [],
  };
}

function read_json_or(file_path, fallback) {
  if (!fs.existsSync(file_path)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(file_path, 'utf8'));
}

export function load_rules(options) {
  const paths = resolve_paths(options);
  const doc = read_json_or(paths.rules, empty_rules());
  if (doc.schema_version !== MANAGED_PLAYLIST_RULES_SCHEMA) {
    throw new Error('managed-playlist-rules schema 不符');
  }
  if (!doc.playlists) {
    doc.playlists = {};
  }
  if (!doc.additional_track_index_by_id) {
    doc.additional_track_index_by_id = {};
  }
  if (!Array.isArray(doc.exclusion_conflicts)) {
    doc.exclusion_conflicts = [];
  }
  return doc;
}

export function load_baseline(options) {
  const paths = resolve_paths(options);
  const doc = read_json_or(paths.baseline, empty_baseline());
  if (doc.schema_version !== MANAGED_PLAYLIST_BASELINE_SCHEMA) {
    throw new Error('managed-playlist-baseline schema 不符');
  }
  if (!doc.playlists) {
    doc.playlists = {};
  }
  return doc;
}

export function load_operations(options) {
  const paths = resolve_paths(options);
  const doc = read_json_or(paths.operations, empty_operations());
  if (doc.schema_version !== MANAGED_PLAYLIST_OPS_SCHEMA) {
    throw new Error('managed-playlist-operations schema 不符');
  }
  if (!Array.isArray(doc.entries)) {
    doc.entries = [];
  }
  return doc;
}

export function ensure_readback_dirs(paths) {
  fs.mkdirSync(paths.readback_dir, { recursive: true });
  fs.mkdirSync(paths.plans_dir, { recursive: true });
  fs.mkdirSync(paths.reports_dir, { recursive: true });
  fs.mkdirSync(paths.cache_dir, { recursive: true });
  fs.mkdirSync(paths.cache_items_dir, { recursive: true });
}

export function save_readback_json(file_path, data) {
  write_json_atomic(file_path, data);
}

export function load_latest_plan(options) {
  const paths = resolve_paths(options);
  if (!fs.existsSync(paths.latest_plan)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(paths.latest_plan, 'utf8'));
}

export function load_plan_by_hash(plan_hash, options) {
  const paths = resolve_paths(options);
  const file_path = path.join(paths.plans_dir, plan_hash + '.json');
  if (!fs.existsSync(file_path)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file_path, 'utf8'));
}

export function load_checkpoint(options) {
  const paths = resolve_paths(options);
  if (!fs.existsSync(paths.checkpoint)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(paths.checkpoint, 'utf8'));
}
