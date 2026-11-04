# SpotifyOrganizer

SpotifyOrganizer 是本機執行的 Spotify 音樂庫整理工具：備份收藏、合併來源、分批補齊歌曲 Metadata（中繼資料），並在本機進行 AI 輔助智慧分類與人工審核。**不會修改 Spotify 線上播放清單或歌曲資料**（除非未來另行實作且明確啟用）。

> 說明：本 README 以 `package.json` 與程式碼為準整理。操作前請自行確認本機 `backup/` 摘要檔是否為最新狀態。

---

## 目錄

1. [專案介紹](#1-專案介紹)
2. [執行環境與安裝](#2-執行環境與安裝)
3. [常用指令速查表](#3-常用指令速查表)
4. [日常操作教學](#4-日常操作教學)
5. [Spotify API 限流與冷卻機制](#5-spotify-api-限流與冷卻機制)
6. [資料夾與重要檔案說明](#6-資料夾與重要檔案說明)
7. [目前專案進度](#7-目前專案進度)
8. [常見問題 FAQ](#8-常見問題-faq)
9. [未來開發規劃](#9-未來開發規劃)

---

## 1. 專案介紹

### 已完成（本 repo 已具備）

| 能力 | 說明 |
|------|------|
| Spotify OAuth 授權 | 本機 PKCE（`npm start` / 備份流程），Token 存於 `.spotify_tokens.json` |
| 音樂庫備份 | 播放清單、已按讚、收藏專輯等（`npm run backup` 等） |
| 手動匯入追蹤歌單 | CLI / Web UI（`imports/`、`npm run import` / `import:ui`） |
| library-v2 合併 | 去重後的統一曲庫 JSON（約 7,759 首 unique tracks） |
| Metadata  enrichment | 分批呼叫 Track API，快取於 `backup/enrichment/` |
| 智慧分類索引 | 年代、語言、曲風等標籤 + **12 主曲風 / 40 子曲風**（`genre_profile`） |
| AI 測試流程（30 首） | 匯出樣本 → Cursor 產候選 → 匯入 → **本機 Web UI 審核** |
| AI v1 / v2 對照 | v1 封存於 `ai-test/v1/`，v2 獨立候選與審核於 `ai-test/v2/` |
| **正式分類狀態（第六階段 D）** | 與 `ai-review` 分開推導／快取：`confirmed`、`ai_suggested`、`rejected`、`unknown`（見 `formal-classification-state.json`） |
| **AI 可信度分級** | 規則推導的 `high` / `medium` / `low`（**非** AI 自報信心）；目前僅對 30 首 v2 樣本計算 tier |
| **本機智慧歌單預覽** | 依篩選與 `strict` / `balanced` / `relaxed` 模式統計符合曲目；**不建立 Spotify 線上歌單** |
| **v2 批次人工審核** | UI 多選、預覽、二次確認；單次最多 30 首；依**目前選定的測試批次** |
| **第六階段 E：100 首品質測試** | 獨立批次 `phase-e-100`（**不取代** v2 30 首）；Cursor 分批輸入／partial 匯入／品質報告 |
| **第六階段 F：20 首品質驗證** | 自 phase-e 分層抽樣；UI「AI 品質驗證」；**獨立** JSON，不等於正式 accept |

### 正式分類狀態 vs AI 審核（第六階段 D）

| 狀態 | 意義（簡述） |
|------|----------------|
| `confirmed` | 人工已確認：含 `manual-overrides`、v2/v1 審核 accepted/modified，或索引中標記為人工覆寫的有效分類 |
| `ai_suggested` | v2 樣本內有 AI 候選且審核仍為 **pending**；**尚未**因接受而寫入正式覆寫 |
| `rejected` | v2 樣本內人工**拒絕**該版 AI 建議 |
| `unknown` | 非樣本或無可靠分類（多數全庫曲目為此狀態） |

**優先順序**：人工覆寫與已接受審核 **優先於** 未審核的 AI 建議。切換預覽模式、執行本機預覽 **不會** 把 AI 標成 `confirmed`，也 **不會** 自動改寫 `manual-overrides.json`。

### 管理介面中文化（顯示層）

- Web UI（`public/classify/`）以 **`ClassifyUiLabels` + `ui_display_localize.js`** 將代碼轉為繁體中文；**JSON 儲存與 API 請求仍用原代碼**（如 `high`、`pop`、`inferred`）。
- AI 候選的 `evidence`／`analysis_note` **不會被批次改寫**；畫面僅對已知技術代碼（曲風代碼、`unknown`、`metadata`、`enrich` 等）做安全替換，歌名／藝人／專輯名保留原文。
- 完整語意翻譯若需覆蓋舊有 AI 自由文字，應另訂方案，**不得**直接修改 `ai-candidates-imported.json`。
- 尚未中文化：Spotify ID、部分英文歌名／專輯名、AI 長段英文敘述中無對照表者仍顯示原文。

### AI 可信度（high / medium / low）

- 依主曲風 evidence 長度、metadata 是否完整、語言是否確認、inferred 維度等**可檢查規則**計算（見 `lib/classification/confidence_tier.js`）。
- UI 顯示為 **高／中／低可信度**（內部仍為 `high`／`medium`／`low`）。
- **`high` 額外條件**：主曲風 evidence 須**錨定本曲歌名或專輯名**（與索引 `display.name`／`album_name` 對照）；僅藝人定位或長文字而未錨定曲目者上限 **medium**。
- evidence 不足或主曲風未確認時 **不得** 標為 `high`；**不會** 因「歌手常唱某類歌」就把全作品自動判為高可信度。
- 可信度主要用於 **balanced** 模式是否納入 AI 未審核曲目之本機預覽。

### 智慧歌單預覽模式（僅本機）

| 模式 | 行為 |
|------|------|
| **strict（嚴格）** | 只計入 **人工已確認**（`confirmed`）的曲目 |
| **balanced（預設）** | 人工確認優先；另納入 `ai_suggested` 且可信度 **medium 或 high** 的曲目 |
| **relaxed（寬鬆）** | 納入更多 `ai_suggested`（含 **low**），並在邏輯上標示未確認／風險 |

在 UI「智慧歌單本機預覽」選擇模式只寫入 `classification-settings.json` 的 `preview_mode`；**不代表**已在 Spotify 或正式索引中「接受」AI 分類。

### 未來規劃（尚未實作或未開放）

- 對**全庫 7,759 首**自動跑完 AI 分類（目前僅 30 首測試樣本流程）
- 在 Spotify 上**建立新的智慧播放清單**或寫回標籤
- 增量自動同步新歌（需另行設計排程與授權流程）

---

## 2. 執行環境與安裝

### 環境

- **作業系統**：Windows（專案於 Windows 開發與測試）
- **Node.js**：建議 **Node.js 20+**（程式以 ES Module 編寫；`lib/config.js` 註解提及 Node 20 無內建 dotenv，故自行解析 `.env`）
- **npm**：隨 Node 安裝即可

### 安裝步驟

```bash
cd D:\SpotifyOrganizer
npm install
```

（目前 `package.json` 無額外 npm 依賴時，`npm install` 可能幾乎無套件；仍以本機 `package.json` 為準。）

### `.env` 與 Spotify OAuth

1. 複製 `.env.example` 為 `.env`
2. 在 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 建立 App，取得 **Client ID**
3. 將 Client ID 填入 `.env` 的 `SPOTIFY_CLIENT_ID`（**勿將 Client ID / Secret / Token 寫入 README 或提交 Git**）
4. Dashboard 的 Redirect URI 須包含：`http://127.0.0.1:8888/callback`（與 `lib/config.js` 一致）

**Token（存取權杖）**：

- 首次授權：執行 `npm start` 或會觸發 OAuth 的指令（如 `npm run backup`），瀏覽器開啟授權頁，完成後寫入 **`.spotify_tokens.json`**（已在 `.gitignore`）
- 之後會以 refresh token 自動更新 access token
- 目前請求的 Scope 為**唯讀**：播放清單、已按讚、收藏專輯、追蹤藝人等（見 `lib/config.js` 的 `SCOPES`）

#### Token ACL 安全修復第一、二階段

Windows 正式呼叫端已接入核准機制：由 Windows「使用者範圍」環境設定（HKCU）取得 `SPOTIFYORG_AUTHORIZED_WINDOWS_SID`，以 `authorized_windows_user_sid` 傳給 ACL 驗證。此值須由本人確認後另外設定；程式不自動把目前程序 SID 當成核准值，也不使用程序繼承值、機器範圍值或專案 `.env` 的同名設定。**目前尚未建立正式核准設定或遷移真實 Token ACL，須待第三階段明確授權；未完成前仍會安全停止。** 不要將真實核准 SID 寫入專案檔案或貼進日誌。

預設在沙箱外，以核准的 Windows 一般使用者、未提升權限的 PowerShell 或 Git Bash 終端機執行原有指令。核准 SID、執行 SID 與 Token 擁有者必須一致；正式入口拒絕 CodexSandbox 帳號或 `CodexSandboxUsers` 群組成員，也拒絕提升權限的管理員程序。核准值每次存取重新查核，HTTP 往返後儲存時再次取得，避免使用已撤銷的核准。

- SID 使用系統目錄中的 `whoami.exe /user /fo csv /nh`；執行失敗、非零退出碼與解析失敗分別回報，不記錄原始輸出或環境變數。
- ACL 使用 Windows PowerShell 的 .NET API，以數字 SID 驗證；以無 profile 的 inline command 執行，不變更 ExecutionPolicy。只允許核准使用者 Modify、SYSTEM 與 Administrators FullControl，並要求停用繼承；不授權 `CodexSandboxUsers` 或猜測本人 SID。
- Windows 新空檔在建立當下即指定完整 DACL，確認安全後才寫入 Token；不先建立繼承寬鬆權限的檔案。隔離 ACL 遷移以單次 DACL 套用，失敗時嘗試還原原 DACL；無法確認安全便停止，可能留下空檔。既有檔案更新只驗證、不自動修改 ACL；不安全時保留原內容並停止。
- `load_tokens()` 在核准與 ACL 檢查後才讀取內容；只有確定檔案不存在才回傳未登入。權限拒絕、格式錯誤或檔案變動會拋出 `TokenAccessError`，不觸發重新登入。OAuth／刷新先檢查再送 HTTP；Token 存取或儲存錯誤不會轉入瀏覽器授權，補全也不會將其記為歌曲網路錯誤繼續執行。狀態查詢維持離線，不需要讀取 Token。
- 真實 Token 遷移仍須另外確認本人／沙箱執行身分、核准 SID、未知 SID 的用途及父目錄權限，再取得授權。此機制拒絕不同擁有者與多帳號共用；檔案 ACL 無法消除可寫父目錄造成的替換風險。更新使用原檔描述符，尚不保證磁碟寫入失敗時的內容原子性。
- 隔離離線驗證：`node test/helpers/run_token_acl_tests.js`。只複製程式與指定測試，不複製 Token、`.env` 或正式資料；使用假資料、暫存檔及 mock HTTP，結束後清理測試暫存目錄。第一階段 61 項持續通過，第二階段加上正式呼叫端與狀態查詢共 97 項通過。一般使用者成功情境以 mock 驗證；原生 ACL 使用當前帳號的獨立假檔案，PowerShell／Git Bash 正式入口只實測沙箱拒絕行為。**尚未驗證沙箱外的一般使用者、HKCU 核准設定與真實 ACL 整合。** 應用程式拒絕沙箱不等於已撤銷現有作業系統 ACL；真實檔案過寬的 ACL 風險仍待第三階段處理。

---

## 3. 常用指令速查表

以下皆來自 `package.json` 的 `scripts`（共 **24** 個 npm 指令，含 `test`）。

| 指令 | 功能 | 何時使用 | 呼叫 Spotify API | 寫入本機檔案 | 修改 Spotify 線上 |
|------|------|----------|------------------|--------------|-------------------|
| `npm start` | OAuth + 簡單 API 測試 | 首次授權或檢查 Token | 是 | 是（`.spotify_tokens.json`） | 否 |
| `npm run backup` | 完整音樂庫備份入口 | 要從 Spotify 拉最新清單/按讚/專輯 | 是 | 是（`backup/`） | 否 |
| `npm run backup:library` | 音樂庫相關備份 | 與 backup 流程搭配 | 是 | 是 | 否 |
| `npm run backup:artists` | 追蹤藝人備份 | 需要藝人列表時 | 是 | 是 | 否 |
| `npm run merge:library-v2` | 合併為 library-v2 | 備份或匯入後重建統一曲庫 | 否 | 是（`backup/merged/library-v2.json` 等） | 否 |
| `npm run import` | 手動匯入追蹤歌單（CLI） | 見 `imports/README.md` | 否 | 是 | 否 |
| `npm run import:ui` | 手動匯入 Web UI（`:8890`） | 貼上 Spotify 連結批次匯入 | 否 | 是 | 否 |
| `npm run probe:albums` | 專輯 API 唯讀探測 | 除錯、確認權限 | 是 | 否 | 否 |
| `npm run probe:artists` | 藝人 API 唯讀探測 | 除錯 | 是 | 否 | 否 |
| `npm run probe:tracks` | 曲目 Metadata 唯讀探測 | 除錯；受 429 冷卻限制 | 是 | 否 | 否 |
| `npm run enrich:tracks` | 分批補齊 Metadata（單次） | 小批量補歌名/專輯/發行日等 | 是（Track API） | 是（enrichment 快取等） | 否 |
| `npm run enrich:auto` | 多批次自動 enrichment | 長時間分批補齊 | 是（Track API） | 是 | 否 |
| `npm run enrich:status` | 查詢本機補全與播放狀態 | 隨時查看歷史累計進度 | 否 | 否（完全唯讀） | 否 |
| `npm run classify:build` | 重建分類索引與摘要 | 備份/enrichment/覆寫/審核後刷新 UI 數據 | 否 | 是（`classification-index.json`、`formal-classification-state.json` 等） | 否 |
| `npm run classify:ui` | 智慧分類 Web UI（`:8891`） | 瀏覽、AI 審核、批次審核、本機歌單預覽、人工覆寫 | 否 | 否（UI 操作經 API 寫分類檔） | 否 |
| `npm run classify:ai-export` | 匯出 AI 測試樣本（預設 30 首） | 新一批測試或重抽樣本 | 否 | 是（`ai-test/sample-30.json` 等） | 否 |
| `npm run classify:ai-import` | 匯入 **v1** AI 候選 | 將 `ai-test/ai-candidates.json` 驗證後寫入 | 否 | 是 | 否 |
| `npm run classify:ai-archive-v1` | 封存 v1 候選與審核副本 | v2 流程前備份 v1 | 否 | 是（`ai-test/v1/`，不覆蓋既有 manifest） | 否 |
| `npm run classify:ai-generate-v2` | 產生 **v2** 候選草稿 | 12+40 曲風字典重評 30 首 | 否 | 是（`ai-test/v2/ai-candidates.json`） | 否 |
| `npm run classify:ai-import-v2` | 匯入 **v2** 候選 | 驗證 v2 並寫獨立審核檔 | 否 | 是（`v2/`，不覆蓋 v1 根目錄審核邏輯） | 否 |
| `npm run classify:ai-export-phase-e` | 建立 **phase-e-100** 樣本 | 100 首品質測試選曲（含快照） | 否 | 是（`ai-test/phase-e-100/`） | 否 |
| `npm run classify:ai-merge-phase-e` | 合併 partial 候選 | Cursor 每批 JSON 完成後 | 否 | 是（草稿） | 否 |
| `npm run classify:ai-import-phase-e` | 匯入 phase-e 候選 | 可部分匯入 | 否 | 是（獨立審核檔） | 否 |
| `npm run classify:ai-quality-phase-e` | 品質報告 | 統計分布與完成數 | 否 | 是（`quality-report.json`） | 否 |
| `npm run classify:quality-audit-build-phase-f` | 建立 **phase-f-20** 抽樣 | 分層 20 首＋保護檔指紋快照 | 否 | 是（`quality-audit/phase-f-20/`） | 否 |
| `npm test` | 自動化測試（含 phase D／E／F） | 開發/regression | 否* | 測試可能暫時改寫 AI 測試檔 | 否 |

\*測試不呼叫 Spotify API；部分分類測試會寫入測試用 AI 資料，**請勿在生產審核後立即依賴測試前的 AI 檔狀態**，必要時重新 `classify:ai-import-v2`。撰寫 README 時本機曾跑通 **226** 項子測試（以 `npm test` 輸出為準）。

### `classify:ai-export` 參數

| 參數 | 說明 |
|------|------|
| `--count=N` | 樣本曲目數（預設 30） |

範例：

```bash
npm run classify:ai-export -- --count=30
```

---

## 4. 日常操作教學

### 情境 A：開啟智慧分類管理介面

```bash
npm run classify:ui
```

瀏覽器開啟：**http://127.0.0.1:8891**（僅監聽本機 `127.0.0.1`）

**停止服務**：在執行該指令的終端機按 **Ctrl+C**。

**重新啟動**：再次執行 `npm run classify:ui`。

**`EADDRINUSE`（連接埠 8891 被佔用）**：

1. 確認是否已有另一個 `classify-ui-server.js` 終端在執行（可直接關掉或 Ctrl+C）
2. 若仍佔用，在 PowerShell 查 PID：`Get-NetTCPConnection -LocalPort 8891` 或 `netstat -ano | findstr 8891`
3. 結束**你確認是舊 UI 行程**的 PID：`taskkill /PID <pid> /F`
4. 勿隨意結束不明行程

介面內也可按「重新整理分類索引」呼叫 API 重建索引（等同觸發 `classify:build` 邏輯）。

---

### 情境 B：查看與審核 AI 分類

1. 左上方統計卡片可看到庫內曲目數、Metadata 狀態、**AI 待審核**數量（有 v2 時以 v2 審核統計為主）。
2. 清單頁籤：
   - **全部歌曲**：一般瀏覽與篩選
   - **AI 待審核**：僅顯示審核狀態為 pending 的測試樣本曲目（v2 時為「新版待審核」）
3. 點選曲目後，右側大致分為四塊（由上而下）：
   - **目前正式分類**（綠色標示）：索引中**已生效**的標籤與 `genre_profile`
   - **AI 建議分類**（藍色區塊）：AI 候選，**尚未生效**；含 v1/v2 對照（若已匯入 v2）
   - **AI 人工審核**（綠色表單區）：接受 / 拒絕等操作
   - **人工覆寫分類**：不經過 AI 接受、直接編輯並「保存覆寫」

**曲風架構（新版）**：

- **主曲風**（12 種代碼，如 `pop`、`rock`）
- **次要曲風**（最多 2 個主曲風代碼）
- **子曲風**（40 種，可多選；須符合主/次曲風關係）

**v1 與 v2**：

- **v1**：舊版中文曲風標籤為主的 AI 候選；封存副本在 `backup/classification/ai-test/v1/`
- **v2**：新版 `genre_profile`（12+40）；使用中候選在 `ai-test/v2/ai-candidates-imported.json`，審核在 `ai-test/v2/ai-review.json`
- UI 在已匯入 v2 時，預設以 **v2** 進行審核；仍可看到 v1 人工確認狀態與新舊對照

**審核按鈕行為（與程式一致）**：

| 按鈕 | 效果 |
|------|------|
| **接受建議** | 將 AI 候選轉為 **`manual-overrides.json` 覆寫**，並重建分類索引；更新 **v2（或 v1）`ai-review.json`** 為 accepted |
| **修改後接受** | 同上，但語言/舊版曲風/情境/主曲風等以表單修改值為準（`modified` 狀態） |
| **拒絕建議** | 僅更新 **`ai-review.json`** 為 rejected；**不**寫入覆寫、**不**改變正式分類 |
| **稍後審核** | 設為 pending；**v2** 不會清除既有 manual-overrides；**v1** 的 pending 會嘗試清除該曲 AI 覆寫（歷史行為，見程式） |

若該曲已有**非 AI 來源**的人工覆寫，「接受」可能回 **409**，避免誤覆蓋。

---

### 情境 B-2：AI 品質驗證（第六階段 F）

1. 若尚未抽樣：`npm run classify:quality-audit-build-phase-f`（可重複執行，**sample_id** 不變則 track 清單不變）。
2. `npm run classify:ui` → 左側清單切換 **「AI 品質驗證」** 頁籤。
3. 點選曲目 → 檢視 AI 主／次／子曲風、語言、evidence、可信度；可開 Spotify 連結**自行聽音**（不自動播放、不呼叫 API）。
4. 選擇「正確／部分正確／錯誤／無法判斷」＋可選錯誤維度與備註 → **儲存品質驗證**。
5. 上方摘要顯示進度；**尚無人工填寫時不顯示準確率**。此流程**不會**寫入 `manual-overrides.json` 或 AI 正式 accept。

### 情境 B-1：切換 AI 測試批次（第六階段 E）

在歌曲清單上方 **「AI 測試批次」** 下拉選單：

| 批次 ID | 說明 |
|---------|------|
| `v2-sample-30` | 原有 v2 測試（30 首，`ai-test/v2/`） |
| `phase-e-100` | 新增 100 首品質測試（`ai-test/phase-e-100/`） |

切換會寫入 `classification-settings.json` 的 `active_test_batch`，並重新載入該批次的候選／審核。**不同批次的 `ai-review.json` 互不覆寫。** v1／v2 對照僅在 `v2-sample-30` 批次顯示。

---

### 情境 B-2：批次人工審核（第六階段 D／E）

**適用範圍**：**AI 待審核** 分頁 ＋ 目前選定的測試批次（30 或 100 首樣本內），**非全庫 7,759 首**。

1. 切到清單頁籤 **「AI 待審核」**（預設列出 pending 曲目）。
2. **勾選**左側核取方塊；或使用 **「全選目前清單」**（範圍＝**目前畫面上這份待審清單**，非全庫）。
3. 工具列選擇 **批次接受**、**批次拒絕** 或 **批次保留待審核**。
4. **第一次確認**：顯示預覽——將套用幾首、**跳過**幾首、**失敗**幾首（例如不在樣本、已是目標狀態、超過上限）。
5. **第二次確認**後才真正寫入。
6. 完成後 toast 顯示 **成功 / 跳過 / 失敗** 數量。

| 結果 | 意義 |
|------|------|
| **成功** | 該曲 v2 `ai-review.json` 已更新；**接受**時另寫 `manual-overrides` 並重建索引 |
| **跳過** | 已是目標審核狀態、或版本不符等，**未變更** |
| **失敗** | 不在 30 首樣本、找不到 v2 候選、與非 AI 覆寫衝突等 |

**限制**：單次最多 **30** 首（`classification-settings.json` 的 `batch_review_max`，程式上限 30）。重複送出相同操作可能因 **fingerprint / client_operation_id** 被視為冪等（見 `ai-test/v2/batch-operations.json`）。

API（本機 UI 使用）：`POST /api/ai/batch-review`（`confirm: false` 預覽 → `confirm: true` 執行）。

---

### 情境 B-3：智慧歌單本機預覽（第六階段 D）

在 **分類概覽** 區塊的 **「智慧歌單本機預覽」**（頁面上方，與年代分布同一區）：

1. 在左側 **篩選條件** 設定年代、語言、主曲風、子曲風、情境等（與「全部歌曲」清單相同欄位）。
2. 選擇 **預覽模式**（strict / balanced / relaxed）；變更模式會保存至 `classification-settings.json`，**不會** 自動接受 AI。
3. 按 **「依目前篩選預覽」**。
4. 結果顯示：**符合條件（去重）** 總數、**人工確認**、**AI 未審核**、**資料不足／未納入**、以及納入曲目之 **high / medium / low** 分布。

**重要**：

- 這是 **本機統計**，資料來自 `classification-index` + v2 候選 + 審核／覆寫推導；**尚未同步 Spotify**，**不會** 建立或修改線上播放清單。
- 全庫多數曲目為 `unknown`（無 AI 樣本或未確認）；預覽數字 **不代表**「已完成智慧分類的歌曲總數」。

API：`GET /api/preview/playlist?…`；比較三模式：`GET /api/preview/playlist/compare-modes?…`（除錯／進階用）。

---

**正式分類 vs 人工覆寫**：

- **正式分類**：`classify:build` 合併 library-v2、enrichment 快取、規則與 **`manual-overrides.json`** 後的結果（`classification-index.json`）
- **人工覆寫**：僅存在 `manual-overrides.json`；AI 接受也會寫入此檔（source 含 `ai_review`）

---

### 情境 C：重新建立分類索引

```bash
npm run classify:build
```

**何時需要**：enrichment 更新、接受 AI 分類、保存人工覆寫後，或摘要數字與 UI 不一致時。

**會保留**：`manual-overrides.json`、`ai-review.json`（v1/v2）、AI 候選 JSON；**不會**刪除審核紀錄。

**會重寫**：`classification-index.json`、`classification-summary.json`、`formal-classification-state.json`（由來源重新計算；正式狀態快取**不取代** `ai-review.json`）。

---

### 情境 D：繼續補齊歌曲資訊（Metadata）

執行補全必須帶參數，**不提供 `--max` / `--total` 不會跑全庫**（安全設計）。查詢狀態不需參數。

#### 唯讀查詢補全狀態

```bash
npm run enrich:status
```

只讀取本機 V2 音樂庫、合併完成旗標、Metadata 快取與 `backup/enrichment/rate-limit-state.json`，不呼叫 Spotify API、不消耗 API 額度、不啟動 OAuth 或更新 Token，不執行補全或重試、不更新冷卻時間，也不建立或修改快取、Checkpoint、冷卻紀錄、備份、報表或任何輸出檔。音樂庫或快取缺失、格式錯誤或無法讀取時會顯示錯誤並以非零狀態結束，不自動重建；冷卻紀錄異常則保留其他統計，於冷卻區塊顯示未知與原因。

| 輸出欄位 | 意義與計算方式 |
|---|---|
| 音樂庫歌曲總數 | V2 索引內依 Spotify ID 去重，不把庫外快取加入音樂庫 |
| 已完成 Metadata 補全、完成率 | 沿用既有佇列：V2 已有 Metadata（不符合 `is_id_only_track_row()`），或快取通過 `is_metadata_cache_complete()`；同一 ID 只計一次。完成率為完成數／總數，空庫為 0%。這是歷史累計，並非本次成功數 |
| 正常待補全 | V2 僅有 ID 且尚無快取 |
| 異常未完成 | V2 僅有 ID，且已有非完整成功快取 |
| 延後處理的異常 | 沿用正常補全階段佇列口徑，所有異常均延後至主動重試 |
| 冷卻中的異常 | 依既有單曲冷卻規則及查詢當下時間計算，是異常與延後數的子集合，不可重複相加 |
| 全部剩餘待補全 | 正常待補全＋異常未完成；加上已完成應等於音樂庫總數 |
| 已知可播放、已知不可播放／受限、播放狀態未知 | 全庫每個 ID 各計一次，三類合計等於音樂庫總數 |
| 快取完整成功、403、404、429、network、partial、其他異常、快取總數 | 全部本機快取的歷史狀態分類，包含庫外 ID；分類合計等於快取總數，不等於全庫播放統計或異常未完成數 |
| 快取最後更新時間 | 快取文件的 `updated_at` 轉為台灣時間，例如 `2026/11/02 09:32:19（台灣時間）`；未記錄時顯示未知，不以查詢時間代替，也不作為冷卻截止時間 |
| Spotify API 冷卻狀態 | 從已保存且通過驗證的全域 Track API 429 紀錄顯示是否冷卻中、冷卻截止、建議重新執行時間與尚需等待多久；已結束時明確提示可重新嘗試 |

狀態查詢的所有日期固定使用 `Asia/Taipei`、西元曆與 `YYYY/MM/DD HH:mm:ss（台灣時間）`。建議重新執行時間沿用向上取整至整分鐘的規則（顯示秒數 `00`，整分鐘截止不另加一分鐘），不得早於實際截止時間。已過期的紀錄仍顯示其歷史截止與建議時間，尚需等待為 0 秒；這僅代表本機保存的冷卻已結束，不保證 Spotify 即時可用。

「異常未完成」「冷卻中的異常」是歌曲數及單曲重試冷卻；「Spotify API 冷卻狀態」是全域 Track API 暫停期限，兩者獨立，不能由單曲 429 數量判定目前 API 是否冷卻中。無紀錄時顯示「無有效冷卻紀錄」及未知；格式錯誤、無法讀取、紀錄明示為推估或歷史觀測時間不可靠時也顯示未知，不從快取回填或自行推估、不宣稱可重新執行。既有補全指令仍沿用原本的冷卻阻擋規則。

V2 完成判定特別沿用現有補全行為：只要有歌名、藝人、專輯名或發行日等 Metadata，便不再是僅有 ID 的列；這不保證每個詳細欄位都齊全。API 快取則須為 `ok` 且必要歌名、藝人及專輯欄位完整。本指令不改變既有補全資格。

播放狀態只認明確的 `playability_status`：`playable` 是可播放，`not_playable` 與 `restricted` 是不可播放／受限。同一 ID 衝突時，API 快取的明確已知狀態優先於 V2；快取為 `unknown`、`null` 或缺少狀態時，採 V2 明確已知狀態；兩者皆無可靠狀態則列未知，不從其他欄位推測。此優先順序不比較時間戳，代表本機已知記錄，並非即時可用性。不可播放不代表 Metadata 補全失敗，未知也不代表不可播放。

公司與家用電腦的統計各依本機資料為準，須先完成既有資料同步才可比較；冷卻數也可能隨查詢時間改變。

**單次小批（`enrich:tracks`）**：

```bash
npm run enrich:tracks -- --max=10 --resume --delay-ms=3000
```

**多批自動正常補全（`enrich:auto`，只查尚無快取的歌曲）**：

```bash
npm run enrich:auto -- --total=100 --batch-size=20 --delay-ms=3000 --batch-pause-sec=120 --resume
```

已有 `partial`、404、403、429、network 或其他非完整快取的歌曲會延後，冷卻到期也不會自動進入正常佇列。正常階段本次新產生的異常同樣延後；不會自動切換到異常重試。

**獨立重試異常歌曲（只處理已有非完整快取且冷卻到期者）**：

```bash
npm run enrich:auto -- --total=20 --batch-size=5 --delay-ms=3000 --batch-pause-sec=120 --resume --retry-failed
```

`--retry-failed` 不查無快取歌曲，也不略過單曲冷卻或全域 `Retry-After`。建議先完成正常補全，再主動執行此階段。每次 auto 執行中，同一 ID 最多進入一次歌曲處理；底層 401／429 的必要重試仍計入 `--total` 預算。

兩種階段均可加上 `--dry-run` 唯讀查看計畫。摘要分列正常待補全、異常總數、延後異常、冷卻異常、本次成功／失敗與全部剩餘；冷卻異常包含於延後數，不可重複加總。失敗包含 `partial` 與各種查詢錯誤。`remaining_after_run` 包含兩階段所有未完成歌曲；`can_resume=true` 表示仍有未完成資料，不代表當下已解除冷卻或本階段有可查歌曲。

`--resume` 繼續沿用快取與 checkpoint，不重置資料；auto 即使未指定此旗標也不清空進度。單批 `enrich:tracks` 維持原有冷卻重試行為，正常補全優先與 `--retry-failed` 僅適用於 `enrich:auto`。

#### 參數說明（程式 enforced 範圍）

| 參數 | 適用指令 | 說明 | 限制（程式碼常數） |
|------|----------|------|------------------|
| `--max=N` | `enrich:tracks` | 本次最多查詢幾首 | 必填；**1～50**（`ENRICH_MAX_PER_RUN`） |
| `--total=N` | `enrich:auto` | 整個 auto run 的 Track API 預算 | 必填；**≤ 2000**（`ENRICH_AUTO_MAX_TOTAL`） |
| `--batch-size=N` | `enrich:auto` | 每批最多幾首 | 預設 50；**≤ 50** |
| `--delay-ms=N` | 兩者 | 每次請求間隔（毫秒） | 非負；`enrich:auto` **≥ 1000** |
| `--batch-pause-sec=N` | `enrich:auto` | 批次之間暫停秒數 | 預設 30 |
| `--resume` | 兩者 | 沿用快取與 checkpoint 續跑 | 旗標 |
| `--retry-failed` | `enrich:auto` | 只重試已有異常快取且冷卻到期的歌曲 | 主動指定；不自動切換階段 |
| `--dry-run` | 兩者 | 不寫入快取（測試用） | 旗標 |

完成後可執行 `npm run classify:build` 讓分類索引反映新 Metadata。

> **請勿在 README 撰寫時誤執行大量 API 查詢**；實際補齊前請確認 `rate-limit-state.json` 無冷卻。

---

### 情境 E：ZIP 交接檔名

Windows 匯出存檔對話框的預設檔名為 `spotify-handoff-YYYYMMDD-HHMMSS.zip`，例如 `spotify-handoff-20261102-233213.zip`。時間固定為台灣時間，使用西元曆與 ASCII 數字；Windows 10／11 對應時區 ID 為 `Taipei Standard Time`（`Asia/Taipei`）。舊版 `Get-Date -Format` 會沿用目前文化設定的曆法，民國曆可能產生 `1151102`，新版已明確指定 GregorianCalendar 與 InvariantCulture。

既有民國年份 ZIP、舊西元年份 ZIP 與自訂檔名仍可匯入；匯入依 ZIP 內容、manifest、雜湊及交接鏈驗證，不解析檔名年份。CLI 指定的輸出路徑及使用者自訂存檔名稱仍沿用原操作，不重新命名或刪除舊檔。

## 5. Spotify API 限流與冷卻機制

### HTTP 429

- **意義**：Spotify 認為請求過於頻繁，要求用戶端暫停。
- **`Retry-After`**：回應標頭（秒），表示應等待多久再試。
- **為何不能瘋狂重試**：持續請求可能延長封禁，且本專案會將長冷卻寫入狀態檔並**拒絕新的 Track API 查詢**。

429 提示與全域冷卻阻擋訊息固定使用 `Asia/Taipei`、西元曆與數字格式，不受 Windows 地區或曆法設定影響。例如：

```text
冷卻截止：2026/11/02 23:32:13（台灣時間）
建議重新執行：2026/11/02 23:33（台灣時間）
剩餘等待：2 分
```

建議時間由實際截止時間向上取整至整分鐘（已在整分鐘則保留，非零毫秒亦會進位），不會提前；只影響顯示，不改變冷卻、API 預算或重試規則。狀態檔仍保存原本 UTC ISO 時間。缺少有效 `Retry-After` 時仍沿用既有保守冷卻並明確標示「推估」，沒有有效截止時間時顯示未知。

### 冷卻期間應停止的操作

- `npm run enrich:tracks` / `enrich:auto`
- `npm run probe:tracks`（會檢查全域冷卻）

可繼續：**不呼叫 Track API** 的工作（`classify:ui`、`classify:build`、編輯 JSON、AI 審核等）。

### 查看 `backup/enrichment/rate-limit-state.json`

- 記錄最近一次 **Track API 429** 的觀測時間、`retry_after_seconds`、`retry_not_before` 等
- enrichment 啟動前會讀取；冷卻未結束則**直接停止**並提示剩餘時間（終端亦會輸出臺灣時間說明）

### 冷卻結束後如何恢復

1. 確認 `retry_not_before` 已過
2. 以**小批量**重新啟動，例如 `--max=5` 或 `--total=50 --batch-size=10`，並保留 `--delay-ms=3000` 或更高
3. 使用 **`enrich:auto --resume`** 優先處理無快取歌曲；正常補全結束後，再明確加上 **`--retry-failed`** 重試異常。兩者皆沿用既有進度

### Ctrl+C 中止

- enrichment 設計為可安全中斷；已寫入快取與 checkpoint 的進度可 `--resume` 續跑
- 鎖檔 `.enrich.lock` 用於避免並行 enrichment（勿手動刪除非確認無行程在跑）

### 「Track API 查詢預算已用尽」≠ 429

- 這是 **`enrich:auto` 本次設定的 `--total` 預算**用完（見 `lib/enrichment/track_api_budget.js`）
- 代表**你設定的本次查詢額度**耗盡，程式正常停止；**不等於** Spotify 回 429
- 429 則會寫入 `rate-limit-state.json` 並進入**全域冷卻**

---

## 6. 資料夾與重要檔案說明

```
SpotifyOrganizer/
├── backup/                    # 主要資料輸出（請定期備份整個目錄）
├── imports/                   # 手動貼上歌單連結的文字檔
├── public/classify/           # 分類 Web UI 靜態頁
└── lib/                       # 核心邏輯（一般使用者不必改）
```

### `backup/` 重點

| 路徑 | 用途 | 可否刪除 |
|------|------|----------|
| `playlists.json`、`playlist-tracks.json`、`liked-tracks.json` 等 | Spotify API **原始備份** | ⚠️ 刪除後需重新 backup |
| `library/` | 音樂庫分段備份與 checkpoint | ⚠️ |
| `imported/` | 手動匯入結果 | ⚠️ 若仍依賴匯入歌單 |
| `merged/library-v2.json` | **合併後唯一曲庫**（分類/enrichment 來源） | ❌ 勿刪 |
| `merged/merge-summary-v2.json` | 合併統計 | 可重建但建議保留 |
| `enrichment/track-metadata-cache.json` | Metadata **快取** | ❌ 刪除後會重複打 API |
| `enrichment/checkpoint.json` | enrichment **續傳** | ⚠️ |
| `enrichment/rate-limit-state.json` | 429 **冷卻狀態** | ⚠️ 勿隨意改 |
| `classification/classification-index.json` | **正式分類索引**（可 `classify:build` 重建） | 可重建 |
| `classification/manual-overrides.json` | **人工覆寫**（含 AI 接受） | ❌ 勿刪 |
| `classification/ai-review.json` | v1 測試樣本 **審核狀態** | ❌ 勿隨意刪 |
| `classification/ai-candidates.json` | v1 使用中 AI 候選 | ⚠️ |
| `classification/ai-test/v1/` | v1 **封存**（manifest 存在則不再覆蓋） | ❌ 勿刪（歷史對照） |
| `classification/ai-test/v2/` | v2 候選、審核、compare-summary | ⚠️ 測試中核心數據 |
| `classification/ai-test/phase-e-100/` | **100 首**品質測試：樣本、Cursor 分批 MD、partial、品質報告 | ⚠️ 與 v2 **獨立**；勿覆蓋 v2 |
| `…/phase-e-100/sample-100.json` | 100 首 track id 與 metadata 快照 | `classify:ai-export-phase-e` |
| `…/phase-e-100/cursor-chunks/chunk-01…05.md` | 每批 **20 首** Cursor 分析輸入 | 匯出樣本時產生 |
| `…/phase-e-100/partial-candidates/` | Cursor 每批輸出的 JSON 片段 | 手動／Agent 寫入 |
| `…/phase-e-100/quality-report.json` | 品質統計（完成數、曲風分布、可信度等） | `classify:ai-quality-phase-e` |
| `…/phase-e-100/cursor-progress.json` | 已完成／待 AI 分析 track id | 匯入時更新 |
| `classification/quality-audit/phase-f-20/` | **20 首**人工品質驗證抽樣與結果 | `classify:quality-audit-build-phase-f`／UI |
| `…/phase-f-20/sample-20.json` | 抽樣 track id、分層分布、來源 fingerprint | 建樣本時 |
| `…/phase-f-20/verification.json` | 人工品質判定（與 ai-review **隔離**） | UI 儲存 |
| `…/phase-f-20/quality-report.json` | 驗證統計（無人工時無準確率） | API／建樣本後 |
| `classification/classification-settings.json` | 本機 **預覽模式**（`preview_mode`）、**批次上限**（`batch_review_max`） | 首次 UI 改模式或 POST `/api/preview/settings` 時建立；缺檔時程式用預設（balanced、30） |
| `classification/formal-classification-state.json` | 每曲 **正式狀態** + 樣本 **可信度** 快取（與審核檔分離） | `classify:build` 或接受／拒絕審核後重建；**可刪除後由 build 再生** |
| `classification/ai-test/v2/batch-operations.json` | v2 **批次審核**操作紀錄（冪等／追溯） | 首次成功批次寫入後產生；可手動刪除（僅失去冪等紀錄，不還原審核） |
| `classification/snapshots/` | 分類遷移／測試前 **安全快照**（含 v2、settings、formal state 等；**不含** `.env` / token） | 由 `snapshot_classification_data()`（測試或維護腳本）建立；可整夾備份或刪舊快照 |

**OAuth / 機密**（勿提交 Git）：`.env`、`.spotify_tokens.json`

---

## 7. 目前專案進度

以下數字來自本機摘要檔（**會隨操作改變**）。README 同步第六階段 E 時核對時間：**2026-10-22**（UTC 約 `02:19` 前後，見 `quality-report.json` `generated_at`）。

| 項目 | 數值 | 來源檔 / 時間 |
|------|------|----------------|
| 不重複曲目（library-v2） | **7,759** | `backup/merged/merge-summary-v2.json`（`merged_at`: 2026-10-19） |
| 分類索引曲目數 | **7,759** | `classification-summary.json` |
| Metadata 完整 / 待補齊 | **1,895 / 5,864** | `classification-summary.json`，`updated_at`: **2026-10-22T01:59:39Z** |
| Enrichment 快取條目 | **1,160**（摘要內 `cached_entries`） | `enrichment/summary.json`，`updated_at`: 2026-10-21 |
| 曲風字典 | **12 主 + 40 子**（`genre_taxonomy_version`: 1） | 分類摘要 / 程式 |
| AI 測試樣本 | **30 首**（`sample_id`: cd3f5bbbd23f2733） | `ai-test/sample-summary.json` |
| v2 候選 | **30 首** 已匯入 | `ai-test/v2/ai-candidates-imported.json` |
| v2 審核（當時） | pending 27、accepted 1、rejected 2 | `ai-test/v2/ai-review.json`，`updated_at`: **2026-10-22T01:59:39Z** |
| v1 封存審核（當時） | pending 28、accepted 1、rejected 1 | `ai-test/v1/ai-review.json`（封存副本） |
| v1 vs v2 分類差異 | **29/30** 首有差異 | `ai-test/v2/compare-summary.json` |
| 正式索引中 AI 接受覆寫 | **manual_override_tracks: 2** | `classification-summary.json` |
| **正式狀態（全庫推導）** | confirmed **1**、ai_suggested **27**、rejected **2**、unknown **7729** | `formal-classification-state.json`，`updated_at`: **2026-10-22T01:59:39Z** |
| **v2 樣本可信度** | high **0**、medium **26**、low **4** | 同上 `sample_tier_counts` |
| **本機預覽（空篩選，符合去重）** | strict **1**、balanced **24**、relaxed **28** | 依當時索引離線計算（與 UI 預覽同一邏輯）；審核／覆寫變更後會變 |
| **phase-e-100 樣本** | **100** 首（`sample_id`: b191132b1c5f1ea4） | `ai-test/phase-e-100/sample-100.json` |
| phase-e 符合條件池（排除 v2 30） | **1,865** 首 | `sample-summary.json` |
| phase-e 已完成 Cursor AI 分類 | **100** / 100（chunk-01…05 partial 已匯入） | `quality-report.json`／`cursor-progress.json` |
| phase-e 主曲風分布（示例） | pop **64**、rock **8**、hip_hop **6**、soundtrack **7**、unknown **4** 等 | `quality-report.json` → `primary_genre_distribution` |
| phase-e 可信度（規則推導） | high **79**、medium **17**、low **4** | 同上 → `confidence_tier_distribution`（**非** AI 自稱） |
| phase-e 子曲風不匹配 | **0**（與 validate 同邏輯，含次主曲風） | `subgenre_mismatch_count` |
| phase-e 人工審核 | **0** 已審／**100** 待審（皆 AI 推測，未 accept） | `ai-test/phase-e-100/ai-review.json` |
| phase-e 樣本年代（示例） | 1980s–2020s 各約 15 首等 | `sample-summary.json` → `decades` |
| phase-e 樣本獨立藝人 | **85** | `sample-summary.json` |
| **phase-f-20 品質抽樣** | **20** 首（`sample_id`: c7e4a91f2b0d3e8f） | `quality-audit/phase-f-20/sample-20.json` |
| phase-f 人工品質驗證 | **0**／20（待 UI 填寫） | `quality-audit/phase-f-20/verification.json` |
| 自動化測試 | **226** 項通過 | `npm test`（含 phase D／E／F、UI 中文化） |

### 如何自行更新進度數字

```bash
# 分類摘要（曲目數、Metadata、主曲風統計）
type backup\classification\classification-summary.json

# 合併庫規模
type backup\merged\merge-summary-v2.json

# Enrichment 進度
type backup\enrichment\summary.json

# 正式狀態與 v2 可信度
type backup\classification\formal-classification-state.json
```

或在 UI 頂部統計卡片查看（需先 `classify:build` / UI 內重建）；本機歌單預覽數字在概覽區 **「依目前篩選預覽」** 取得。

### 安全與資料界線（第六階段 D）

- **勿** 把 AI 候選或 `ai_suggested` 預覽結果說成「已全部人工確認」；只有 `confirmed` 或已接受審核／覆寫才算正式採用。
- **勿** 宣稱全庫 7,759 首已完成 AI 智慧分類；目前僅 **v2 30 首**與 **phase-e 100 首**兩個**獨立測試批次**有 AI 候選（皆待／部分人工審核，未自動寫入全庫覆寫）。
- **勿** 刪除 `ai-test/v1/` 封存、`ai-test/v2/ai-review.json` 或根目錄 v1 審核／覆寫；批次與預覽皆依這些紀錄推導。
- **勿** 在文件、截圖或 Git 中揭露 `.env`、Client Secret 或 `.spotify_tokens.json` 內容。

---

## 8. 常見問題 FAQ

**Q：`npm run classify:ui` 出現 EADDRINUSE？**  
A：8891 已被佔用。關閉舊終端或依 [情境 A](#情境-a開啟智慧分類管理介面) 結束佔用該 port 的 `node` 行程。

**Q：關掉終端機會不會丟失分類？**  
A：不會。分類、審核、覆寫都在 `backup/classification/` JSON；關 UI 只停伺服器。

**Q：重新啟動會重新下載全部歌曲嗎？**  
A：不會。`classify:ui` 只讀本機索引。`backup`、`enrich:tracks` 與 `enrich:auto` 會打 Spotify API；`enrich:status` 完全唯讀且不呼叫 API。

**Q：API 429 怎麼辦？**  
A：停止 enrichment/probe:tracks，查看 `rate-limit-state.json`，等 `retry_not_before` 過後小批量 `--resume` 續跑。

**Q：Metadata 快取在哪？**  
A：`backup/enrichment/track-metadata-cache.json`（搭配 `checkpoint.json`）。

**Q：AI 分類會不會自動改 Spotify？**  
A：**不會。** AI 只寫本機候選；接受後才寫 `manual-overrides.json` 並重建索引。

**Q：接受 AI 分類後存哪？**  
A：主要寫入 `backup/classification/manual-overrides.json`，並反映到 `classification-index.json`（接受時 UI/API 會觸發 rebuild）。

**Q：如何保留原本 Spotify 播放清單？**  
A：本工具備份與分類皆**唯讀** Spotify（目前 scope 無修改播放清單權限）；線上清單不會因分類 UI 而改變。

**Q：v1 和 v2 AI 差在哪？**  
A：v1 以舊版中文曲風標籤為主；v2 使用 12 主曲風 + 40 子曲風 `genre_profile`。v2 審核獨立存檔，接受 v2 才會用新版 profile 覆寫。

**Q：是否需要每天開 Cursor？**  
A：**不需要。** 日常審核只需 `classify:ui`。只有要**重產 AI 候選 JSON**（`classify:ai-generate-v2` 或手動編輯草稿）時才需要 Cursor / 編輯器。

**Q：`npm test` 後 AI 資料怪怪的？**  
A：測試會寫入最小 AI 測試數據。若需恢復，請依流程重新 `classify:ai-import-v2`（或從 `ai-test/v1/` 對照還原）。

**Q：切換 strict / balanced / relaxed 會自動接受 AI 嗎？**  
A：**不會。** 只更新 `classification-settings.json` 的本機預覽規則；接受仍須在單曲或 **批次接受** 審核。

**Q：本機「智慧歌單預覽」會在 Spotify 建立歌單嗎？**  
A：**不會。** 僅統計符合篩選的本機索引／候選；線上歌單建立屬未來規劃。

**Q：批次審核為什麼只能 30 首且只在 AI 待審核？**  
A：刻意限制在**目前測試批次**（30 或 100 首樣本），避免誤對全庫操作；上限由 `batch_review_max` 控制（最大 30）。

**Q：100 首 phase-e 如何跑 Cursor AI？**  
A：1) `npm run classify:ai-export-phase-e`（若尚未匯出）→ 2) 依 `cursor-chunks/chunk-XX.md` 在 Cursor 分析，輸出 JSON 至 `partial-candidates/` → 3) `npm run classify:ai-merge-phase-e` → 4) `npm run classify:ai-import-phase-e`（**可部分匯入**，不必一次 100 首）→ 5) `npm run classify:ai-quality-phase-e` 或 UI 切換批次查看。不得以規則式程式冒充 AI 結果。

---

## 9. 未來開發規劃

### 已完成（第六階段 D）

- v2 **批次人工審核**（多選、預覽、二次確認、冪等紀錄）
- **本機智慧歌單預覽**（三模式、篩選、可信度與 confirmed / AI 未審核 breakdown）
- **正式分類狀態**與 **可信度** 快取（與 `ai-review` 分離）

### 已完成（第六階段 E）

- 獨立 **100 首**測試批次 `phase-e-100`（選曲可重現、排除 v2 30 首）
- Cursor **每批 20 首**輸入與 **partial 合併／匯入**流程
- **100 首** Cursor AI 候選已匯入（`partial-candidates/chunk-01…05.json`；**尚未**批次 accept）
- **品質報告**（主／子曲風分布、可信度、unknown、流行佔比等；**不宣稱 AI 準確率**）
- 可信度 **high** 規則強化（主曲風 evidence 須錨定歌名／專輯）；品質報告 **subgenre_mismatch** 與 schema 驗證一致
- chunk-01 修正快照：`backup/classification/snapshots/chunk-01-pre-revision-20261022/`
- UI **測試批次切換**（v2 30 ↔ phase-e 100）

### 已完成（第六階段 F）

- **20 首**可重現分層抽樣（來源 phase-e-100；含 unknown 4 首全數納入）
- UI **「AI 品質驗證」**頁籤（清單、篩選、詳情、Spotify 外連）
- 獨立 `verification.json`；**品質驗證 ≠ 正式 AI 接受**
- 品質統計報告（部分正確獨立計；無法判斷不進準確率分母；無人工時不宣稱準確率）
- 分類管理介面 **繁體中文化**（顯示層；見上文「管理介面中文化」）

### 已完成（階段 G1 · 外部查證基礎）

**目的**：以可擴充的 Provider 架構查證本機 Spotify 備份曲目，優先 ISRC、再歌名＋藝人交叉比對；**不覆寫**正式分類、AI v1/v2、phase-e/F 或 `manual-overrides.json`；**不呼叫 Spotify API**。

**外部來源（G1）**： [MusicBrainz 公開 API](https://musicbrainz.org/doc/MusicBrainz_API)（≤1 req/s、合規 User-Agent、`Retry-After` 有限重試）。

**資料目錄** `backup/enrichment/external/g1-30/`：

| 檔案 | 用途 |
|------|------|
| `sample-30.json` | G1 試驗樣本（含蘇慧倫〈Lemon Tree〉語言陷阱案例） |
| `selection-manifest.json` | 選曲理由與分桶 |
| `query-cache.json` | MusicBrainz 查詢快取（避免重複請求） |
| `verification-results.json` | 每曲查證結果（事實／推論／未知分層） |
| `progress.json` | 續跑進度與網路統計 |
| `quality-report.json` | 繁中品質摘要 |
| `g1-analysis-report-zh.md` | **30 首試驗完成後**之逐曲分析與 G2 規劃（唯讀，不觸發 API） |

**G1 三十首試驗結果（MusicBrainz 已跑完，2026-10-22）**：

| 指標 | 數量 |
|------|------|
| 有候選搜尋結果 | 15 |
| 可靠比對（`matched`） | 12 |
| 版本歧義 | 2 |
| 查無 | 3 |
| 請求錯誤（多為 ISRC 404 且未 fallback） | 12 |
| 曲風標籤（MB 使用者 tags） | 9 |
| 可靠演唱語言 | 0（G1 刻意不推斷） |

逐曲說明、Lemon Tree 專項、覆蓋率根因與 G2 優先序見 **`backup/enrichment/external/g1-30/g1-analysis-report-zh.md`**。比對分數**不是**實際正確率。

**事實 vs 推論**：外部可直接支持的錄音 ID、標題、藝人、發行日、來源標籤寫入 `facts`；演唱語言／主曲風等分類寫入 `inference`（G1 **不因英文歌名推語言**）；查無或歧義寫入 `unknown`。

**npm 指令**（預設離線）：

```bash
npm run verify:g1-build-sample   # 建立／更新 30 首樣本
npm run verify:g1-preview        # 離線預覽查詢計畫
npm run verify:g1-status         # 快取與進度
npm run verify:g1-report         # 重產品質報告
npm run verify:g1-run            # 預設僅提示；連線需 --online
npm run verify:g1-clean-mock-runtime   # 備份並清除誤寫入的 mock 執行期資料
```

**測試資料隔離**（`backup/enrichment/external/g1-30/`）：

- **正式試驗**固定使用 `g1-30/` 下的 `sample-30.json`（`verify:g1-build-sample` 永遠寫入此目錄，不受環境變數影響）。
- **查證結果／快取／進度／報告**預設也寫入同一目錄；`npm test` 中的 G1 mock 測試改設環境變數 `SPOTIFYORG_G1_DATA_DIR` 指向系統暫存目錄，**不得**再寫入正式試驗目錄。
- mock 特徵：`rec-mock-1`、`rec-search-1`、`Mock Title` 等（見 `lib/enrichment/external/g1_path_resolve.js`）。若誤混入正式目錄，執行 `verify:g1-clean-mock-runtime` 會先備份至 `g1-30/local_backups/mock-runtime-*` 再重設執行期 JSON（**不刪**樣本檔）。
- 真實 MusicBrainz 查證結果不含上述 mock ID；清理工具僅在偵測到 mock 時才重設。

**30 首試驗（需你確認後執行）**：

```bash
npm run verify:g1-build-sample
npm run verify:g1-run -- --online
npm run verify:g1-report
```

中斷後再次執行 `verify:g1-run -- --online` 會略過已完成曲目並沿用快取；強制重查可加 `--force`。

**程式位置**：`lib/enrichment/external/`（`musicbrainz_provider.js`、`match_scoring.js`、`verification_store.js` 等）。UI 概覽列顯示 G1 進度；API `GET /api/external-verify/status`。

**已知限制**：G1 僅 MusicBrainz；ISRC HTTP 404 時未自動改走歌名搜尋（導致 12 首零候選）；比對分數 ≠ AI 可信度；Spotify 英文藝人名 vs MB 中文名易拉低分數；演唱語言需 G2 另闢證據來源。

### G2 第一階段 · MusicBrainz 改善（30 首線上試驗已完成）

**目的**：在**不新增其他外部來源**前提下，提高 ISRC 404 後的查詢成功率；結果寫入 **`backup/enrichment/external/g2-30/`**，**不覆寫** `g1-30/` 基準。

**G2 試驗結果（與 G1 對照）**：matched 9（G1 12）、error 0（G1 12）、not_found 14（G1 3）、insufficient 5（G1 1）、ambiguous 2、曲風標籤 9、網路請求 42（G1 30）。**matched 下降主因**為 4 首 ISRC 直配因跨語系藝人字串觸發 `isrc_conflict` 降級；**error 歸零**主因為 ISRC 404 改走 fallback 後多數仍無候選（改標 not_found）。**診斷報告（繁中）**：[`backup/enrichment/external/g2-30/g2-diagnostic-report-zh.md`](backup/enrichment/external/g2-30/g2-diagnostic-report-zh.md)；離線比較檔 [`g1-vs-g2-compare.json`](backup/enrichment/external/g2-30/g1-vs-g2-compare.json)。可重產報告：`node scripts/gen-g2-diagnostic-report.mjs`（不呼叫 API）。

**G2.1 程式修正（尚未重跑線上 30 首）**

| 項目 | 說明 |
|------|------|
| ISRC 衝突 | `evaluate_isrc_artist_evidence`：評分與衝突共用 `artist_name_variants` + 本機藝人集合；**跨書寫系統 0 分不單獨判衝突**；同系統不同名仍判衝突 |
| 藝人未核實 | `artist_match_status=unverified_cross_script` → tier 仍 `isrc_direct`，註記「跨語系尚未核實」 |
| 藝人變體 | 依 Spotify Artist ID 彙整 enrichment／index 已出現名稱（不臆造） |
| Fallback 搜尋 | 僅 **CJK 藝人名** 才 `AND artist`；拉丁 display 改 **只搜歌名**，limit 25，本機 `score_candidate` 嚴格篩選 |
| 離線重播 | [`g2-1-offline-replay.json`](backup/enrichment/external/g2-30/g2-1-offline-replay.json)（**不覆寫** G1/G2 `verification-results.json`） |

```bash
npm run verify:g2-1-offline-replay   # 離線重算已存候選
```

**G2.1 離線重播摘要（2026-10-22）**：30 首中 **4 首**（心愛的再會啦、一一、最近比較煩、구르미 그린 달빛）自 G2 `insufficient` → 重算 **matched**；Lemon Tree／ambiguous 列不變；**11 首** G2 fallback 零候選仍標 `needs_research`（需日後線上 fallback 才驗證搜尋改善）。**未增加網路請求**。

**後續整合**：G2.1 結果欄位（`artist_match_status`、`artist_evidence_sources`）供外部查證 UI／AI 候選預覽；正式分類門檻未改。

| 機制 | 說明 |
|------|------|
| ISRC fallback | ISRC **404 或空錄音** → 最多 **+1 次** 歌名＋藝人 recording 搜尋 |
| 404 vs 429/503 | 404 視為查無並可 fallback；429/503/連線錯誤標 **可重試 error**，非 not_found |
| 藝人比對 | 合併本機 `display` / `merged_metadata` / enrichment 快取中的**已存在**藝人名；搜尋優先 CJK 名 |
| 可信度分層 | 結果列新增 `match_tier`：`isrc_direct`／`cross_match`／`text_weak`／`ambiguous`（分數≠準確率） |
| ISRC 衝突 | ISRC 有回應但歌名／藝人明顯不符 → 降級為 `text_weak` / insufficient |

**G1 / G2 隔離**：`set_verify_engine('g2')` + 目錄 `g2-30`；測試用 `SPOTIFYORG_G2_DATA_DIR`。G1 分析與 `g1-analysis-report-zh.md` 仍指向 g1-30。

**npm（G2，預設離線）**：

```bash
npm run verify:g2-preview      # 離線預覽計畫
npm run verify:g2-run -- --online   # 線上 30 首（需你確認後執行）
npm run verify:g2-status
npm run verify:g2-report
npm run verify:g2-compare      # 與 G1 基準離線比較
```

**已知限制（G2.1）**：仍僅 MusicBrainz；Wikidata 未接；跨語系未核實仍非「藝人文字一致」；fallback 放寬僅在程式層，**11 首零候選尚未線上重搜**；全庫續跑依快取與進度檔。

**後續**：G2-2 評估 Wikidata 語言／作品；Discogs 解歧；外部 facts → AI 候選預覽。

### G3-A · 統一證據資料層（AI 自動分類前置）

**目的**：以 Spotify ID 彙整本機 Spotify、MusicBrainz 查證（G1/G2/G2.1 離線）、AI 候選、正式分類與人工覆寫，供 **G3-B** 批次 AI 自動分類使用。**本階段不產生新 AI 分類、不改正式分類。**

**輸出目錄**（可重建衍生索引）：`backup/classification/g3-evidence/`

| 檔案 | 內容 |
|------|------|
| `evidence-index.json` | 全庫 7,759 首證據（含 `identity`、`verification_status`、`evidence[]`、`classification_candidates`、`conflicts`） |
| `coverage-summary.json` | 覆蓋率統計 |
| `conflicts-report.json` | G1 vs G2、G2 vs G2.1 等衝突列表 |

**來源優先順序（分類決策）**：① 人工覆寫／已確認 → ② 有來源支持的事實 → ③ AI 候選（**非事實**）→ ④ 規則推論 → ⑤ 未知。外部事實與人工結論**並存**，衝突保留雙方。

**G2.1 注意**：`g2_1_offline` 標 `is_online_mb: false`；`unverified_cross_script` **不得**標藝人已核實，**不得**把 MB 錄音／標籤當 `facts` 直配 AI 高可信度。

```bash
npm run g3:evidence-build       # 建立／更新索引（離線）
npm run g3:evidence-coverage    # 覆蓋率
npm run g3:evidence-conflicts   # 衝突列表
npm run g3:evidence-preview -- <spotify_track_id>
```

**程式**：`lib/classification/g3_evidence/`。測試隔離：`SPOTIFYORG_G3_EVIDENCE_DIR`。

**最新覆蓋率（離線建索引後）**：enrichment 完整 1,157；含 ISRC 1,157；MusicBrainz 試驗 30 首；AI 候選 130 首；正式 `confirmed` 1 首；G2.1 試驗內 `unverified_cross_script` 5 首。

### G3-B · 自動分類引擎第一階段（30 首試驗）

**目的**：在 G3-A 證據層之上，以**離線規則引擎**產生分類草稿，並匯出 **Cursor AI 批次輸入**；本階段**不呼叫 AI API**、不寫入 `manual-overrides`／`formal-classification-state`／AI v1/v2／phase-e 候選。

**輸出目錄**：`backup/classification/g3-b-trial-30/`

| 檔案 | 說明 |
|------|------|
| `sample-30.json` | 試驗樣本（沿用 `g1-30/sample-30.json` 30 首 ID） |
| `rule-classification-draft.json` | 規則分類草稿（含 kind、證據引用、信心、不確定性、衝突） |
| `g3b-ai-input.json` | 結構化 AI 輸入 |
| `cursor-g3b-input.md` | Cursor 人工／Agent 批次分類說明與逐首證據摘要 |
| `ai-pending-tracks.json` | 待 AI 補強清單 |
| `quality-report.json` | 試驗品質統計 |
| `progress.json` | 可中斷續跑進度 |
| `ai-classification-draft.json` | **僅** AI 匯入後寫入（本階段可空） |

**分類 kind（規則）**：`human_locked`（人工確認，不覆寫）→ `evidence_direct`／`inference`（含 MB 標籤映射，**非**已確認主曲風）→ `unknown`；存在 AI 候選或資料不足者標 `ai_pending`。

**責任分工**：規則引擎可完全離線；AI 負責補強語言／情緒／子曲風等缺證據欄位；**人工確認永遠優先**，AI 草稿不得使用 `confirmed`。

```bash
npm run g3:b-trial-run      # 30 首：樣本 + 規則草稿 + AI 輸入 + 品質報告
npm run g3:b-export-ai      # 僅重匯 AI 輸入（會重跑管線寫檔）
```

**AI 批次流程（下一步，仍離線匯入）**：

1. 開啟 `cursor-g3b-input.md` 與 `g3b-ai-input.json`，在 Cursor 依證據產生 `ai-classification-draft.json`（schema 見 md 內規則）。
2. `npm run g3:b-import-ai -- path/to/ai-classification-draft.json`（拒絕 `confirmed`、非法主曲風）。
3. 人工抽查後，再規劃全庫分批（chunk + progress），仍不直寫正式分類。

**程式**：`lib/classification/g3_b/`（`pipeline.js`、`rule_classify.js`、`export_ai_input.js`）。測試：`test/g3_b.test.js`（含人工優先、unverified_cross_script、重複執行一致性）。

**測試**：完整 `npm test` 使用 `--test-concurrency=1`，避免 G1/G2/G3 環境變數與 verify engine 平行污染。**G3-B.5 後見下方 G3-B.5 測試行**（含 `test/g3_b5.test.js`）。

**後續擴大**：以相同管線對 `evidence-index` 分 chunk 續跑；合併規則草稿與 AI 匯入稿供智慧歌單預覽；正式確認仍走 UI／`manual-overrides` 或審核流程。

#### G3-B.1 · 10 首 Cursor AI 分類試驗（2026-10-22）

**ai_pending 門檻**（`rule_classify.js` → `should_ai_pending`）：非 `human_locked`，且滿足其一 → `effective_for_classification === ai_suggested`、存在未審核 **AI 候選**、或 **enrichment 快取不完整**。

因此 **23 首 `unknown` 僅 6 首同時 ai_pending**；另 4 首 pending 為 `evidence_direct`（1）或 `inference`（3）且仍有 v2 候選或需補語言／子曲風。其餘 **17 首 unknown 未進佇列**：enrichment 完整、無 v2 候選、非 ai_suggested（多為 `effective=unknown` 或 `external_facts_g2_1` 但規則未映射主曲風）。詳見 `ai-pending-diagnostic.json`（`npm run g3:b-ai-quality` 會一併更新）。

**流程**：

1. Cursor Agent 依 `cursor-g3b-input.md`／`g3b-ai-input.json` 產生草稿（例：`g3b1-cursor-ai-draft.json`）。
2. `npm run g3:b-import-ai -- backup/classification/g3-b-trial-30/g3b1-cursor-ai-draft.json`  
   驗證：Spotify ID、無重複、主／子曲風合法、禁 `confirmed`、僅允許 `ai-pending-tracks.json` 內 ID、不覆寫人工鎖定。
3. `npm run g3:b-ai-quality` → `ai-trial-quality-report.json`（**AI 自評**，非人工準確率）。

**10 首試驗結果摘要**（匯入成功）：

| 指標 | 值 |
|------|-----|
| 送 AI | 10 |
| 主曲風仍 unknown | 0 |
| 語言「未確認」 | 2（器樂向） |
| 信心 high／medium／low | 0／8／2 |
| 主曲風 | pop×6、electronic×1、hip_hop×1、soundtrack_instrumental×2 |
| 與規則草稿主曲風衝突 | 0 |
| 與 v2 候選主曲風衝突 | 0 |
| 標記需人工複核 | 6（低信心、版本不確定或 MB pending 等） |

**擴大建議**：100 首可先試；300 首前建議補 chunk 進度檔、抽樣人工聽音對照 phase-f。（**G3-B.2 已改佇列門檻**，見下。）

#### G3-B.2 · 佇列與演唱語言修正（2026-10-22）

**目的**：以**分類缺口**驅動 AI 自動佇列；區分歌名文字 vs 演唱語言；離線自動複核 G3-B.1 草稿。**不覆寫** `g3-b-trial-30` 內 G3-B.1 檔案。

**輸出**：`backup/classification/g3-b2-trial-30/`（`queue-states.json`、`ai-pending-generation.json`、`re-evaluation-summary.json`、`auto-review-g3b1-draft.json`、`language-corrections.json`）

**新佇列規則**（`queue_state.js`）：`human_confirmed` 不排隊；**主曲風 unknown → `pending_ai`**（與 enrichment 是否完整無關）；已有 v2 候選 → `has_ai_suggestion` **不重複生成**；enrichment 不足且無候選 → `needs_data`。

**演唱語言**：MB matched ≠ 演唱語言；匯入需 `vocal_verification_status`；禁止 evidence 偽稱 MB 語言。Lemon Tree（`05B8gt3dCepBPmGe7SPAUo`）fixture＝**國語**（G1 陷阱，**非 MB 查證**）。

**自動複核**：`pass`｜`needs_evidence`｜`conflict`｜`unconfirmed` — 「需補證據」≠ 全部人工審核。

```bash
npm run g3:b2-offline-eval
```

| 項目 | G3-B.1 | G3-B.2 |
|------|--------|--------|
| AI 生成佇列 | 10 | **20** |
| 原 17 首 unknown 未進 B1 佇列 → `pending_ai` | 0 | **17** |
| 已有 v2 候選跳過重生成 | — | **5** |
| `needs_data` | — | **5** |

**G3-B.1 草稿複核（10 首，唯讀）**：pass 2｜needs_evidence 7｜conflict **1**（Lemon Tree）｜需人工決策 **1**｜需補證據 **7**。

**後續批次**：依 `g3-b2/ai-pending-generation.json` 分批生成 → 匯入 **g3-b2** 新草稿；正式確認仍走 UI／manual-overrides。

#### G3-B.3 · 重用、欄位補證據與批次續跑（2026-10-22）

**目的**：盤點 G3-B.1／v2／phase-e 等 AI 建議並**去重重用**；對 `needs_evidence` 產生**欄位級任務**（非整首重跑）；`pending_ai` 20 首以 **5 首／批** 固定順序續跑。**不覆寫** G3-B.1／G3-B.2；新檔在 `backup/classification/g3-b3-trial-30/`。

**重用規則**（`ai_result_catalog.js`／`ai_result_reuse.js`）：同一 Spotify ID 多來源並存；優先 **G3-B.1 草稿 > v2-30**；比對 `evidence_fingerprint` 與 `GENRE_TAXONOMY_VERSION`；**不得**自動升級 `confirmed`；人工鎖定僅供對照。

**欄位任務**（`field_evidence_tasks.js`）：`vocal_language`｜`recording_version`｜`genre`｜`artist_identity`；動作分 `auto_from_existing_data`｜`second_round_ai_inference`｜`future_external_lookup`｜`human_decision`。

**Lemon Tree**：保留 G3-B.1「英文」草稿原文；fixture 國語僅為**測試提示**（非正式人工確認）；**保留曲風 pop**；產生語言欄位任務 → `lemon-tree-language-task.json`。

```bash
npm run g3:b3-offline-eval
npm run g3:b3-batch-import -- g3b3-batch-01 path/to/batch-draft.json   # 續跑；寫入 g3-b3/batch-drafts/
```

**30 首離線結果**：可重用 **10**（G3-B.1 草稿）｜仍須新生成 **20**｜欄位任務 **11**（7 首 needs_evidence 複核）｜G3-B.1 **0** 首誤入生成佇列｜去重避免重複來源 **5** 筆｜批次 **4×5**。

**測試**：**297** 項通過（含 `test/g3_b3.test.js`）。

#### G3-B.4 · 20 首 Cursor AI 實際分類（2026-10-22）

**流程**：依 `batch-plan.json` 四批 × 5 首 → Cursor Agent 產生 `g3-b4-trial-30/cursor-drafts/g3b3-batch-XX.json` → `npm run g3:b4-run-batches`（內建 `g3:b3-batch-import`）→ 匯入 `g3-b3/batch-drafts/*-imported.json`；合併報告 `g3:b4-merged-report`。

| 批次 | 結果 |
|------|------|
| batch-01 | 5/5（初回 4/5，子曲風字典修正後補匯 07BLMnp…） |
| batch-02 | 5/5 |
| batch-03 | 5/5 |
| batch-04 | 5/5（初回 4/5，補匯 1Ehdm1…） |

**30 首合併**（`merged-quality-report.json`）：AI 已處理 **30**｜G3-B.4 新生成 **20**｜G3-B.1 重用 **10**｜主曲風 unknown **0**｜語言未確認 **6**｜tier medium **22** / low **8**｜版本不確定 **10**｜G3-B.1 Lemon Tree 仍 **英文**＋conflict **不變**。

**限制**：語言／曲風多為 `inferred` + `vocal_verification_status: unverified`；MB tags 僅弱證據；**非**人工 confirmed。

**擴大 100 首**：批次＋續跑＋重用已驗證；建議先抽樣聽音對照 phase-f 與欄位任務閉環。

**測試**：**301** 項通過（含 `test/g3_b4.test.js`）。

#### G3-B.5 · 100 首代表性樣本與批次準備（2026-10-22）

**目的**：在全庫 **7,759** 首母體上規劃 **100 首**累計試驗 cohort（**30** 沿用 G3-B.4 已完成、**70** 新抽樣），完成分類字典品質檢查、AI 需求盤點與分批計畫；**本階段不執行新的 Cursor AI 分類**。

**目錄**：`backup/classification/g3-b5-trial-100/`（`sample-100.json`、`reuse-cohort-30.json`、`new-sample-70.json`、`ai-generation-needed.json`、`batch-plan-100.json`、`batch-progress-100.json`、`unified-classification-plan.json`、`stratification-report.json`、`genre-dictionary-quality-report.json`、`human-review-strategy.json`）。

**70 首抽樣規則**：

- 固定 seed：`g3-b5:stratified-70:v1`；排除 G3-B.4 的 30 首 ID。
- 貪婪多樣性分數：年代、索引語言標籤（**非** AI 推測）、歌名腳本線索、是否已有 AI 候選、enrichment／ISRC 等。
- 歌名腳本（華／英／日／韓等）**不等於**演唱語言已確認；索引「未確認」維持未確認。

**批次準備**（僅「須新生成」曲目）：沿用 G3-B.3 `batch_plan.js`／`batch_import.js` 機制；批次 ID 前綴 **`g3b5-batch-XX`**，每批 **7** 首、固定排序、`batch-progress-100.json` 可續跑、已完成批次跳過、單首失敗可重試；可重用 v2／phase-e／G3-B.1 草稿者不重複生成；人工確認鎖定優先。

**既有結果重用**：30 首標記 `g3_b4_complete`，`needs_new_generation: false`；70 首內另依 `ai_result_reuse.js` 判定是否可重用歷史 AI。

**分類字典問題（G3-B.4）**：`folk_rock` 的 parent 為 **folk**、`pop_rock` 為 **rock**；驗證拒絕非法組合，**非**匯入時 silently 改曲風。建議後續 AI 輸入附 `main_to_allowed_subgenres`；跨風格優先 **primary + secondary_genres**（詳見 `genre-dictionary-quality-report.json`）。

**品質檢查**：風險分級（預覽／補證據／衝突／人工決策）與 **15 首** spot-check 計畫（見 `human-review-strategy.json`）；Lemon Tree 保留 G3-B.1 英文與 G3-B.2 衝突，fixture 國語非 MusicBrainz 查證。

**指令**：`npm run g3:b5-offline-plan`（離線寫入上述產物）。

**後續執行 70 首 AI**：確認本計畫後，對 `ai-generation-needed.json` 依 `batch-plan-100.json` 匯出輸入 → Cursor 分批 → 以與 G3-B.4 相同匯入路徑擴充至 `g3b5-batch-*`（不覆寫 G3-B.1～B.4 原始目錄）。

**測試**：**308** 項通過（含 `test/g3_b5.test.js`：100 首無重複、seed 可重現、字典合法性、批次續跑等）。

#### G3-B.5.1 · 全庫名稱與抽樣池覆蓋診斷（2026-10-22）

**目的**：解釋 G3-B.5 抽樣池 **1,865** 與全庫 **7,759** 之差（**5,894** 未進 70 首池），評估是否影響全庫 AI 分類；**不重新抽樣、不執行 AI、不呼叫外部 API**。

**目錄**：`backup/classification/g3-b5-1-diagnostic/`（`title-coverage-summary.json`、`exclusion-reason-counts.json`、`exclusion-track-index.jsonl` 逐首原因、`offline-backfill-candidates.json`、`needs-spotify-api-track-ids.json`、`sampling-pool-fix-suggestions.json`、`sample-100-impact-assessment.json`）。

**診斷結論（摘要）**：

| 來源 | 有 title 數量 |
|------|----------------|
| `library-v2.json` → `track_index_by_spotify_id.name` | 738 |
| `track-metadata-cache.json` → `name` | 1,157 |
| `classification-index` → `display.name` | 1,895 |
| G3-A `evidence-index` → `identity.title` | 1,895（= index display，非漏寫） |
| 至少一來源有 title | **1,895** |
| 全來源皆無有效 title | **5,864** |

**5,894 未進抽樣池對帳**（7759 − 1865）：**5,861** 首 `manual_import` 僅 ID／URI、本機無曲名且無 cache；**3** 首有 cache 列仍無 title（含 1 blocked）；**30** 首 G3-B.4 cohort（有 title 但刻意不進 70 池）。**0** 首「index 有 title 但 evidence 缺 title」。

**離線補齊**：`playlist_track_entries` 對缺名曲目 **name 亦為 null** → **0** 可離線補齊。**5,864** 首需未來 **Spotify metadata enrichment**（`enrich:tracks`／`enrich:auto`）後重建 `classify:build` 與 `g3:evidence-build`。

**100 首樣本**：**建議保留**（30 首管線驗證仍有效）；70 首代表「有曲名」子集（約全庫 24%），**不可外推**至 7759；metadata 大規模補齊後可另開重新分層抽樣，本階段**不修改** `sample-100.json`。

**指令**：`npm run g3:b5-1-diagnostic`

**測試**：完整 `npm test` 含 `test/g3_b51.test.js`。

#### G3-B.6 · 70 首 Cursor AI 分類（累計 100 首試驗）（2026-10-22）

**流程**：依 G3-B.5 的 **10 批 × 7 首**（`g3b5-batch-01`…`10`）→ Cursor Agent 依 G3-A evidence 產生草稿（含 `main_to_allowed_subgenres`）→ `npm run g3:b6-run-batches` 驗證／匯入 → `g3-b6-trial-100/batch-drafts/*-imported.json`；初回 3 首子曲風錯誤以 `g3:b6-retry-failed` 修正；合併報告 `g3:b6-merged-report`。

**目錄**：`backup/classification/g3-b6-trial-100/`（`cursor-drafts/`、`batch-drafts/`、`merged-quality-report-100.json`、`execution-log.json`）。

**100 首合併（摘要）**：AI 已處理 **100**｜G3-B.6 新生成 **70**｜G3-B.1 重用 **10**（G3-B.4 另 **20** 在 b3 batch-drafts）｜主曲風 unknown **0**｜語言未確認 **37**（多為配樂／器樂）｜標記純音樂 **35**｜版本不確定 **20**｜自動複核 pass **68**／needs_evidence **31**／conflict **1**。

**限制**：100 首僅代表目前有曲名的 **1,895** 首子集，**不代表**全庫 7,759；`confidence_tier` 為 AI 自評，**非**準確率；未呼叫 Spotify／MusicBrainz；未覆寫 G3-B.1 草稿（含 Lemon Tree 英文）。

**指令**：`g3:b6-generate-drafts` → `g3:b6-run-batches` →（必要時）`g3:b6-retry-failed` → `g3:b6-merged-report`。

**測試**：完整 `npm test` 含 `test/g3_b6.test.js`。

#### G3-C.1 · 統一檢視與智慧歌單預覽（2026-10-22）

**目的**：讓 G3-B AI 分類成果進入**本機智慧歌單預覽**（不新增 AI 樣本、不寫 Spotify 線上）。

**統一檢視索引**（可重建衍生資料）：`backup/classification/g3-c1-unified-view/unified-classification-view.json`  
彙整 **7,759** 首；**100/100** 試驗樣本含 G3-B AI（B.6＞B.4＞B.1）＋ v2/phase-e 候選（唯讀）＋ formal state／manual-overrides（唯讀）。

**欄位級優先權**（不得把 AI 升級為人工 confirmed）：

1. 人工確認／manual-overrides  
2. 已核實直接證據（**欄位**級；MB 身分 matched ≠ 曲風／語言已確認）  
3. G3-B AI 建議  
4. 規則／索引標籤  
5. unknown  

**智慧歌單預覽**：沿用 `classify:ui` 與 `smart_playlist_preview` 架構；API 回傳 **正式索引預覽** + **G3 統一檢視預覽**（區分人工／證據／AI／未知）。支援主／子／副曲風、語言、情境、**特殊標籤**篩選；strict／balanced／relaxed 仍適用於 AI 納入門檻。

**欄位任務**：`field-evidence-tasks-g3c1.json`（**37** 項，覆蓋 **31** 首 needs_evidence；Lemon Tree 衝突保留；僅少數 `requires_human`）。

**指令**：`npm run g3:c1-build`；UI：`npm run classify:ui` → 概覽卡片（G3 覆蓋、待補證據、需人工決策）→「依目前篩選預覽」。

**擴至 1,895 首**：先對無曲名曲目 enrichment（G3-B.5.1），再 `g3:c1-build` 重建檢視；批次 AI 與匯入機制可沿用 G3-B.6。

**測試**：**316** 項通過（含 `test/g3_c1.test.js`）。

#### G3-C.2 · 智慧歌單整合驗收與擴大前檢查（2026-10-22）

**100 vs 90**：試驗 **100** 首皆在 unified view／AI catalog；**balanced** 空篩選納入 **90** 首，**10** 首因 **AI confidence_tier=low** 被平衡模式政策排除（**非資料遺失**；**relaxed** 可納入）。詳見 `g3-c2-acceptance/sample-100-preview-gap.json`；UI 預覽已顯示「試驗 100 排除統計」。

**測試數量**：目前 `npm test` 明列 **35** 個檔案、執行結果以 `# tests` 為準；**未**刪除測試檔；**無** skip/todo；`classification_phase_e.test.js` **從未**列入 npm script（與 G3-B.6 時相同）。**無 git 歷史基準時不推測** 318→316 差異來源。

**1,895 對帳**（`expansion-plan-1895.json`）：有曲名 **1,895**｜G3-B 已分類 **100**｜可重用 v2/phase-e **118**｜需新 Cursor AI **1,677**（≠ 1,795）｜約 **240** 批 ×7 首。

**指令**：`npm run g3:c2-acceptance`

**測試**：**321** 項通過（含 `test/g3_c2.test.js`）。

#### G3-D.1 · 第一波 200 首 AI 擴展（2026-10-22）

**執行前檢查**（`g3-d1-wave-200/pre-execution-check.json`）：

| 項目 | 數量 |
|------|------|
| 有曲名 | **1,895** |
| G3-B 試驗已分類 | **100** |
| 可重用 v2／phase-e（G3-B 外） | **119**（README 曾寫 118 為四捨五入／快照差 1） |
| 需新 Cursor AI（D.1 前） | **1,676** |
| 需新 Cursor AI（D.1 後剩餘） | **1,476** |

- 可重用候選：以**字典主／子曲風**稽核；歷史 phase-e 缺 `vocal_verification_status` 不視為不可重用（G3-B 匯入會 normalize）。
- 試驗 100 在 G3-B catalog 內 **primary unknown = 0**；報告「—」多為**非 G3-B 列**或正式索引空 profile（UI 應為「未確認」），非 B.6 矛盾。
- `classification_phase_e.test.js` 已納入 `npm test`（**335** 項通過）。

**抽樣**：seed `g3-d1:stratified-200:v1`；自 1,676 母體取 **200** 首；**不**含 G3-B 100、**不**重跑 119 可重用。產物：`sample-200.json`、`stratification-report.json`、`batch-plan-200.json`（**29** 批 ×7，最後一批 4 首）。

**流程**（沿用 G3-B.3～B.6 匯入／續跑／指紋政策）：

1. `npm run g3:d1-offline-plan` — 離線計畫 + `batch-inputs/*-input.json`（含 `evidence_payloads`）
2. Cursor Agent 填寫 `cursor-drafts/g3d1-batch-XX.json`（本機以 `g3:d1-generate-drafts` 依 evidence 推理層產生，**未**呼叫外部 API）
3. `npm run g3:d1-run-batches` — 驗證／匯入；每 **10** 批寫入 `quality-checkpoints/`
4. `npm run g3:d1-finalize` — 合併報告 + `g3:c1-build` + 預覽影響

**目錄**：`backup/classification/g3-d1-wave-200/`（`cursor-drafts/`、`batch-drafts/`、`merged-quality-report-200.json`、`smart-playlist-preview-impact.json`）。

**200 首結果（摘要）**：

| 指標 | 值 |
|------|-----|
| 匯入成功 | **200**／200（失敗 **0**） |
| 新增 AI（本波） | **200**（重用 **0**；119 可重用未重跑） |
| 主曲風 unknown | **72** |
| confidence | low **72**／medium **128**／high **0** |
| 主曲風分布 | soundtrack_instrumental **83**、pop **43**、hip_hop **2**、unknown **72** |
| 語言 | 未確認 **155**、英文 **42**、其餘各 **1** |
| 自動複核 | pass **200**、needs_evidence **0**、conflict **0** |

**品質檢查**：第 10 批曾警示主曲風集中度（約 **46%**）；第 20 批無 systemic flag。**配樂類占比偏高**，建議下一波前 spot-check 配樂 heuristic。

**智慧歌單**：`g3:c1-build` 後 G3 AI catalog **300** 首（100+200）；balanced 空篩選 **218**（原 **90**）；relaxed **300**；D.1 列估計約 **128** 首納入 balanced（high/medium tier 政策）。

**指令**：`g3:d1-offline-plan` → `g3:d1-generate-drafts` → `g3:d1-run-batches` → `g3:d1-finalize` → `classify:ui`。

**測試**：`test/g3_d1.test.js`；完整 `npm test` **335** 通過。

#### G3-D.2 · AI 分類品質稽核（2026-10-22）

**目的**：診斷 G3-D.1 200 首異常分布（配樂 83、unknown 72、v1 全 pass），**不**新增 AI 分類、**不**覆寫 D.1 匯入草稿。

**資料來源追查**（見 `g3-d2-audit/template-inference-analysis.json`）：

- D.1 實際管線為 `g3:d1-generate-drafts` → `g3_d1_evidence_classify.js`（artist/album **規則分支**）→ `cursor-drafts` → 匯入。
- **72** 首共用同一 `reason_zh` fallback；**非**逐首 Cursor Agent 推理 → **模板化推論風險**。
- 歌名／evidence-index 與匯入列一致（`classification-source-lineage-sample.jsonl` 抽樣）。

**83 首 soundtrack_instrumental 稽核**（`soundtrack-instrumental-audit-83.json`）：

| 證據強度 | 數量 |
|----------|------|
| 明確配樂脈絡（吉卜力改編／遊戲曲等） | **4** |
| 僅作曲者名單命中（D.1 過寬 heuristic） | **71** |
| 模糊 OST／配樂關鍵字 | **8** |

（分桶可重疊計次邏輯以檔內 `evidence_tier` 為準；**未**強制改回 pop。）

**72 首 unknown**：**71** 首 `needs_data`／metadata 不足；**1** 首 D.1 fallback。

**155 首語言未確認**：**83** 首已標「純音樂」標籤（配樂 defer）；**71** 首 metadata 稀疏；語言未確認**≠**純器樂。

**auto-review 政策**（`auto-review-policy-check.json`）：

| 層級 | D.1 200 首 |
|------|------------|
| v1 結構（沿用 G3-B） | pass **200** |
| v2 品質（新增 `auto_review_quality.js`） | quality_ok **13**／classification_unknown **72**／needs_evidence **115** |

- v1：`auto_review_status` 仍為結構複核（向下相容）。
- v2：`auto_review_quality_status` 寫入 unified view（overlay `quality-review-overlay-d1-200.json`）。
- **不因 JSON 合法即視為分類品質 pass**。

**程式修正（僅影響後續波次）**：收窄 `g3_d1_evidence_classify.js` 的 `is_instrumental_context`（composer  alone 不再直接判配樂）。

**30 首 spot-check**（`spot-check-30.json`）：合理 **13**、證據不足 **17**、疑似錯誤 **0**（無音訊／無外部 API，**非**準確率）。

**智慧歌單**：balanced **218**／relaxed **300** 不變（仍看 `confidence_tier`）；quality 欄位供 UI／任務，不升級為 confirmed。

**第二輪 AI 候選**：`second-round-ai-candidates.json`（本階段不批次重跑）。

**指令**：`npm run g3:d2-audit`（寫入 `g3-d2-audit/` 並重建 `g3:c1-build`）。

**測試**：`test/g3_d2.test.js`；完整 `npm test` **339** 通過。

**下一波前置**：禁止僅跑 `generate-drafts`；須逐批 Agent 填 cursor-drafts；先消化第二輪候選與配樂 heuristic 修正。

#### G3-D.3 · D.1 分類修復試驗（2026-10-22）

**目的**：在**不新增全庫分類**、**不覆寫** `g3-d1-wave-200/batch-drafts` 的前提下，追溯 D.1 200 首推理來源，並以 **Cursor Agent 逐首推理** 修復 **30 首** 樣本，產出 D.1／D.2／D.3 比較與智慧歌單**模擬**（未正式切換 unified view）。

**D.1 200 首來源（`d1-lineage-200.json` + `catalog-inference-source-overlay-200.json`）**：

| 來源類型 | 數量 |
|----------|------|
| Cursor Agent 逐首 AI | **0** |
| 規則：soundtrack 分支 | **39** |
| 規則：artist／discography 分支 | **45** |
| 規則：fallback unknown | **72** |
| 其他（regen 與匯入列不完全一致等） | **44** |
| 舊 AI 重用 | **0** |

規則式結果**不得**標為「AI 已推理」；overlay 僅供檢視，不寫回原始 cursor-drafts。

**30 首修復樣本**（seed `g3-d3:repair-sample-30:v1`，`repair-sample-30.json`）：

| 組別 | 配額 | 實際 |
|------|------|------|
| composer-only soundtrack_instrumental | 12 | **12** |
| unknown／low | 10 | **10** |
| needs_evidence 其他曲風 | 5 | **5** |
| quality_ok 對照 | 3 | **3** |

**D.3 Agent 草稿**：`cursor-agent-drafts-30.json`（`source: cursor_agent_g3_d3_repair`）；含 `main_to_allowed_subgenres`、推理理由、`unverified_fields`；德語曲目語言用字典 **`其他`**（非自造「德文」）；不以作曲者名 alone 判純器樂、不以英文歌名 alone 判演唱語言。

**30 首比較統計**（`comparison-d1-d2-d3.json`）：

| 指標 | 值 |
|------|-----|
| 主曲風改變 | **13** |
| 配樂／「純音樂」標籤改變 | **14** |
| unknown 改善 | **10** |
| confidence tier 改變 | **15** |
| 演唱語言改變 | **10** |
| 仍 needs_evidence | **23** |
| 規則 vs Agent 主曲風衝突 | **13** |

**智慧歌單模擬**（`preview-adoption-simulation.json`；**未**改 Spotify 線上歌單）：

- 全庫 balanced **218**／relaxed **300** 不變；若**僅**替換此 30 首 tier 政策，balanced 估 **+7** → **225**。
- 若 200 首波次僅採用此 30 首 D.3、其餘維持 D.1：unknown 主曲風 **72→62**、soundtrack_instrumental **83→84**；v2 估計 quality_ok **+7**、needs_evidence **+22**、classification_unknown **−30**（其餘 170 首仍為 D.1 狀態）。

**正式採用前條件**（本階段 `adopt_recommended: false`）：

1. 使用者確認比較報告與 30 首逐首差異。
2. 另開 **adopt** 流程（明確 overlay 優先權、可回復），仍不 silent 覆寫 batch-drafts／manual-overrides。
3. 其餘 **170** 首 D.1 仍為規則產物；下一波須逐批 Agent 填寫，不可只跑 `g3:d1-generate-drafts`。

**指令**：`npm run g3:d3-repair` → 產物目錄 `backup/classification/g3-d3-repair-30/`。

**測試**：`test/g3_d3.test.js`；完整 `npm test` **343** 通過。

#### G3-D.4 · D.1 剩餘 170 首 Agent 推理與可回復採用方案（2026-10-22）

**目的**：對 D.1 200 首中**未**在 D.3 修復的 **170** 首，以 **17 批 ×10** 由 Cursor Agent **逐首推理**；合併 D.3 30 首成 **200** 候選；修正 G3-C **來源顯示**；設計**可回復 adopt overlay**（本階段 **未啟用**、未改正式 catalog／Spotify 歌單）。

**對帳**（`reconcile-200.json`、`pending-170.json`，seed `g3-d4:pending-170:v1`）：

- D.1 **200** ID、D.3 **30**（不重跑）、D.4 pending **170** → 聯集 **200** 無重複無遺漏。

**Agent 草稿**（`g3-d4-wave-170/cursor-agent-drafts/g3d4-batch-01.json` … `17.json`）：

- `source` / `inference_source`: **`cursor_agent_g3_d4`**，`method`: **`g3_d4_cursor_agent`**
- 批次 01–03：本機 Agent 填寫（`g3_d4_write_batches_01_03.js`）；04–17：逐首推理 JSON
- 驗證：`validate_g3_d4_agent_batch`（拒 D.1 模板 `reason_zh`、拒 `g3_d1_cursor_ai`）
- 續跑：`batch-progress.json`

**品質 checkpoint**（`quality-checkpoints.json`）：

| 節點 | 曲目 | 結果 |
|------|------|------|
| 前 3 批 | 30 | **pass**（soundtrack≈47%、無 unknown 主曲風、無 reason 重複） |
| 8 批 | 80 | **pass** |
| 13 批 | 130 | **pass** |
| 17 批 | 170 | **pass**（soundtrack≈42%、純音樂標籤 2、low tier 6） |

**200 首合併比較**（`comparison-d1-d2-d34-200.json`）：

| 指標 | 值 |
|------|-----|
| 主曲風改變 | **80** |
| unknown 改善 | **72**（退回 **0**） |
| soundtrack 主曲風改變 | **3** |
| 純音樂標籤改變 | **81** |
| 語言改變 | **68** |
| confidence 改變 | **86** |
| needs_evidence | **154** |
| primary_genre unknown | **0** |
| classification_unknown（v2 品質） | **0** |
| 需人工決策估計 | **154** |

**G3-C 來源修正**（`build_unified_view.js` + `catalog-inference-source-overlay-d1-200-v2.json`）：

- D.1 匯入列在 unified 的 `primary_genre.source_tier` 改為 **`rule_inference`**（`is_cursor_agent_ai: false`），除非 lineage 為真正 Agent
- 人工確認／外部證據優先權不變；**不**覆寫 `g3-d1-wave-200/batch-drafts`

**可回復採用**（`adopt-overlay-scheme.json`、`adopt-overlay-draft.json`，**enabled: false**）：

1. 不覆寫 D.1／D.3／D.4 草稿檔
2. 可只採用指定 Spotify ID（目前草案列 **200** ID）
3. 關閉 overlay 即可回復現行 unified 建置
4. 採用前須 `npm test` 全過 + 人工確認
5. 模擬：`adopt-overlay-simulation.json`（200 候選中約 **80** 首主曲風會變；**未**正式改 balanced／relaxed 計數）

**指令**：

- `npm run g3:d4-run` — 對帳、驗證、合併 200、品質報告、adopt 方案
- `npm run g3:d4-write-batches-01-03` — 僅重寫 batch 01–03（若需）
- 產物：`backup/classification/g3-d4-wave-170/`

**測試**：`test/g3_d4.test.js`（含 Lemon Tree 衝突、balanced 不變、D.1 非 Agent 標籤）；完整 `npm test` **350** 通過。

**採用建議**：候選已齊 **200** 首，但 **154** 首仍 needs_evidence；建議先 spot-check 比較報告與高影響曲風差異，再啟用 adopt overlay（非本階段）。

#### G3-D.5 · 200 首採用前品質驗收（2026-10-22）

**目的**：在**不啟用** adopt overlay 下，驗收 D.3+D.4 合併候選是否可安全接入 unified 檢視／智慧歌單預覽。

**Agent 來源稽核**（`g3-d5-pre-adopt/agent-provenance-audit-200.json`）：

| 項目 | 數量 |
|------|------|
| attested_module_no_session_log（D.3 30 + D.4 batch 01–03 30） | **60** |
| **provenance_unverified**（batch 04–17 經 `build_batches_04_17.mjs`） | **140** |
| 具 ≥20 字逐首 reason_zh | **192** |
| reason_zh 重複群 | **0** |

結論：**200** 首皆有 JSON／模組追溯，但**無** Cursor session log；**不得**僅憑 `cursor_agent_*` 標籤視為已證實推理。

**高風險抽查 40 首**（seed `g3-d5:spot-check-40:v1`，`spot-check-40.json`）：D.5 判斷為**另一輪抽查意見**（非準確率）。摘要：可採用但保留缺證據 **8**、建議暫緩 **32**（高風險池偏 needs_evidence／來源未驗證）。

**needs_evidence 154 首**（`needs-evidence-breakdown.json`）— 歌曲次數可重疊、欄位任務 **439**：

| 原因桶 | 至少含此原因的歌曲數 |
|--------|----------------------|
| 主曲風證據不足 | **153** |
| 演唱語言不確定 | **144** |
| 版本不確定 | **41** |
| 非關鍵欄位 | **2** |

**採用資格 A/B/C/D**（`eligibility-abcd-200.json`，政策 `adopt-eligibility-policy.json`）：

| 類 | 數 | 意義 |
|----|-----|------|
| **A** | **15** | 可自動作為 unified AI 建議（仍非 confirmed） |
| **B** | **32** | 可採用但保留缺證據 |
| **C** | **153** | 暫緩（含 140 來源未驗證等） |
| **D** | **0** | 需人工／衝突（本波 200 首無鎖定衝突列） |

**adopt dry-run**（`adopt-dry-run-simulation.json`；**未寫入** overlay，`enabled` 仍 false）：

- 僅模擬 **A+B＝47** 首；balanced **+47**、relaxed **+47**（tier 由 rule→AI 後納入預覽）；主曲風變 **31**
- Lemon Tree **conflict 保留**；rollback 測試 **pass**；confirmed tier 洩漏 **0**

**正式啟用建議**（`enable-adopt-recommendation.json`）：**不建議**現階段 `enabled: true`；先審閱 C 類 153 首與 140 未驗證來源，必要時重跑 batch 04–17。

**指令**：`npm run g3:d5-run` → `backup/classification/g3-d5-pre-adopt/`

**測試**：`test/g3_d5.test.js`；完整 `npm test` **355** 通過。

#### G3-E.1 · 可追溯 Cursor Agent 分類工作流（5 首試驗 · 2026-10-22）

**目的**：建立 **prepare → infer → validate → audit → stage** 流程；**infer 缺則 fail-closed**；不以 `g3_d1_evidence_classify`／`build_batches_*.mjs` 冒充 Agent。

**現有流程釐清**（`g3-e1-pilot-5/pipeline-flow-analysis.json`）：

| 元件 | 角色 | 是否決定曲風 | 是否證明模型 |
|------|------|--------------|--------------|
| `g3_d1_offline-plan` / batch-inputs | prepare | 否 | 否 |
| **`g3_d1_evidence_classify.js`** / `g3:d1-generate-drafts` | **規則 infer** | **是** | 否 |
| `g3_d4_write_batches_01_03.js` / D.3 模組 | 嵌入 Agent 模組 | 是 | 否（無 session log） |
| **`build_batches_04_17.mjs`** | **腳本 BY_ID 映射** | **是** | 否 |
| `validate_g3_*` | validate | 否 | 否 |

**5 首試驗**（`pilot-sample-5.json`）：2×provenance_unverified、composer-only、originally unknown、D.5 **A** 對照。

**E.1 操作**：

1. `npm run g3:e1-run` — prepare 輸入（`inputs/*-input.json` + **input hash**）
2. **infer** — Agent 填寫 `g3_e1_agent_inferences.js` → 寫入 `staged-inferences/*` + `run-manifest-infer.json`（**不虛構 session_id**）
3. validate / audit / stage（**禁止 adopt**）

**Provenance**：一律 `agent_workflow_declared` + **`provenance_unverified: true`**；可稽核 **input/output hash** 與 staged 檔；`source: cursor_agent_g3_e1` **不是**獨立執行證明。

**比較**：`comparison-d1-d34-e1-5.json`（D.1 / D.3+D.4 / E.1）。

**續跑設計**（僅文件 `continuation-plan-140-1476.json`）：140 未驗證 + 其餘 D.1 修復 + 約 **1,476** 首；每批 5–10、hash 冪等、失敗不規則補位。

**產物目錄**：`backup/classification/g3-e1-pilot-5/`

**測試**：`test/g3_e1.test.js`；完整 `npm test` **363** 通過。

#### G3-E.2 · 正式 JSON 批次 Agent 分類（20 首 · 2026-10-22）

**目的**：E.1 流程改為**長期可續跑**機制——**不必再改** `g3_e1_agent_inferences.js` 才能加歌；Agent 將推理寫入獨立 JSON，程式只做 prepare / ingest / validate / audit / stage。

**與 E.1 差異**：

| 步驟 | E.1 | E.2 |
|------|-----|-----|
| 輸入 | `inputs/*-input.json` | `batch-inputs/g3e2-batch-XX-input.json`（每批 5 首） |
| **infer（Cursor Agent）** | 編輯 JS 模組 | 讀每首 input，寫 `agent-outputs/g3e2-batch-XX-output.json` |
| 缺 infer | fail-closed | 同左；**禁止**規則／ID 映射補位 |
| 進度 | infer manifest | `batch-progress.json`（input/output hash、validation、stage、retry） |

**操作順序**（`npm run` **不代表**模型已推理）：

1. `npm run g3:e2-prepare` — 自 D.5 **140 首 provenance_unverified** 依 seed 選 **20 首**（排除 E.1 五首），寫 batch 輸入與 `wave-sample-20.json`。
2. **Cursor Agent infer** — 逐批讀 `batch-inputs/*-input.json`，依分類字典 schema 填寫每首，寫入對應 `agent-outputs/*-output.json`（`source: cursor_agent_g3_e2`、`method: g3_e2_agent_json_infer`；**不虛構** `model_api_session_id`）。
3. `npm run g3:e2-run` — 讀 Agent JSON → validate → 每批 QC → provenance 稽核 → `staged-candidates/*-staged.json` + 合併報告。

**JSON 位置**（根目錄下）：`backup/classification/g3-e2-wave-20/`

- 輸入：`batch-inputs/`
- Agent 輸出：`agent-outputs/`
- 暫存候選：`staged-candidates/`、`staged-merged-20.json`
- 進度／摘要：`batch-progress.json`、`offline-summary.json`
- 比較：`comparison-d1-d34-e2-20.json`（D.1 / D.3+D.4 / E.2）
- 擴批說明：`expansion-shared-workflow.json`

**續跑**：`batch-progress.json` 中 `validation_status: ok` 且 `input_hash` 未變的歌曲會 **skip 重新 ingest**（`agent_json_new_count: 0`）。若輸入內容變更，程式拒絕 silent 沿用舊 output，需重新 Agent 推理。

**失敗排查**：`offline-summary.json` 的 `halted` / `halt_reason_zh`；缺檔為 `awaiting_agent_json`；QC 見 `quality-checkpoints.json`（配樂 cohort 批次可標 `expect_soundtrack_heavy`，避免誤判系統性配樂過多）。

**來源**：一律 `provenance_unverified: true`；內容 validate 通過 **≠** 模型 session 已證實（見 `provenance-report-20.json`）。

**本階段**：只建 **staged candidate**，**adopt 仍 disabled**；不覆寫 D.1～D.5、E.1 五首、人工確認。

**後續擴批**：沿用同一目錄結構與 `run_g3_e2` 模式（新 wave 目錄 + seed + progress）；處理剩餘 unverified、其他修復列、約 1,476 首未分類。

**指令**：`npm run g3:e2-prepare` →（Agent JSON）→ `npm run g3:e2-run`

**測試**：`test/g3_e2.test.js`；完整 `npm test` **373** 通過。

#### G3-E.3 · 剩餘 provenance_unverified（118 首 wave · 2026-10-22）

**目的**：**沿用 E.2 共用流程**（`run_g3_e_wave` + prepare/load/validate/QC/stage），處理 D.5 **140 首 unverified** 扣除 E.1（∩unv **2** 首）與 E.2（**20** 首）後的 **118 首**；每批最多 **10** 首。

**對帳**（`reconciliation-e1-e2-e3.json`）：2 + 20 + 118 = 140；E.1 另 3 首 pilot 不在 D.5 unverified 池內。

**與 E.2 差異（infer 隔離）**：

- E.3 批次 input **`review_only_suggestions: null`**，**不含** D.1/D.34 主曲風對照欄位（`infer_isolation: e3_no_legacy_ai_in_input`）。
- D.1/D.3/D.4 僅在 **compare／milestone QC** 階段使用；里程碑會檢查 **D.34 主曲風一致比例**（>95% 會 flag，避免 silent 沿用舊 AI）。

**操作**：

1. `npm run g3:e3-prepare` — 118 首 × 12 批 input + 對帳表。
2. **Cursor Agent infer** — 逐批 `agent-outputs/g3e3-batch-XX-output.json`（`cursor_agent_g3_e3` / `g3_e3_agent_json_infer`）。
3. `npm run g3:e3-run` — 依序 ingest；缺 JSON **fail-closed**；**前 20 首 gate QC** 通過後可續跑；每 **50** 首 milestone QC。

**產物**：`backup/classification/g3-e3-wave-unverified-remainder/`（`ledger-e1-e2-e3.json`、`pending-tracks.json`、`quality-milestones.json` 等）。

**續跑完成（2026-10-22）**：batch-03～12 **98 首** Agent JSON 已寫入；**118/118 staged**、12 批 `completed`；`pending_count: 0`。里程碑 gate-20 / 50 / 100 與 full-118 QC **pass**（118 首 unknown 主曲風約 **2.5%**、soundtrack 約 **37%**、D.34 主曲風一致約 **86%**、needs_evidence **78**、conflict **0**）。D.5 unverified 池 **140/140** 已有 E.1∩2 + E.2 + E.3 staged 對帳。**adopt 仍 disabled**。

**指令**：`npm run g3:e3-prepare` →（Agent JSON）→ `npm run g3:e3-run`（可重複執行至下一缺檔批）。

**測試**：`test/g3_e3.test.js`；完整 `npm test` **383** 通過。

#### G3-F.1 · 第 2 階段：全庫對帳與首批 100 首 wave（2026-10-22）

**目的**：自 **7,759** 首全庫重算對帳；自待推理佇列固定 seed 抽 **100** 首；沿用 `run_g3_e_wave`。**adopt 仍 disabled**。

**全庫對帳**（`backup/classification/g3-f1-wave-100/full-library-reconcile.json`，本次重算）：

| 項目 | 數量 |
|------|------|
| 全庫 ID | **7,759** |
| 可辨識曲名＋藝人 | **1,895** |
| 缺必要 metadata | **5,864** |
| 人工確認 | **1** |
| 合格 AI／可重用候選 | **408**（重疊旗標） |
| 新 wave 符合條件 | **1,487** |
| D.1 子集重算（complete 且需新 AI） | **1,487**（舊 **1,476** 僅供對照，勿沿用） |

互斥主狀態加總 **7,759**（見 `exclusive-primary-states.json`）。

**效能／安全**：

- `npm run g3:f1-reconcile-dry` — 唯讀對帳（約 **7s**），確認結束後再 prepare。
- `npm run g3:f1-prepare` — **單程序鎖**（`prepare.lock.json`）；分階段耗時見 `prepare-phase-timing.json`（本次約 **8.3s**）。
- **勿**平行多個 prepare 或完整 `npm test`。

**操作**：

1. `npm run g3:f1-reconcile-dry`
2. `npm run g3:f1-prepare`
3. Cursor Agent → `agent-outputs/g3f1-batch-XX-output.json`（`cursor_agent_g3_f1`）
4. `npm run g3:f1-run` — 前 **20** 首 gate QC；每 **50** 首 milestone；**100** 首 full-wave QC；缺 JSON fail-closed

**wave 完成（2026-10-22 續跑）**：batch **01–10** 全部 **completed**；**100/100** staged（`staged-candidates/`）；`g3:f1-run` 本次 ingest **80** 首新 JSON、validate **100**、**0** fail；**adopt_disabled: true**。

| QC | 結果 |
|----|------|
| gate-first-20 | **pass**（unknown 主曲風 **5%**、soundtrack **20%**） |
| every-50 | **pass**（unknown **4%**、soundtrack **22%**、needs_evidence **12**） |
| every-100 | **pass**（unknown **2%**、soundtrack **20%**、needs_evidence **26**、conflict **0**） |

wave 外待推理佇列 **1,387**（`remaining-after-wave.json`）；與 G3-E staged **138** 首 **0** ID 重疊。詳見 `quality-milestones.json`、`offline-summary.json`。

**產物**：`backup/classification/g3-f1-wave-100/`

**測試**：`test/g3_f1.test.js`；完整 `npm test` **388** 通過（約 **6** 分鐘）。

#### G3-F.2 · 第二波 100 首 wave（2026-10-22）

**目的**：自 F.1 外佇列（**1,387**）固定新 seed 再抽 **100** 首；沿用 `run_g3_e_wave`。**adopt 仍 disabled**。F.1 歷史產物不修改。

| 項目 | 值 |
|------|-----|
| 目錄 | `backup/classification/g3-f2-wave-100/` |
| seed | `g3-f2:wave-100:v1` |
| Agent | `cursor_agent_g3_f2`／`g3_f2_agent_json_infer` |
| 選曲基準 pending | **1,387**（僅排除 F.1） |
| wave 外剩餘 | **1,287**（`remaining-after-wave.json`） |

**指令**（單程序；先 dry 再 prepare／run）：

1. `npm run g3:f2-reconcile-dry` — 唯讀；F.1+F.2 完成後 pending **1,287**、排除 prior **200**
2. `npm run g3:f2-prepare` — **wave 已 100/100 staged 時自動略過**（避免覆寫抽樣）
3. Cursor Agent → `agent-outputs/g3f2-batch-XX-output.json`；首次 ingest 複製至 `agent-outputs-original/`
4. `npm run g3:f2-run` — gate-20／50／100 QC；validate 失敗寫 `validation-corrections-log.json`（**不**靜默改寫 Agent 推理）

**wave 完成（2026-10-22）**：**100/100** staged；validate **100** ok；batch **10/10**；**adopt_disabled: true**。

| QC | 結果 |
|----|------|
| gate-first-20 | **pass**（unknown **0%**、soundtrack **30%**） |
| every-50 | **pass**（unknown **0%**、soundtrack **20%**、needs_evidence **13**） |
| every-100 | **pass**（unknown **0%**、soundtrack **15%**、needs_evidence **19**、conflict **0**） |

**schema 修正**：batch-02 共 **1** 次（`0TeFOnjR427IbNqTnxidH1` 子曲風 `indie_pop` → `alternative_rock`）；original 保留於 `agent-outputs-original/g3f2-batch-02-output.json`；詳見 `validation-corrections-log.json`（`correction_count: 1`）。

與 G3-F.1／G3-E staged **0** Spotify ID 重疊。

**品質抽查（唯讀）**：`quality-spot-check-report.json`（**23** 首去重；互斥分類 **8** pass／**11** 證據不足／**4** 無法獨立確認／**0** 明確錯誤）；`manual-review-queue.json`（含 `4oVzwd0CozTLUl0gQT0JCW` high+needs_evidence）。

**測試**：`test/g3_f2.test.js`（含 prepare **skip** 非破壞性測試）。

#### G3-F.3 · 第三波 100 首 wave（已結案，2026-10-22）

| 項目 | 值 |
|------|-----|
| 目錄 | `backup/classification/g3-f3-wave-100/` |
| seed | `g3-f3:wave-100:v1` |
| Agent | `cursor_agent_g3_f3`／`g3_f3_agent_json_infer` |
| staged | **100/100**（batch-01～10 各 10 首） |
| prepare 前 pending | **1,287**（排除 F.1+F.2 **200**） |
| wave 外剩餘 | **1,187**（`remaining-after-wave.json`） |
| F 系列累積 staged | **300**（F.1+F.2+F.3） |

**指令**：`npm run g3:f3-reconcile-dry` →（僅新 wave）`g3:f3-prepare` → Agent JSON → `npm run g3:f3-run`（resume；缺批 fail-closed）。

**品質**：`quality-milestones.json`（gate-first-20／every-50／every-100 皆 **pass**）；validate 修正 2 首（Señorita 子曲風、Six Boy 子曲風）見 `validation-corrections-log.json`；與 F.1／F.2 wave **0** ID 重疊；**adopt_disabled: true**。

**測試**：`test/g3_f3.test.js`。

#### G3-F.4 · 第四波 100 首 wave（已結案，2026-10-22）

| 項目 | 值 |
|------|-----|
| 目錄 | `backup/classification/g3-f4-wave-100/` |
| seed | `g3-f4:wave-100:v1` |
| Agent | `cursor_agent_g3_f4`／`g3_f4_agent_json_infer` |
| staged | **100/100** |
| prepare 前 pending | **1,187**（排除 F.1～F.3 **300**） |
| wave 外剩餘 | **1,087** |
| F 系列累積 staged | **400** |

**指令**：`npm run g3:f4-reconcile-dry` → `g3:f4-prepare` → Agent JSON → `npm run g3:f4-run`。

**品質**：`quality-milestones.json` 20／50／100 皆 pass；validate 修正見 `validation-corrections-log.json`；與 prior F waves **0** ID 重疊。

**測試**：`test/g3_f4.test.js`。

### 尚未完成

- phase-f **20 首人工品質驗證**（目前 0 首已填；需使用者自行聽音／判斷）
- phase-e **100 首人工審核**（accept／reject／modify；目前全為 pending）
- 完成剩餘 **5,864** 首（以當時 `classification-summary` 為準）Metadata 補齊
- 擴大 AI 分類至**全庫**（超出測試批次）
- **建立新的 Spotify 智慧播放清單**（線上寫回，尚未實作）
- 增量同步新增歌曲
- 可選的手動或排程同步

---

## 附：AI 測試候選工作流（維護人員）

1. `npm run classify:build`（確保索引最新）
2. `npm run classify:ai-export -- --count=30`（可選，會換樣本）
3. 編輯或由工具產生候選：
   - v1 草稿：`backup/classification/ai-test/ai-candidates.json` → `npm run classify:ai-import`
   - v2：`npm run classify:ai-generate-v2` → `npm run classify:ai-import-v2`
4. `npm run classify:ui` 人工審核

**phase-e-100 品質測試（額外流程）**：

1. `npm run classify:ai-export-phase-e`（排除 v2 30 首，選 100 首；含快照）
2. 依 `ai-test/phase-e-100/cursor-chunks/` 在 Cursor 分批產生 `partial-candidates/chunk-XX.json`
3. `npm run classify:ai-merge-phase-e` → `npm run classify:ai-import-phase-e`
4. `npm run classify:ai-quality-phase-e`；UI 選 **phase-e-100** 批次審核

**phase-f-20 品質驗證（抽樣評估，額外流程）**：

1. `npm run classify:quality-audit-build-phase-f`
2. UI → **AI 品質驗證** → 逐首標記正確性（勿與「AI 待審核」接受混淆）

若需修正已匯入候選：改 `partial-candidates/chunk-XX.json` 後重新 merge／import；**勿**覆寫 `manual-overrides.json` 或 v2 審核。重大修正前可複製 partial 至 `backup/classification/snapshots/` 並附 `revision-log.json`。

**警告**：勿手動刪除 `manual-overrides.json` 或並行跑兩次 enrichment。勿將 `.env` / token 提交版本庫。勿覆寫 `ai-test/v2/` 或 v1 封存。

---

## 相關文件

- 手動匯入歌單：`imports/README.md`

---

*檔案類型：操作手冊 · 語言：繁體中文 · 若與程式行為衝突，以原始碼為準。*
