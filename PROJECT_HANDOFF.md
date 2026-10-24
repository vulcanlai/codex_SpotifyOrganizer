# SpotifyOrganizer — 跨電腦專案交接

> **最後更新**：2026-10-24（**資料同步匯出工具 v1**；MVP Spotify sync apply；**G3-F pending 0**）

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
1. G3-F **pending 已 0**；後續為 staged 人工複核／是否啟用 adopt（預設仍 disabled）。  
2. **API 冷卻結束後**再跑 metadata（`enrich:auto --resume`）。  
3. 429 期間：**禁止** `enrich:*`／Track API。  
4. 可選：`npm run classify:build`（不呼叫 Spotify；與本輪離線 F wave 無關）。  
5. **人工分類 CLI**：`npm run manual:classify -- preview …` → `--apply --confirm`（預設 dry-run；寫入前備份 `manual-overrides`；見 `scripts/manual_classify.js`）。
6. **MVP Spotify 同步（假 complete 修復後）**：先 dry-run 單張 → 確認無 429 再 `--apply`（`emotion:late_night_calm` **201** 首、`lg:v2:english:soundtrack_instrumental` **15** 首；manifest 曾 complete 但線上缺歌時 apply 會 re-fetch 補 POST）。
7. **人工分類 Web UI V1**：`npm run manual:classify:ui:build` → `npm run manual:classify:ui` → http://127.0.0.1:8892（開發：`manual:classify:ui:dev` + 同埠 API）。
8. **跨電腦資料同步**：`export-data.bat`／`import-data.bat`（見 `docs/data-sync-export.md`、`docs/data-sync-import.md`）；匯出寫入 `last-export.json`、manifest `handoff_previous_bundle_id`；匯入需 `--dry-run` 後 `--apply --confirm=I_UNDERSTAND_DATA_SYNC_IMPORT`。

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

| 項目 | 結果 |
|------|------|
| 完整 `npm test`（`--test-concurrency=1`） | 上次 **417/417**（2026-10-23）；本輪新增 **`test/data_sync_export.test.js` 15/15**（未跑全量） |
| `npm run test:data-sync-export` | **22/22** pass（2026-10-24）；含 7-Zip 路徑／AES 相容 |
| `npm run test:data-sync-import` | **19/19** pass（2026-10-24）；含家→公司→家→公司往返、解壓前路徑檢查、交接鏈 |
| `test/safe_data_path.test.js` + `test/oauth_token_security.test.js` | **18/18** pass（2026-10-24）；匯出工具開發後複跑 |
| `test/manual_classify.test.js` | **16/16** pass（2026-10-24）；未改正式 `manual-overrides` |
| `test/mvp_playlist_sync_apply.test.js` | **10/10** pass（2026-10-24）；mock API，無真實 Spotify 寫入 |
| `test/manual_classify_ui.test.js` | **10/10** pass（2026-10-24）；Web API fixture，未改正式 overrides |
| 修正摘要 | 過時固定數（1895／5864／F pending 1287 等）改動態對帳；`ai_web_handlers` v1 審核讀 `FILE_AI_CANDIDATES`／`FILE_AI_REVIEW`；AI 測試不再 `export write:true` 覆寫 sample |
| `test/metadata_cache_guard.test.js` | 併入全量 pass |
