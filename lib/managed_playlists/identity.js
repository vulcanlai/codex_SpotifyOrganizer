/**
 * 以 Spotify playlist ID 為身分；名稱僅用來判斷是否納管（去前置空白後以 🎵 開頭）。
 */
import {
  MANAGED_PLAYLIST_PREFIX,
  PLAYLIST_STATUS_DELETED,
  PLAYLIST_STATUS_PERMISSION,
  PLAYLIST_STATUS_PREFIX_REMOVED,
  PLAYLIST_STATUS_UNFOLLOWED,
  PLAYLIST_STATUS_UNREADABLE,
} from './constants.js';

export function is_managed_playlist_name(name) {
  if (typeof name !== 'string') {
    return false;
  }
  return name.replace(/^\s+/, '').indexOf(MANAGED_PLAYLIST_PREFIX) === 0;
}

export function is_spotify_id(id) {
  return typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id);
}

export function track_id_from_uri(uri) {
  if (typeof uri !== 'string') {
    return null;
  }
  const prefix = 'spotify:track:';
  if (uri.indexOf(prefix) !== 0) {
    return null;
  }
  const id = uri.slice(prefix.length);
  return is_spotify_id(id) ? id : null;
}

export function track_uri_from_id(id) {
  return is_spotify_id(id) ? 'spotify:track:' + id : null;
}

/**
 * 權限與可見性不可互相推定。
 * @param {object} params
 */
export function classify_playlist_capability(params) {
  const p = params || {};
  const listed = p.listed_in_me === true;
  const http_status = p.http_status;
  const owner_id = p.owner_id || null;
  const me_id = p.me_id || null;
  const collaborative = p.collaborative === true;
  const name = p.name;

  if (http_status === 404) {
    return { status: 'deleted_pending', can_edit: false, reason: 'http_404' };
  }
  if (http_status === 403) {
    return { status: 'permission_changed_pending', can_edit: false, reason: 'http_403' };
  }
  if (http_status && http_status >= 400) {
    return { status: 'unreadable_pending', can_edit: false, reason: 'http_' + http_status };
  }
  if (!listed && p.direct_ok === true) {
    return { status: 'unfollowed_pending', can_edit: false, reason: 'not_in_me_playlists' };
  }
  if (typeof name === 'string' && !is_managed_playlist_name(name)) {
    return {
      status: 'prefix_removed_pending',
      can_edit: owner_id && me_id && owner_id === me_id,
      reason: 'prefix_removed',
    };
  }
  if (owner_id && me_id && owner_id !== me_id) {
    return {
      status: 'readonly_foreign',
      can_edit: false,
      reason: collaborative ? 'foreign_collaborative_readonly' : 'foreign_followed_readonly',
    };
  }
  return {
    status: 'active',
    can_edit: !!(owner_id && me_id && owner_id === me_id),
    reason: 'owned_or_unknown_owner',
  };
}

/**
 * HTTP 404／權限異常是待確認，不是已證明刪除，也不得當同步寫入目標。
 */
export function is_pending_absence_status(status) {
  return (
    status === PLAYLIST_STATUS_DELETED ||
    status === PLAYLIST_STATUS_UNFOLLOWED ||
    status === PLAYLIST_STATUS_UNREADABLE ||
    status === PLAYLIST_STATUS_PERMISSION ||
    status === PLAYLIST_STATUS_PREFIX_REMOVED
  );
}

export function is_sync_writable_status(status) {
  return !status || status === 'active';
}
