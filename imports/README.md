# 追蹤歌單手動匯入（離線）

Spotify API 無法讀取「追蹤的他人歌單」曲目時，可從 **Spotify 桌面版** 複製歌曲連結，匯入本專案。

## 操作步驟

1. 先執行過 `npm run backup`，確保 `backup/playlists.json` 已有歌單列表。
2. 在 Spotify **桌面版** 開啟要匯入的歌單。
3. 在歌曲列表中 **全選**（例如 Ctrl+A），再 **複製**（Ctrl+C）。
4. 在本資料夾建立文字檔，檔名使用 **Playlist ID**（對照 `backup/playlists.json` 的 `id` 欄位），例如：
   - `7HkWTTWk9BMxEMufDtJKcz.txt`
5. 貼上複製內容並儲存。格式為 **一行一個歌曲網址**。
6. 在專案根目錄執行 CLI：

```bash
npm run import
```

或使用本機 Web 介面（可分批貼上、預覽、人工確認曲數）：

```bash
npm run import:ui
```

瀏覽器開啟：http://127.0.0.1:8890

## 支援的網址格式

- `https://open.spotify.com/track/xxxxxxxx`
- 含 `?si=...` 等查詢參數的 open.spotify.com 歌曲網址
- `spotify:track:xxxxxxxx`

空白行會略過。不合法行會記錄在匯入摘要（含行號），不會靜默忽略。

## 輸出位置

- `backup/imported/` — 僅手動匯入結果（不覆蓋 API 備份）
- `backup/merged/` — 與 API 備份合併後的資料，供後續智慧分類使用

## 注意

- 不需重新 OAuth，不會修改 Spotify 線上任何資料。
- 檔名請用 Playlist ID，不要只用歌單名稱，以免對錯歌單。
