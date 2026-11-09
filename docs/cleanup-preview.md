# 異常清理與公司／家裡同步（2026-11-05）

## 2026-11-05 整批清理續作（目前採用）

本輪離線回歸：116 項通過、0 失敗；所有 3,355 份備份來源檔案與既有加密 ZIP 均未變更。

建議整批處理全部 139 首異常候選，不再進行大量重試、不逐首要求授權。
對應 139 個歌單歌曲關係（139 個匯入位置），按讚影響 0，收藏專輯修改 0。
133 首曾記錄不可播放，另 6 首 429；17 首 partial 包含在前述候選中。
播放未知且沒有其他異常者不納入。

已從本機 owner_id、user_id、collaborative 核對：5 份都是他人擁有且非共同編輯歌單；
139 個關係全部來自 manual_import，匯入序號不是 Spotify 線上位置。
本次只讀官方文件，沒有呼叫 Spotify API；權限／曲目目前是否已改動仍未知。
目前可自動刪除 0，不能由本帳號直接移除的原始歌單關係 139。
這是權限限制，重試 Metadata、換刪除 API 或改用桌面都不會授予編輯權限。

建議一次核准 139 首的人工清理：
1. 依 5 份歌單分組，開啟清單的歌單與曲目連結，核對 Spotify ID。
2. 若現在確實有編輯權限，才選「從這份播放清單移除」。
3. 沒有編輯權限時，建議另在同一次授權中核准「隱藏這首歌曲」替代；此動作跳過播放，不刪原始關係。
4. 找不到歌曲或沒有相關控制就記為 not_found／failed，不將其計為已刪除；不退追整份歌單，不影響正常歌曲。
5. 如果一定要刪除他人的原始關係，只能由有編輯權限的人操作；不繞過權限、不自動聯絡他人。
不建立複雜修復系統，也不為這批 0 個可執行 API 項目新增真實刪除入口。

官方依據：
- [移除歌單項目 API](https://developer.spotify.com/documentation/web-api/reference/remove-items-playlist)
- [播放清單與共同編輯](https://developer.spotify.com/documentation/web-api/concepts/playlists)
- [桌面版歌單編輯](https://support.spotify.com/uk/article/create-playlists/)
- [他人歌單隱藏歌曲](https://support.spotify.com/eg-en/article/hide-unhide-songs/)

沿用既有 CLI：

```powershell
npm run cleanup:preview -- --dry-run --batch
node scripts/cleanup-preview.js --plan=完整路徑/final-batch-plan.json --results=完整路徑/manual-results.json
node scripts/cleanup-preview.js --sync-local=家裡library-v2.json --sync-incoming=公司library-v2.json --ledger=cleanup-ledger.json --baseline=共同基準library-v2.json
```

最新預覽：`reports/cleanup/2026-11-05T04-57-32-906Z-45428/`。
- final-batch-preview.md：整批方案與 5 份逐首人工清單。
- final-batch-plan.json：精確範圍與穩定 plan_id；來源／計畫變更時模擬拒絕。
- batch-simulation.json：139 關係假設移除模擬；7,620 首正常候選外歌曲、專輯及快取保留。沒有保存第二份曲庫備份。
- manual-checklist.csv：可人工填結果；CSV 公式字首已處理。
- manual-results-template.json：初始全為 pending，沒有預填成功。
- sync-preparation.json：分開說明真實移除、隱藏與未完成的同步處理。
- tests.txt：本輪相關離線測試紀錄。
- continuation-verification.json：來源與既有 ZIP 未變動的核對。

人工結果支援 pending、removed_verified、hidden_verified、not_found、failed。
以 operation_id、Spotify ID 與 container_id 驗證精確範圍，重複或清單外結果拒絕。
已完成結果必須有實際核對時間與依據；失敗會顯示 stopped。這是人工陳述的稽核預覽，不會自動相信它並修改正式曲庫。
只需一次整批授權；逐項記錄結果是避免誤報成功，不是逐項向使用者取得許可。

同步準備：
- 真實已移除且驗證的關係，後續才能形成 action=remove 的 tombstone。
- hidden_verified 不能作 tombstone；Spotify 的個人隱藏設定不保證由本機 ZIP 同步。
- 缺少共同基準時標記 requires_common_baseline；家裡新增／位置改動的對應關係標記 conflicts。
- 既有整檔匯入安全閘保留；有清理紀錄或本機獨有關係即阻擋整檔覆蓋。
- 原始 imports 文字仍保留；未來重新合併也必須參照真實刪除紀錄，不能拿舊來源重建後繞過安全閘。
- 本次沒有家裡實際曲庫，實際兩端差異尚未驗證。正式套用入口仍關閉；公司真實清理完成後才建立新 ZIP。
- 本次不變更 backup/library 下的正式 ledger、不清除任何原始資料、不建立清理後 ZIP。

本次新增的系統 temp 僅有 spotify-cleanup-batch-run-20261105.txt 與 spotify-cleanup-batch-tests-20261105.txt；
報告副本確認後可刪除。既有 ZIP、原始報告、待核准計畫與結果模板請保留至清理及同步稽核完成。
測試使用既有暫存假專案機制；未刪除既有使用者資料。未安裝套件、未寫 Git。


本階段只建立備份、離線清理預覽與模擬。沒有正式刪除入口，沒有修改 Spotify，沒有清除本機曲庫。

## 本次結果

- 全庫 7,759 首；Metadata 完成 7,736，正常待補 0，異常未完成 23。
- 去重候選 139：已記錄不可播放 133、其餘 429 待確認 6。17 首 partial 與不可播放重疊，不能相加。
- 6,882 已知可播放、744 播放狀態未知。無本次異常的 7,620 首不等於已確認可播放。
- 5 份歌單受影響；目前歌單資訊均顯示 restricted。按讚、收藏專輯內候選在本機快照中皆為 0。
- 13 份歌單沒有完整 API 曲目快照，部分關係來自既有匯入；不能推定即時位置或寫入權限。
- 同一歌單重複關係共 7 組，另行統計，不列為移除理由。
- 429、403、404、網路、授權、部分成功均是異常資訊，不是永久失效證明。
- 補全 status 的全域截止時間已過，但沒有重新查詢 API 來證明 Spotify 目前解除限流。

## 備份

清理前 ZIP：`.data-sync-out/pre-cleanup-20261105-unique.zip`。
沿用既有 AES-256 匯出、listing／manifest 成員比對、解壓 SHA-256 檢查。
共 3,355 個資料檔與 1 個 manifest，原始資料 312,042,586 bytes。
ZIP 不含程式碼；保留目前 Git HEAD 及本次未提交程式另行交接。
匯出會依既有流程更新 `.data-sync-state/last-export.json`，這是本次唯一必要同步狀態寫入；沒有改動正式曲庫。
交接父節點在 manifest 與 last-export 中保存；未將本機 Token、環境檔或 ACL 快照納入。

這是現有本機資料完整快照，不是 Spotify 線上完整可復原備份。
受限歌單缺曲目快照、資料來源非即時；取消按讚後 added_at 或移除歌單後原始位置／歷史可能無法完整還原。
本次沒有測試真實 Spotify 還原。不能以 ZIP 成功代替正式刪除前的資料完整性判斷。
不得覆寫或刪除本 ZIP。採清理優先與一次整批授權；使用者需了解備份的復原限制，不要求逐首搶救或逐首授權。

## 重跑預覽

```powershell
npm run enrich:status
npm run cleanup:preview -- --dry-run
npm run cleanup:preview -- --ids=歌曲ID --playlists=歌單ID --types=not_playable
npm run cleanup:preview -- --ids=歌曲ID --liked
npm run test:cleanup
```

預設選取 0 個操作；以上選項都只輸出 `selected-operations.json`，每個操作仍為 blocked。
歌單必須明列 ID；選歌曲不會自動選取所有歌單。專輯不提供清理操作。
每次產生獨立報告目錄，不覆寫舊報告。人工閱讀 `preview.md`，程式讀取 `preview.json`。
來源檔案 SHA-256、判斷來源、觀測時間、原始 appearances、各位置、專輯資訊均在 JSON。
`source_fingerprint` 是曲庫與快取解析後的語意雜湊；`source_files[].sha256` 是來源檔位元組雜湊。

`simulate_operations` 僅接受 offline adapter，可測試逐項重新驗證、分批、後驗證、錯誤停止、429 Retry-After 紀錄、已完成 operation_id 跳過。
所有模擬紀錄都標記 simulated，不能當作真實清理成功或 tombstone。
真實執行 adapter、OAuth scope／帳號核對、Spotify 即時 snapshot／位置核對、持久化成功與不確定結果復原尚未接入；正式工具不可直接上線。
目前不提供自動等待後重試；429 一律停止。

## ZIP 同步安全準備

現有匯入是檔案層級覆蓋，不是歌曲關係合併。不能直接用 OVERWRITE 代表同意刪除家裡獨有資料。
新安全閘先驗證 V2 結構及帳號；本機仍有來源未包含的歌曲關係或位置差異時，預覽及正式套用皆阻擋。
偵測任何一端的 `backup/library/cleanup-ledger.json` 時，也阻擋整檔匯入；此路徑已在既有 ZIP 的 backup/library 掃描範圍，不需新增重複 ZIP 系統。
本次沒有建立真實刪除紀錄，避免誤將候選當成已刪除。

關係預覽輸入：

```powershell
node scripts/cleanup-preview.js --sync-local=家裡library-v2.json --sync-incoming=已驗證公司library-v2.json --ledger=cleanup-ledger.json
```

僅使用經既有 ZIP preflight、版本、來源交接鏈、解壓 SHA 驗證的檔案；此 JSON CLI 不替代 ZIP 信任驗證。
ledger 格式：`{schema_version:1,user_id,events:[]}`。
每個真正完成的事件需 kind（playlist／liked）、container_id（僅歌單）、spotify_id、operation_id、status=applied_verified、verified_at、source_bundle_id。
候選、simulated、來源仍含該已刪除關係、帳號不同或資料不完整均阻擋。
saved_album 和 local_cache 是分開的事件類型，目前拒絕套用，不擴大成整張專輯或所有本機 Metadata 刪除。
本機獨有且沒有 tombstone 的關係列為 protected_local_only；其他歌單、按讚與專輯引用保留。

這仍是保守的同步準備，不是完整三方合併／套用引擎。正式同步需要：
1. 公司與家裡均使用本次安全閘版本。
2. 公司實際清理前逐項人工授權與即時驗證；執行中可靠保存成功、失敗與不確定結果。
3. 依真實驗證結果產生關係 tombstone 與來源 bundle 關聯，產生清理後全新 ZIP。
4. 家裡先備份，再驗證 ZIP 與來源、產生差異；以兩端共同基準進行三方對帳。
5. 人工核准精確差異後，另行實作及驗證關係層級套用、原子寫入、失敗復原與結果檢查。
本次不提供正式套用；請勿改用舊版匯入繞過阻擋。

## 驗證與保留

相關離線測試涵蓋分類、重複／無效 ID、多歌單與按讚、專輯保留、中途失敗與位置變動、公司刪除、家裡獨有、禁止復活、ZIP 損毀／版本／缺檔、加密及復原。
測試以 offline_guard 阻擋正式專案寫入與外部網路。
本次測試輸出保留於最新報告目錄的 tests.txt；備份驗證摘要在 backup-verification.json。
沒有測試真實讀寫權限、真實刪除與真實還原；不宣稱已具備安全正式刪除能力。

報告、計畫與測試輸出可在完成後續審核且正式稽核另有保留後刪除。
本次兩份時間戳報告均保留，較早一份為開發期間預覽；以後續交接註明的最新目錄為準。
系統 temp 的 spotify-cleanup-tests-20261105.txt、spotify-cleanup-preview-20261105.txt 可在報告副本確認後刪除。
既有 .data-sync-staging 與驗證解壓暫存由原工具自行回收；沒有清理任何使用者既有暫存。

本次結果：110 項相關離線測試通過（72 + 38）；最後關係結構補強後，清理 10 項重跑通過。最新預覽位於 reports/cleanup/2026-11-05T04-43-31-647Z-41668/。
額外 temp 紀錄：spotify-cleanup-gui-tests-20261105.txt、spotify-cleanup-final-tests-20261105.txt，報告副本確認後可刪除。
