# SpotifyOrganizer 公司電腦搬遷盤點

> 盤點日期：2026-10-25（Asia/Taipei）
> 範圍：Git 版控整理與公司電腦搬遷；不包含 Spotify API 呼叫、歌單修改、曲庫重掃或智慧分類開發。

## 目前結論

- Git 儲存庫目前位於 `main`，遠端為 `git@gitlab.com:vulcanlai/SpotifyOrganizer.git`。
- 盤點開始時本機 `main` 與 `origin/main` 都在 `439dc4c`。
- 正式 `minimal` 匯出 dry-run 收錄 **3,355 個檔案／308,066,350 bytes**，七個必要核心檔案均存在。
- `.data-sync-state/last-export.json` 最新記錄的匯出檔名為 `spotify-handoff-1151025-163916.zip`；搬遷前必須在原匯出位置或外接媒體找到並驗證實體 ZIP。
- `.env` 與 `.spotify_tokens.json` 不會進入 Git，也不會進入 minimal ZIP，必須另外安全搬遷（或在公司端重新 OAuth）。
- `backup/classification/snapshots/` 等歷史／測試資料被 minimal 明確排除；其中約 4.31 GB 的歷史快照已決定暫不搬遷，必須原樣保留在家裡，不得刪除。

## A. 可透過 GitLab 同步

以成功 Push 的目標分支為準，可由 GitLab 取得：

- 應用程式與批次程式：根目錄 `*.js`、`*.bat`、`lib/`、`scripts/`。
- 測試：`test/`。
- 設定範本：`.env.example`、`package.json`、`package-lock.json`。
- 文件：`README.md`、`PROJECT_HANDOFF.md`、`docs/`、`imports/README.md`。
- Git 已追蹤的其他必要資源。

Git 不負責同步本機資料目錄、Token、真實 `.env`、ZIP、快取或安裝後的相依套件。

## B. 必須另外安全搬遷

### 必要項目

1. `D:\SpotifyOrganizer\.env`
   - 含本機環境設定及加密 ZIP 密碼。
   - 不得提交 Git，也不要把內容貼入交接報告或聊天訊息。
2. `D:\SpotifyOrganizer\.spotify_tokens.json`
   - 含 Spotify OAuth 授權資料，不在 Git、不在 minimal ZIP。
   - 若不搬遷，公司端須重新完成 OAuth；建議以公司規範允許的加密媒體搬運。
3. 實際的加密資料 ZIP
   - 最近狀態記錄的檔名：`spotify-handoff-1151025-163916.zip`。
   - 需在原匯出目的地或外接媒體定位並以既有 dry-run 驗證。
   - ZIP 密碼資訊必須與 ZIP 分開，以安全管道保存；本文件不記錄密碼。

### 已決定留在家裡、不搬遷

下列資料不在 Git，也被 `minimal` ZIP 排除。它們不是恢復目前 G3-F 核心狀態的必要項。本次已決定不帶至公司，保留在家裡且不得刪除：

- `D:\SpotifyOrganizer\backup\classification\snapshots\`（約 4.31 GB，主要是大量歷史／測試快照）
- `D:\SpotifyOrganizer\backup\manual\`（約 63.5 MB）
- `D:\SpotifyOrganizer\backup\classification\incident-pre-restore-710\`（約 26.4 MB）
- `D:\SpotifyOrganizer\backup\classification\ai-test\`
- `D:\SpotifyOrganizer\backup\classification\g3-b*\`
- `D:\SpotifyOrganizer\backup\classification\g3-c*\`
- `D:\SpotifyOrganizer\backup\classification\g3-d*\`
- `D:\SpotifyOrganizer\backup\classification\g3-e*\`
- `D:\SpotifyOrganizer\reports\` 中 `reports/g3-f-adopt/` 以外的報告

不要把上述目錄直接加入 Git，也不要在本次搬遷整理中刪除、搬動或修改。

## 已包含在 minimal 加密 ZIP 的資料

以下依 `lib/data_sync/export_profile_minimal.js` 的實際白名單與本機 dry-run 確認：

- `backup/merged/`
- `backup/library/`
- `backup/imported/`
- `backup/enrichment/`
- `backup/playlists.json`
- `backup/playlist-tracks.json`
- `backup/liked-tracks.json`
- `backup/summary.json`
- `backup/classification/manual-overrides.json`
- `backup/classification/classification-index.json`
- `backup/classification/classification-summary.json`
- `backup/classification/classification-settings.json`
- `backup/classification/formal-classification-state.json`
- `backup/classification/g3-f-adopt-registry.json`
- `backup/classification/g3-f1-wave-100/` 至目前各個符合 `g3-fN-wave-N` 命名的波次目錄
- `backup/classification/g3-f-adopt-snapshots/`
- `backup/classification/mvp-smart-playlists/`
- `reports/g3-f-adopt/`
- `imports/*.txt`（不含 `imports/README.md`，README 由 Git 提供）
- ZIP 內的 `export-manifest.json`（含檔案大小與 SHA-256，供匯入驗證）

minimal ZIP 明確不含 `.env`、`.spotify_tokens.json`、一般 `.log`／`.bak`、分類快照、G3-B/C/D/E、AI 測試、一般報告及安裝相依套件。

## C. 公司端可重新產生，不必搬遷

- `D:\SpotifyOrganizer\node_modules\`
- `D:\SpotifyOrganizer\manual-classify-ui\node_modules\`
- `D:\SpotifyOrganizer\scripts\data-sync\aes-spike\node_modules\`
- `D:\SpotifyOrganizer\scripts\data-sync\pty-spike\node_modules\`
- `D:\SpotifyOrganizer\public\manual-classify-ui\`
- `D:\SpotifyOrganizer\.data-sync-staging\`
- `D:\SpotifyOrganizer\.data-sync-import-staging\`
- 一般 `*.log`、暫存 `*.tmp`、測試產物
- `D:\SpotifyOrganizer\backup\classification\g3-evidence\`（README 標示為可重建衍生索引；若不想重建或需保留完全相同版本，也可列入額外加密封存）

`.data-sync-state/` 不需在初次公司端匯入前手動覆蓋；成功匯入後會建立公司端的 `last-import.json`。家用電腦原有狀態檔應保留，不要刪除。

## 公司端建議恢復順序

1. 安裝 Git、Node.js 20 或以上版本，以及支援 ZIP AES-256 的 7-Zip。
2. 從 GitLab clone 專案到 `D:\SpotifyOrganizer`，切到已確認的 `main`，核對提交 Hash。
3. 執行 `npm ci`，由 `package-lock.json` 重建相依套件。
4. 從安全媒體放回 `D:\SpotifyOrganizer\.env`；不要以 `.env.example` 覆蓋真實檔。
5. 視選擇放回 `D:\SpotifyOrganizer\.spotify_tokens.json`，或之後在公司端重新 OAuth。
6. 將加密 ZIP 放在專案外或 `.data-sync-out/`；先保留原始副本，不要覆蓋。
7. 先執行唯讀預演：

   ```bat
   cd /d D:\SpotifyOrganizer
   import-data.bat --input "X:\安全媒體\spotify-handoff-1151025-163916.zip" --dry-run
   ```

8. 確認 manifest、來源 Git commit、檔案數、SHA-256、handoff chain 與衝突結果都正常後，再執行：

   ```bat
   import-data.bat --input "X:\安全媒體\spotify-handoff-1151025-163916.zip" --apply --confirm=I_UNDERSTAND_DATA_SYNC_IMPORT
   ```

9. 執行資料同步相關的低風險測試／驗證；不要立刻執行 `backup`、`enrich:*`、Spotify apply 或全曲庫重建。
10. 確認本機 UI 能讀取既有資料後，再依 `PROJECT_HANDOFF.md` 決定後續工作。

## 僅留在家裡且不納入 Git 的檔案

下列未追蹤檔案屬 GUI 選檔 A/B 測試、WzAES／PTY 隔離 POC 及追蹤啟動器。已決定全部不納入 Git、不帶至公司，只保留在家裡；不得刪除、搬動或修改：

- `D:\SpotifyOrganizer\acceptance-gui-ab-test.bat`
- `D:\SpotifyOrganizer\import-gui-ab-test.bat`
- `D:\SpotifyOrganizer\scripts\data-sync\aes-spike\`（`node_modules/` 永不提交）
- `D:\SpotifyOrganizer\scripts\data-sync\pty-spike\`（`node_modules/` 永不提交）
- `D:\SpotifyOrganizer\scripts\data-sync\run-formal-pick-no-trace.bat`
- `D:\SpotifyOrganizer\scripts\data-sync\run-formal-pick-with-trace-cscript.bat`
- `D:\SpotifyOrganizer\scripts\data-sync\run-formal-pick-with-trace.bat`

上述目錄內的 `node_modules/`、暫存檔與測試產物同樣不得提交。

## 搬遷前核對清單

- [ ] GitLab 的 `main` 已包含本次交接文件與核准納入的變更。
- [ ] 找到實際加密 ZIP，且檔名、時間與匯出狀態相符。
- [ ] 對 ZIP 執行既有 dry-run／驗證，確認可解密且 manifest 完整。
- [ ] `.env` 已透過安全管道另存，未進 Git 或 ZIP。
- [ ] 已決定搬遷 `.spotify_tokens.json` 或在公司重新 OAuth。
- [x] 約 4.31 GB 歷史快照已決定留在家裡、不搬遷且不得刪除。
- [x] 七組 GUI／spike／trace 未追蹤檔案已決定不提交、不搬遷且只留在家裡。
- [ ] 公司端首次匯入前保留 ZIP 原始副本。
