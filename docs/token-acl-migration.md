# 正式 Token ACL 遷移與復原

本文件及工具是執行準備，不代表 Codex 已執行正式遷移。先前一般 Windows 使用者的假檔案往返與跨程序 status 成功已由使用者確認；新版正式工具的 HKCU／真實 Token 操作仍待本人執行驗收。

## 執行身分與範圍

- 在本機、沙箱外、未提升權限的本人 Git Bash 執行。本人已確認與 Token 擁有者一致，目標 ACL 已核准為本人 Modify、SYSTEM／Administrators FullControl，排除其他主體。
- 先停止本專案的 OAuth、刷新、補全及其他 Token 使用程序；在遷移驗收前不要啟動它們。
- 正式入口固定處理本腳本所在專案的 `.spotify_tokens.json`，不接受目標路徑、SID、lab 或注入參數。沙箱帳號／群組成員及提升權限程序會在 Token／HKCU 檢查前被拒絕。
- 所有正式操作只讀取 Token 的檔案屬性、安全描述元及檔案識別。沒有 Token 資料串流的讀取、複製、雜湊或寫入，不呼叫 Spotify。
- 不修改專案或父目錄 ACL、不接管擁有者、不要求 Windows 特殊權限。執行期間嘗試持有目錄的禁止刪除分享控制及目標檔案的零資料存取鎖；有不相容開啟中的程序會安全失敗。
- 同一登入工作階段的各項操作另有互斥鎖；仍不要在不同終端機或登入工作階段並行啟動遷移／復原。程序中斷或逾時後，先確認本次 PowerShell 與 helper 子程序已結束，再人工復原，避免舊程序仍在完成操作。

## 一般使用者正式指令

請先確認目前程式碼與既有修改可信，再於 Git Bash 執行：

```bash
cd /d/SpotifyOrganizer &&
node scripts/token-acl-migrate.js preflight &&
node scripts/token-acl-migrate.js prepare --confirm-owner &&
node scripts/token-acl-migrate.js apply --confirm-acl &&
node scripts/token-acl-migrate.js verify
```

任一步非零退出便停止，不要跳過檢查或改用管理員重試。

1. `preflight`：唯讀核對身分、擁有者、一般檔案／單一連結、路徑及父目錄風險。`authorized:false` 在尚未設定核准值時是預期狀態；身分或目標不符則失敗。
2. `prepare --confirm-owner`：明確確認擁有者後，透過 Windows User 範圍 API 設定 HKCU Environment 的 `SPOTIFYORG_AUTHORIZED_WINDOWS_SID`。這不是僅信任程序 SID：必須通過沙箱拒絕、未提升權限、本人與目標擁有者比對。若已有不同值則保留並停止，不自動覆寫。設定失敗時嘗試恢復原值。
3. prepare 的下一個獨立程序重新讀取 HKCU，將原 DACL、繼承狀態、擁有者、檔案識別、建立／最後寫入時間、大小及目錄識別保存成持久快照。不修改 Token ACL。若快照已存在，僅在完整驗證後重用，不覆寫原始備份。
4. `apply --confirm-acl`：先驗證快照、核准值、目標未被替換或更新、目錄 ACL 未變，再呼叫既有 `token_file_acl.ps1` 一次提交完整 DACL，停用 Token 繼承並保留核准的三個主體。
5. 套用後再次核對核准設定與目標 ACL，再由另一程序執行 verify。成功輸出 `target_verified:true`；核准值由正式程式每次從 Windows User 範圍讀取，不依賴 Git Bash 匯出的值或 `.env`，不需要將 SID 寫入專案檔案。

## 快照與失敗處理

快照固定存於本人 `%LOCALAPPDATA%\SpotifyOrganizer-TokenAclRecovery-<專案與帳號雜湊>`；位置由工具回報，不接受外部路徑。只建立此新私人目錄，不修改既有父目錄權限；快照位於 Git 儲存庫內或有重新解析點時拒絕。

`original.bin` 只有 ACL 中繼資料；`original.key` 與 `original.hmac` 提供 HMAC-SHA256 完整性驗證。私人目錄及其檔案只允許本人、SYSTEM、Administrators FullControl。中繼資料未加密，包含 SID，請不要貼出、分享、加入 Git，或與金鑰分離遺失。同帳號與系統管理員是信任邊界，HMAC 無法抵抗可同時改寫金鑰與快照的主體。

套用／事後驗證失敗會嘗試從持久快照恢復原 DACL，回報 `rollback_attempted` 與 `rollback_succeeded`。診斷只記錄固定錯誤分類、例外類型與數字錯誤碼；不輸出 Token、完整 SID、SDDL 或原始例外。程序中斷、逾時或復原失敗時仍保留快照，不自動清理。

## 人工復原（只在需要撤回 ACL 修改時）

同一本人帳號、同一機器及原專案位置，另開 Git Bash：

```bash
cd /d/SpotifyOrganizer &&
node scripts/token-acl-migrate.js restore --confirm-original-acl
node scripts/token-acl-migrate.js recovery-status
```

restore 不需要 HKCU 核准值，仍必須通過正式身分／擁有者、快照 HMAC、檔案／目錄身分及中繼資料驗證。它只還原原始 DACL／繼承狀態，不改內容、Owner、Group 或 SACL。原 ACL 可能重新包含廣泛群組、沙箱及未知 SID；這是撤回遷移，不是完成加固。HKCU 核准值不會因 ACL 撤回而自動刪除。

`restore` 會在另一個程序核對 `original_restored:true`。正常遷移成功而未撤回時，`recovery-status` 的 `original_restored:false` 是預期狀態，不能據此自行復原。

如果 Token 已被更新、替換、增加連結，或父目錄 ACL／身分已變，復原會停止，不能刪掉驗證或猜測新目標；先保留診斷。比對原 ACL 時僅忽略 Windows 可自行補上的 AUTO_INHERITED 資訊位元，仍精確比較全部 ACE 與繼承保護狀態。

## 剩餘風險與驗證界線

- Token ACL 無法處理專案目錄原有的程式碼竄改、目錄替換或刪除風險。`parent_risk:true` 是風險提示，不會自動修改父目錄。操作期間的鎖定也不等於永久保護；應另行規劃程式碼與憑證儲存邊界。
- 快照存在不保證磁碟故障、快照遺失或 Windows 不允許 WRITE_DAC 時必能恢復；不提供強制接管或自動提高權限。
- 本人已完成舊假檔案工具的實機驗證；新版核心在沙箱的獨立 lab 執行，HKCU 以 lab 檔案模擬，目標固定為 dummy.txt。這不等於新版正式 HKCU 寫入及真實 Token 遷移已驗證。
- 真實快照須由本人執行 prepare 產生；Codex 準備期間不產生沙箱身分的正式快照，不設定本人 HKCU，不執行遷移。
- 快照、成功與失敗的 lab 都不自動刪除；在正式驗收且確認不需復原前保留。使用者既有測試目錄維持不動。

完整離線測試（原有 97 項、復原工具 5 項、新版遷移引擎測試）：

```bash
node test/helpers/run_token_acl_preparation_tests.js
```
