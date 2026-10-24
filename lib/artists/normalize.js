/**
 * 追蹤藝人 API 列正規化（不捏造 followed_at）
 */

/**
 * @param {unknown} artist - GET /me/following artists.items[]
 * @param {number} list_index
 */
export function normalize_followed_artist(artist, list_index) {
  const a = artist && typeof artist === 'object' ? artist : {};
  const followers =
    a.followers && typeof a.followers === 'object' ? a.followers : null;

  return {
    artist_id: typeof a.id === 'string' ? a.id : null,
    name: typeof a.name === 'string' ? a.name : null,
    uri: typeof a.uri === 'string' ? a.uri : null,
    popularity: typeof a.popularity === 'number' ? a.popularity : null,
    genres: Array.isArray(a.genres) ? a.genres.slice() : [],
    followers_total:
      followers && typeof followers.total === 'number'
        ? followers.total
        : null,
    images_count: Array.isArray(a.images) ? a.images.length : 0,
    source: 'followed_artist',
    list_index: typeof list_index === 'number' ? list_index : null,
  };
}

/**
 * 依 artist_id 去重（保留第一次出現），無 id 列全部保留
 * @param {object[]} rows
 */
export function dedupe_followed_artists(rows) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const id = row && row.artist_id;
    if (id) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
    }
    out.push(row);
  }
  return out;
}
