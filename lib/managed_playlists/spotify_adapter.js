/**
 * 讀回只用既有 GET 封裝；不記錄 token、不寫 Spotify。
 */
import { spotify_get, SpotifyRequestError } from '../spotify_api.js';

export function create_spotify_get_json(options) {
  const api_opts = {
    max_rate_retries: typeof options?.max_rate_retries === 'number' ? options.max_rate_retries : 3,
    max_retry_after_sec:
      typeof options?.max_retry_after_sec === 'number' ? options.max_retry_after_sec : 120,
    skip_global_rate_limit_check: true,
    skip_global_rate_limit_persist: true,
    rate_limit_source: 'managed_playlist_readback',
  };
  return async function get_json(path_or_url) {
    try {
      return await spotify_get(path_or_url, api_opts);
    } catch (err) {
      if (err instanceof SpotifyRequestError) {
        throw err;
      }
      const wrapped = new Error(err && err.message ? err.message : String(err));
      wrapped.status = 0;
      wrapped.name = 'TypeError';
      throw wrapped;
    }
  };
}
