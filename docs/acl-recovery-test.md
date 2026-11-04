# Windows ACL 復原實機測試

此工具只操作新建的 `%TEMP%\spotify-acl-probe-v1-<帳號雜湊>`，不操作既有的 `spotify-acl-recovery-test`，也不接受任何目標路徑。工具不載入 Token、OAuth、專案設定或 HKCU 核准設定；請使用未提升權限的一般使用者終端機。

在專案根目錄的 Git Bash 執行：

```bash
node scripts/acl-recovery-test.js run
```

每步會啟動新的 Windows PowerShell 程序，依序建立假檔案及快照、寫回原 DACL、呼叫既有 `token_file_acl.ps1` 套用受限 DACL、由新程序復原，再查核結果。只使用 Access-only .NET 方法，不呼叫 `icacls /restore`，不提升權限或變更 ExecutionPolicy。

測試目錄在建立時即指定受限 DACL，只授權目前測試帳號、SYSTEM、Administrators。這裡的帳號僅限假檔案測試，不表示核准其存取正式 Token。

`snapshot.bin` 只含原 DACL、繼承狀態、擁有者、固定目標路徑及檔案／目錄識別；沒有假檔案內容或 Token。隨機金鑰存於 `snapshot.key`，以 HMAC-SHA256 驗證 `snapshot.hmac`，三者均位於受限目錄；不依賴 DPAPI 或使用者金鑰環境。ACL 中繼資料沒有加密，不應分享或輸出完整內容。同帳號、SYSTEM 與 Administrators 是信任邊界：若可改寫金鑰與快照，也可重新簽署，HMAC 不能抵抗此邊界內的惡意修改。工具拒絕 TEMP 位於 Git 儲存庫內的情況；快照不能直接移到不同帳號、路徑或檔案使用。

失敗時保留全部資料，錯誤報告只含階段、固定分類與數字錯誤碼，不印完整 SID、SDDL 或原始例外。保持同一 Windows 帳號及相同 TEMP／TMP 設定，另開新的程序執行：

```bash
node scripts/acl-recovery-test.js restore
```

唯讀檢查：

```bash
node scripts/acl-recovery-test.js status
```

復原前驗證受限目錄、路徑無重新解析點、快照 HMAC 完整性、擁有者、磁碟／檔案識別、建立時間、單一連結及目錄 DACL。目標被替換、快照損壞或目錄權限變動時拒絕寫入，不自動猜測或修正。當父目錄／繼承來源改變時也不能保證精確復原。

寫回後逐位元組比對 DACL 中的 ACE（包含順序、SID、權限及旗標），並核對繼承保護狀態。僅忽略 Windows 可能自行補上的 `DACL_AUTO_INHERITED` 資訊旗標；不忽略任何授權差異。

工具不自動清理任何資料；`run` 遇到既有工具目錄會停止，不覆蓋先前診斷。確認 `run` 全部步驟成功且 `status` 顯示 `restored:true`、`cleanup_eligible:true` 後，可另行核准清理報告中的專用目錄（dummy、快照與 result.json）。失敗案例須先保留證據、釐清原因。不要刪除使用者既有的復原測試目錄。

離線檢查：

```bash
node --test --test-concurrency=1 test/acl_recovery_tool.test.js
node test/helpers/run_token_acl_tests.js
```

新增測試以新建的 `so-acl-probe-tests-*` TEMP 隔離，每組都保留診斷資料。沙箱通過不代表一般 Windows 使用者實機通過；正式 Token 遷移仍需另外授權。
