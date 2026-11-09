# SpotifyOrganizer — 跨電腦專案交接
> **2026-11-09 ZIP 鏡射模式（優先於後文）**：獨立 `--mirror`（`I_UNDERSTAND_DATA_SYNC_MIRROR`）。一般 `--apply` 不會變成鏡射。交接版本 **1.1.0**。隔離測試 `test:data-sync-mirror` **5/5**。公司端已另匯出鏡射包 `.data-sync-out/spotify-handoff-20261109-105252.zip` SHA256 `bf4496a98039bfb7c8b15544ebe00c6483122d479085fd233daefd3d85d0f160`（`mirror_supported: true`）。舊包 `spotify-handoff-20261109-102138.zip` **保留未覆寫**，1.0.0 不可鏡射。正式鏡射匯入、Spotify 寫入未執行。詳見 README 情境 E-2、§6／§11。

> **2026-11-09 正式 Apply 已完成（優先於後文）**：plan `2f5a7276682c85e186e6a86749224f32b9952dd9cc20abc2686b02e0f65f8633` 已本機保存。套用前重抓 `/me/playlists` 清單指紋相符。正式檔：`managed-playlist-rules.json`／`baseline`／`operations`。22 筆歌單層級移除、17 筆 Spotify 獨有保留、`🎵 台語歌手 / 年代` 27 首自訂、`🎵 華語 / 中國風` 名稱鎖定（原 ID）、`🎵 鄉村 / 藍調` 維持 `deleted_pending`。`classify:build` 後索引 **7773**（原曲庫 **7759** 不變）。同步 Dry Run 未寫 Spotify。新加密 ZIP：`.data-sync-out/spotify-handoff-20261109-102138.zip` SHA256 `b660bf4a0746552ca0600b28bc3f7a688d67aad585efdd77acbdb5fda0760bf3`。程式碼本次提交至 `origin/main`（不含曲庫／ZIP／Token）。家裡正式匯入 **未執行**。詳見 §6／§11。

> **2026-11-09 🎵 讀回接續**：真實唯讀讀回已完整。清單 57、納管列 54。plan `2f5a7276…` 完整可套用但仍待確認。舊 `10e36ed5…`／`82f29b5…` 不可 apply。

> **2026-11-06 🎵 人工歌單讀回工具**：工具完成。當時真實讀回在「🎵 華語搖滾」遇到 429；plan `10e36ed5…` 不完整。已被 2026-11-09 完整 plan 取代，不得套用。

> **2026-11-06 正式清理已執行（優先於後文）**：明確核准後已移除45異常關係/23首、9份他人歌單退追、6份本人舊歌單/副本介面刪除；53份🎵保留。7首新歌曲已補入分類，索引7766（原曲庫7759不變），待確認66。128項隔離測試通過。清理後加密ZIP已驗證，含ledger及7首來源；家裡正式匯入未執行，整檔匯入被安全閘阻擋。保留4份原來源、17筆未回傳不推定失效。詳見 [正式清理報告](reports/classification-refresh-20261105/post-cleanup-report-20261106.md)。不得重跑已成功的操作。

> **2026-11-06 續作最新狀態（優先於下方歷史紀錄）**：全庫分類與53份🎵歌單同步已完成；最新53份API數量皆與前次驗證一致，本次Spotify寫入0次。42沿用、11新建，6073新增關係皆是中斷前成果。7759首中139排除，7620首有7554主曲風、66待確認、1054語言未知。AI為藝人群組Metadata粗推論、ai_suggested，非逐曲聆聽。45筆異常舊關係（23首）待精確範圍核准；舊歌單未刪除。兩副本11/800首已標停止，不得續建。ZIP雜湊再次一致。詳見 [完整報告](reports/classification-refresh-20261105/report.md) 與 resume-verification-20261106.json。

> 2026-11-05 整批續作：139 首／139 關係全列入建議清理，5 份皆他人非共同編輯歌單、來源 manual_import。目前可自動移除 0；建議一次授權人工隱藏替代（不等同刪除），或由有權限者移除。最新 final-batch-preview.md 與 plan 位於 reports/cleanup/2026-11-05T04-57-32-906Z-45428/。新增整批模擬、人工結果驗證與共同基準衝突預覽；沒有 API 呼叫或正式資料寫入。前次 ZIP 與所有原有修改保留。
> 2026-11-05 清理預覽接手：Metadata 完成 7,736/7,759；正常待補 0，異常 23（429 6、partial 17）；非全部補全完成。139 去重候選（133 曾記錄不可播放、6 其他待確認），正式清理未執行。清理前 ZIP `.data-sync-out/pre-cleanup-20261105-unique.zip` 已由既有 AES-256 匯出流程解壓與 SHA-256 驗證。詳見 [清理與同步說明](docs/cleanup-preview.md)。下列歷史補全數字及冷卻日期不代表目前狀態；分類數字本次未重建。

> **最後更新**：2026-10-24（**資料同步 WzAES／.env 密碼整合**；MVP Spotify sync apply；**G3-F pending 0**）

---

## 1. 最終目標與六大階段（營運路線）

**目標**：本機整理約 **7,759** 首 Spotify 收藏 → 補 metadata → AI 輔助分類 → 人工審核；**預設不修改 Spotify 線上歌單**。

| 階段 | 內容 | 狀態（摘要） |
|------|------|----------------|
| **1** | 備份、library-v2 合併 | **完成**（7,759 unique） |
| **2** | Metadata enrichment（Spotify Track API） | **暫停**（429 冷卻至 **2026-10-23 13:33:01 台灣時間**；快取 ok 約 **1,749**；待補約 **5,266**—以使用者最新摘要為準） |
| **3** | G3 證據層／外部查證 G1–G2.1 | **試驗完成** |
| **4** | G3-B～D wave／修復 | **大量完成**（adopt **disabled**） |
| **5** | G3-E / G3-F wave 分類 | **G3-F 佇列完結**（F.1～F.21 **2,079** staged；**pending 0**；staged ≠ 正式採用） |
| **6** | 人工審核、正式採用、Spotify 寫回 | **未開始**（staged ≠ 正式） |

---

## 2. 技術架構與常用指令

| G3-F | 指令 |
|------|------|
| F.1 | `g3:f1-reconcile-dry` → `g3:f1-prepare` → Agent → `g3:f1-run` |
| F.2 | `g3:f2-reconcile-dry` → `g3:f2-prepare` → Agent → `g3:f2-run` |
| F.3 | `g3:f3-reconcile-dry` → `g3:f3-prepare` → Agent → `g3:f3-run` |
| F.4 | `g3:f4-reconcile-dry` → `g3:f4-prepare` → Agent → `g3:f4-run` |
| F.5 | `g3:f5-reconcile-dry` → `g3:f5-prepare` → Agent → `g3:f5-run` |
| F.6 | `g3:f6-reconcile-dry` → `g3:f6-prepare` → Agent 決策 JSON → `g3:f6-emit-agent-outputs` → `g3:f6-run` |
| **F.7+** | **`npm run g3:f-next -- --dry-run`** → **`--prepare`** → Agent 決策 → **`--emit`** → **`--run`**（manifest 解析波次，非執行次數） |

**prepare guard**：F.2～F.6 專用腳本與 **F.7+ `g3:f-next --prepare`** 在 staged 已滿時 `write: true` 回傳 **`skipped: true`**。

### G3-F.7+ 通用批次（Git Bash 建議順序）

1. `npm run g3:f-next -- --dry-run` — 唯讀對帳（pending／排除 prior waves／解析下一波）
2. `npm run g3:f-next -- --prepare --count=100` — 固定 seed 抽樣（最後一波可 `--count=87` → 目錄 `g3-f15-wave-87`；`pending` 不足時自動 clamp；未完成波次續跑時不加 `--prepare`）
3. Cursor Agent：讀 `backup/classification/g3-fN-wave-{size}/batch-inputs/`，寫 `agent-decisions-batch-*.json`（批數 = ceil(size/10)；語言用 `dimensions.js` 的 **台語** 非閩南語；**韓文** 非韓語；`pop_rock` 主曲風 **rock**）
4. `npm run g3:f-next -- --emit` — 合併決策 → `agent-outputs/`
5. `npm run g3:f-next -- --run` — validate／stage／QC／`remaining-after-wave.json`
6. 可 `--wave=N` 強制指定（預設 manifest 解析下一波）

**共用程式**（F.1～F.6 歷史腳本未刪）：`g3_f_wave_manifest.js`、`g3_f_paths_dynamic.js`、`run_g3_f_dynamic.js`、`g3_f_emit_agent_outputs.js`、`run_g3_f_next.js`；validate 仍走 `validate_g3_e2_agent_rows`／`run_g3_e_wave`。

---

## 5. 最新對帳數字（請以 JSON 為準）

2026-11-09 正式 Apply 後：原曲庫 **7,759** 不變；`classify:build` 索引 **7,773**（含自訂歌單補充曲目）；metadata 完整 **7,750**／缺失 **23**；139 筆異常排除仍在索引；ledger SHA256 未變。驗證報告：`reports/managed-playlist-apply-20261109/`。

2026-11-06：以檔首續作摘要及 classification-refresh-20261105/sync-verification.json 為最新；以下舊表僅保留歷史。

2026-11-05 補全對帳：7,759 總數／7,736 完成／0 正常待補／23 異常未完成；舊分類計數本次未重建。


| 項目 | 數量 |
|------|------|
| 全庫 | **7,759** |
| classification-index `complete`（有 display 歌名） | **2,487** |
| `metadata_missing` | **5,272** |
| F 系列 staged | **2,079**（F.1～F.14 各 100、F.15 **87**、F.16～F.20 各 100、F.21 **92**；以 manifest／staged-candidates 對帳） |
| G3-F pending（wave 外） | **0**（2026-10-23 dry-run） |
| dry reconcile | `npm run g3:f-next -- --dry-run` → `pending_queue: 0` |

**G3-F.14**（`g3-f14-wave-100/wave-manifest.json`）：**prepared**｜seed `g3-f14:wave-100:v1`｜`queue_pending_at_prepare` **187**｜Agent **`agent-decisions-batch-01`～`10.json`（100 ID）已產出**（**35** medium／**2** low）｜**尚未** emit／run／staged（請本機 `npm run g3:f-next -- --emit --wave=14` → `--run --wave=14`）｜**adopt_disabled: true**

**G3-F.13**（`g3-f13-wave-100/offline-summary.json`）：使用者脈絡 **100/100 staged**｜seed `g3-f13:wave-100:v1`｜**adopt_disabled: true**

**G3-F.12**（`g3-f12-wave-100/offline-summary.json`）：**100/100** staged｜seed `g3-f12:wave-100:v1`｜**adopt_disabled: true**

**G3-F.11**（`g3-f11-wave-100/offline-summary.json`）：**100/100** staged｜seed `g3-f11:wave-100:v1`｜**adopt_disabled: true**

**G3-F.10**（`g3-f10-wave-100/offline-summary.json`）：**100/100** staged｜seed `g3-f10:wave-100:v1`｜**adopt_disabled: true**

**G3-F.9**（`g3-f9-wave-100/offline-summary.json`）：**100/100** staged｜seed `g3-f9:wave-100:v1`｜**adopt_disabled: true**

**G3-F.8**（`g3-f8-wave-100/offline-summary.json`）：**100/100** staged｜seed `g3-f8:wave-100:v1`｜**adopt_disabled: true**

**G3-F.7**（`g3-f7-wave-100/offline-summary.json`）：**100/100** staged｜seed `g3-f7:wave-100:v1`｜batch **10/10**｜validate **100** ok｜QC gate-20／50／100 **pass**｜Agent 決策 `agent-decisions-batch-*.json` + `agent-outputs/`｜**adopt_disabled: true**

**G3-F.6**（`offline-summary.json`）：**100/100** staged｜seed `g3-f6:wave-100:v1`｜batch **10/10**｜validate **100** ok｜QC gate-20／50／100 **pass**｜子曲風主從修正見 `agent-decisions-batch-*.json`（如 pop_rock→主曲風 rock）｜與 F.1～F.5 **0** ID 重疊｜**adopt_disabled: true**

**G3-F.5**（`offline-summary.json`）：**100/100** staged｜seed `g3-f5:wave-100:v1`｜**adopt_disabled: true**

**G3-F.4**：**100/100** staged（見 `g3-f4-wave-100/offline-summary.json`）。

---

## 6. 最近完成／下一步

2026-11-05：只完成備份、離線預覽及同步安全閘。下一步先人工檢視 139 候選與受限歌單；不執行刪除。真實刪除 adapter 與關係同步套用尚未實作；不得宣稱正式工具已可執行。


**已完成（2026-10-23）**  
- **G3-F.17～F.21**：prepare → Agent 決策 → emit → run（**492** staged；validate_fail **0**；adopt_disabled **true**）；報告 `reports/g3-f17-f21-wave-run-2026-10-23.md`  
- **G3-F.16**：100 staged（本輪 592 候選之前段；見 `reports/g3-f16-wave-run-2026-10-23.md`）  
- **G3-F.15** emit + run（**87** staged）  
- **G3-F 工具**：`run_g3_f_next.js`／`g3_f_wave_manifest.js` 支援 **1～100** 可變 wave_size、`g3-fN-wave-{size}` 目錄、prior 掃描 wave-sample-{size}、dry-run 顯示 batch 配置  
- **G3-F.14** prepare（187 pending）+ Cursor Agent **10 批決策 JSON（100 首）**（**35** medium／**2** low）；**待** emit + run 驗證暫存（**不可宣稱 staged**）  
- **G3-F.13** prepare + Agent 決策 + emit + **run（100 staged）**（使用者脈絡）  
- **G3-F.12** prepare + Agent 決策 + emit + **run（100 staged）**  
- **G3-F.11** prepare + Agent 決策 + emit + **run（100 staged）**  
- **G3-F.10** prepare + Agent 決策 + emit + **run（100 staged）**  
- **G3-F.9** prepare + Agent 決策 + emit + **run（100 staged）**  
- **G3-F.8** prepare + Agent 決策 + emit + **run（100 staged）**  
- **G3-F 通用 `g3:f-next`**（manifest 解析下一波、dry reconcile、prepare／emit／run；`test/g3_f_next.test.js` **5/5**）  
- **G3-F.7** prepare（887 pending）+ Agent 10 批決策 + emit + **run（100 staged，剩 787）**  
- **G3-F.6** 程式（`paths_f6.js`、`run_g3_f6.js`、`g3_f6_emit_agent_outputs.js`、`g3-f6-emit-agent-outputs.js`）+ reconcile（**987** pending／排除 **500**）+ prepare + Agent 決策 10 批 + **run（100 staged）**  
- **G3-F.5** 程式 + **100 staged**（見上）  
- **metadata 快取 guard**：`lib/enrichment/metadata_cache_guard.js` + `merge_sources.js` 整合（拒絕 id 不一致／partial 假 ok）  
- `run_g3_e_wave.js`：`is_g3_f_wave_key` 含 **f5**  
- **`npm test` 10 項失敗修正**：動態對帳（title 覆蓋、G3-C.2/D.1、F pending **987**）、AI 審核 API v1 路徑、測試 v1 封存還原（`test/helpers/ai_v1_snapshot.js`）；完整 **408/408** pass

**後續待辦（必須追蹤）**  
1. **資料正確性／斷電恢復／異常快取防護（尚未做端到端整合驗證）**：enrichment 中斷續跑、`rate-limit-state` 與 checkpoint 同時存在、partial 冷卻期 guard + `classify:build` 後 evidence／index 歌名差（目前 B.5.1 測試已對帳 **592** 列 index 有 title、evidence 缺 title）。  
2. **測試檔案盤點（僅提案，未經確認不得刪）**：`backup/enrichment/external/g1-30` mock、`g3-b2/b3/b4/b5/b6` 試驗目錄、`classification/snapshots/` 大量 pre-phase-d／test-snapshot（**v1 sample-30 還原依賴**，刪前需改 fixture）、`_agent_track_index.json`。

**G3-F.21**（`g3-f21-wave-92/wave-manifest.json`）：**staged_complete**｜**92/92**｜validate_fail **0**｜**adopt_disabled: true**

**下一步（營運）**
1. **家裡鏡射（尚未執行）**：先 `git pull origin main` 取得 `--mirror` 程式。把公司新包 `.data-sync-out/spotify-handoff-20261109-105252.zip` 拷過去（勿用 `20261109-102138`）。先 `--mirror --dry-run` 看 `would_remove`，再 `--mirror --apply --confirm=I_UNDERSTAND_DATA_SYNC_MIRROR`。一般 `--apply` 不會刪多餘檔。關係層合併仍可用 `--relation-plan-hash`，不可與 `--mirror` 併用。
2. **Git**：鏡射程式與文件提交至 `origin/main`（不含 `backup/`、ZIP、`.env`、Token）。家裡若有未提交修改，先保留再 pull。
3. **不要重跑本次已成功的 Apply**。同一 plan 會被拒絕。舊 plan `10e36ed5…`／`82f29b5…` 仍不可套用。  
4. **不要對 Spotify 執行** `mvp:spotify-sync --apply` 或 `mvp:spotify-metadata-sync --apply`，除非另授權。Dry Run 顯示 404 歌單跳過、人工名稱不改回、22 筆移除不會被補回；metadata 若套用會改 51 份描述（名稱 0 筆）。  
5. G3-F **pending 已 0**；後續為 staged 人工複核／是否啟用 adopt（預設仍 disabled）。  
6. enrichment `rate-limit-state` 的 Track API 冷卻已於 2026-11-05 到期；**本次未跑** `enrich:*`。需要補 metadata 時另開小批 `--resume`。  
7. 舊 readback plan／checkpoint／報告保留當驗證紀錄，不要刪。

---

## 7. Spotify API 與本機工作切換

**2026-10-22**：Spotify Track API **429**；使用者回報冷卻至 **2026/10/23 13:33:01（台灣時間）**。本機 `rate-limit-state.json` 請每次開工重讀。

| 原則 | 實作 |
|------|------|
| API 不可用 | 改做 G3-F wave、validate、QC、`classify:build` |
| 快取信任 | `metadata_cache_guard.js`；partial／id 不符不併入 display |
| 斷點 | enrichment `checkpoint.json`；F wave `batch-progress.json` |

---

## 10. 進度錨點 JSON

| 路徑 | 用途 |
|------|------|
| `g3-f5-wave-100/offline-summary.json` | F.5 執行摘要（100 staged） |
| `g3-f5-wave-100/quality-milestones.json` | F.5 QC |
| `g3-f6-wave-100/offline-summary.json` | F.6 執行摘要（100 staged） |
| `g3-f6-wave-100/quality-milestones.json` | F.6 QC |
| `g3-f6-wave-100/remaining-after-wave.json` | F.6 後 **887** |
| `g3-f7-wave-100/offline-summary.json` | F.7 執行摘要（100 staged） |
| `g3-f7-wave-100/quality-milestones.json` | F.7 QC |
| `g3-f7-wave-100/remaining-after-wave.json` | F.7 後 **787** |
| `g3-f8-wave-100/offline-summary.json` | F.8 執行摘要（100 staged） |
| `g3-f9-wave-100/offline-summary.json` | F.9 執行摘要（100 staged） |
| `g3-f10-wave-100/offline-summary.json` | F.10 執行摘要（100 staged） |
| `g3-f11-wave-100/offline-summary.json` | F.11 執行摘要（100 staged） |
| `g3-f12-wave-100/offline-summary.json` | F.12 執行摘要（100 staged） |
| `g3-f13-wave-100/wave-manifest.json` | F.13 prepared + 決策已寫（待 emit/run） |
| `g3-f13-wave-100/agent-decisions-batch-*.json` | F.13 Agent 決策（10×10） |
| `g3-f14-wave-100/wave-manifest.json` | F.14 prepared + 決策已寫（待 emit/run） |
| `g3-f14-wave-100/agent-decisions-batch-*.json` | F.14 Agent 決策（10×10） |
| `g3-f15-wave-87/wave-manifest.json` | F.15 prepared + 決策已寫（待 emit/run） |
| `g3-f15-wave-87/agent-decisions-batch-*.json` | F.15 Agent 決策（8×10 + 7） |
| `g3-f5-wave-100/remaining-after-wave.json` | F.5 後 **987** |
| `g3-f4-wave-100/offline-summary.json` | F.4 摘要 |
| `backup/enrichment/rate-limit-state.json` | 429 冷卻 |
| `backup/enrichment/track-metadata-cache.json` | Metadata 快取 |

---

## 11. 測試

整批續作：116 項相關離線測試全部通過，正式資料寫入與網路防護啟用。既有 ZIP SHA-256 及 3,355 份來源雜湊未變。最新報告 tests.txt 與 continuation-verification.json 已保存。

2026-11-05：相關離線測試 110 項通過（ZIP／匯入／清理 72 + GUI／沙箱驗收 38），新增關係結構檢查後清理 10 項再次通過。沒有真實 Spotify 刪除。報告：reports/cleanup/2026-11-05T04-43-31-647Z-41668/。備份來源 3,355 檔 SHA 未變。


| 項目 | 結果 |
|------|------|
| 完整 `npm test`（`--test-concurrency=1`） | 上次 **417/417**（2026-10-23）；本輪新增 **`test/data_sync_export.test.js` 15/15**（未跑全量） |
| `npm run test:data-sync-export` | **29/29** pass（2026-10-24 本機 Win10）；WzAES 匯出／env 與 stdin 測試、7-Zip 路徑偵測保留 |
| `npm run test:data-sync-import` | **23/23** pass（2026-10-24 本機 Win10） |
| `npm run test:wzaes-zip` | **6/6** pass（2026-10-24 本機 Win10）；7-Zip 雙向相容、大檔 SHA、密碼探測 |
| `npm run test:acceptance-sandbox-import` | **12/12** pass（2026-10-24 本機 Win10） |
| `npm run test:data-sync-gui` | **19/19** pass（2026-10-24 本機 Win10） |
| **Win11 公司機** | **待實機驗證**（同 repo + `npm ci` + `.env` 密碼） |
| `test/safe_data_path.test.js` + `test/oauth_token_security.test.js` | **18/18** pass（2026-10-24）；匯出工具開發後複跑 |
| `test/manual_classify.test.js` | **16/16** pass（2026-10-24）；未改正式 `manual-overrides` |
| `test/mvp_playlist_sync_apply.test.js` | **10/10** pass（2026-10-24）；mock API，無真實 Spotify 寫入 |
| `test/manual_classify_ui.test.js` | **10/10** pass（2026-10-24）；Web API fixture，未改正式 overrides |
| 修正摘要 | 過時固定數（1895／5864／F pending 1287 等）改動態對帳；`ai_web_handlers` v1 審核讀 `FILE_AI_CANDIDATES`／`FILE_AI_REVIEW`；AI 測試不再 `export write:true` 覆寫 sample |
| `test/metadata_cache_guard.test.js` | 併入全量 pass |


## 2026-11-06 下一步與驗證補記（補充§6／§11）

已核對53份歌單總數、2份副本與ZIP雜湊；不重送新增。前次隔離83測試通過，本次AI缺主曲風回歸結果見resume-tests-20261106.txt。下一步一次確認45筆異常關係與舊歌單退場範圍，再清理、讀回驗證、匯出一次正式ZIP。保護家裡獨有資料；沒有正式同步、Git提交或部署。前次Token ACL檢查失敗的復原狀態未驗證，不讀取憑證或自行修改ACL。測試暫存可於報告保留後清除，原始ZIP、AI來源及同步manifest需保留。

2026-11-09 ZIP 鏡射：隔離合成測試 `npm run test:data-sync-mirror` **5/5**（提交前再跑一次）。回歸 `test:data-sync-import` **26/26**、`test:data-sync-export` **30/30**。公司新包 `spotify-handoff-20261109-105252.zip` 已驗證 `mirror_supported: true`／1.1.0。未跑正式鏡射匯入、未刪真實資料。

2026-11-09 正式 Apply：`test/managed_playlists.test.js` **26/26**（含真實 plan 隔離套用、重複套用拒絕、過期指紋拒絕）。同步／ZIP 隔離測試：`mvp_spotify_sync`、`mvp_playlist_metadata_sync`、`mvp_playlist_sync_apply`、`mvp_emotion_metadata_dry_run`、`data_sync_export`、`data_sync_import`、`acceptance_sandbox_import` 全部通過。全量 `npm test` 未跑（會複製整個 `backup/`）。新 ZIP 未覆寫既有檔。

2026-11-09 Apply 前驗收：當時 `test/managed_playlists.test.js` **26/26**；正式 rules／baseline 仍不存在。已被同日正式 Apply 取代。

2026-11-09 🎵讀回接續：離線當時 `test/managed_playlists.test.js` **24/24**；真實唯讀 resume 完成。plan `2f5a7276…` 完整可套用、**未 apply**。報告：`backup/classification/managed-playlists-readback/reports/2f5a7276682c85e186e6a86749224f32b9952dd9cc20abc2686b02e0f65f8633.md`。

2026-11-06 🎵讀回：離線當時 `test/managed_playlists.test.js` **16/16**；真實讀回部分完成後 429，plan `10e36ed5…` 不完整不可保存。

2026-11-06最終測試：7/7通過；Git diff --check通過，11份tracked修改＋7個untracked項目，無暫存、Commit、Push。139來源候選仍僅1首先前隱藏、未正式移除；按讚及收藏專輯無異動。

2026-11-06 退場預覽：17原來源已全分頁讀取；2來源少回傳17筆，另有7首新來源歌曲未涵蓋。可退場原來源13份，暫保留4份；2過渡副本已完整讀回。45關係/23首在10份🎵歌單列精確清理候選。報告retirement-preview-20261106.md、計畫retirement-plan-20261106.json。均未執行，需一次明確核准。
