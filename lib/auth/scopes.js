/**
 * OAuth scope 檢查（不輸出 token）
 */
import { load_tokens } from '../token_store.js';
import { SCOPES } from '../config.js';

/**
 * @param {string} scope_string
 * @returns {string[]}
 */
export function parse_scope_string(scope_string) {
  if (!scope_string || typeof scope_string !== 'string') {
    return [];
  }
  return scope_string.split(/\s+/).filter(Boolean);
}

/**
 * @param {string[]} required
 * @returns {string[]}
 */
export function get_missing_scopes(required) {
  const tokens = load_tokens();
  const granted = tokens ? parse_scope_string(tokens.scope) : [];
  const missing = [];
  for (let i = 0; i < required.length; i += 1) {
    if (granted.indexOf(required[i]) < 0) {
      missing.push(required[i]);
    }
  }
  return missing;
}

/**
 * @param {string[]} required
 */
export function has_all_scopes(required) {
  return get_missing_scopes(required).length === 0;
}

/** 應用程式設定的完整 scope 列表 */
export function configured_scopes() {
  return parse_scope_string(SCOPES);
}
