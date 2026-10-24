/**
 * MVP 智慧歌單同步所需 OAuth scope
 */
import { get_missing_scopes, has_all_scopes } from './scopes.js';

export const MVP_SPOTIFY_SYNC_SCOPES = [
  'playlist-read-private',
  'playlist-modify-private',
];

/**
 * @returns {string[]}
 */
export function get_mvp_sync_missing_scopes() {
  return get_missing_scopes(MVP_SPOTIFY_SYNC_SCOPES);
}

export function has_mvp_sync_scopes() {
  return has_all_scopes(MVP_SPOTIFY_SYNC_SCOPES);
}

export function mvp_reauth_hint_zh() {
  return (
    '目前 token 缺少 playlist-modify-private 等 scope。請執行 npm start 完成 OAuth（config 已含新 scope），' +
    '或刪除 .spotify_tokens.json 後重新授權。'
  );
}
