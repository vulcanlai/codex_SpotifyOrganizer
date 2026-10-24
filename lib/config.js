/**
 * 讀取 .env 與 OAuth 固定設定
 * Node 20 無內建 dotenv，在此以 fs 手動解析，避免額外套件
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const project_root = path.resolve(__dirname, '..');

/** Spotify OAuth 授權端點與 API 根網址 */
export const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

/** 本機 callback 必須與 Dashboard 設定完全一致 */
export const REDIRECT_HOST = '127.0.0.1';
export const REDIRECT_PORT = 8888;
export const REDIRECT_URI = `http://${REDIRECT_HOST}:${REDIRECT_PORT}/callback`;

/** OAuth scope（含 MVP 私人智慧歌單寫入；變更後須重新授權） */
export const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'user-library-read',
  'user-follow-read',
].join(' ');

/** Token 存檔路徑（已在 .gitignore 排除） */
export const TOKEN_FILE = path.join(project_root, '.spotify_tokens.json');

/**
 * 從專案根目錄載入 .env（KEY=VALUE，忽略 # 註解與空行）
 * @returns {Record<string, string>}
 */
function load_env_file() {
  const env_path = path.join(project_root, '.env');
  const result = {};

  if (!fs.existsSync(env_path)) {
    return result;
  }

  const raw = fs.readFileSync(env_path, 'utf8');
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

const env = load_env_file();

/**
 * 取得 Spotify Client ID；缺少時拋出可讀錯誤
 */
export function get_client_id() {
  const id = env.SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID;
  if (!id || id === 'your_client_id_here') {
    throw new Error(
      '未設定 SPOTIFY_CLIENT_ID。請複製 .env.example 為 .env 並填入 Client ID。'
    );
  }
  return id;
}

export { project_root };
