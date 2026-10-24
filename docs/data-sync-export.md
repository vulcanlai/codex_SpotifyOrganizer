# 資料同步 — 匯出（第一階段）

## 用途

將 **minimal** 必要工作資料打包成 **7-Zip AES-256** 加密 ZIP，供公司／家裡另一台電腦交接。  
**不含** `.env`、`.spotify_tokens.json`、OAuth 憑證；兩台電腦各自保留。

## 前置

- 已安裝 **7-Zip**（本機需有 `7z.exe`；支援 **ZIP AES-256**）。
- 程式依序尋找：**PATH** → `Program Files\7-Zip` → `Program Files (x86)\7-Zip`；或 `--seven-zip "…\7z.exe"`／環境變數 **`SPOTIFY_ORGANIZER_7Z_PATH`**（**不掃描 D 槽**）。
- 專案路徑固定 **`D:\SpotifyOrganizer`**（與 `export-data.bat` 同目錄）。
- 先以 **`--dry-run`** 盤點檔案數與容量，確認無缺少必要檔案。

## 指令

```bat
cd /d D:\SpotifyOrganizer
export-data.bat --dry-run
export-data.bat --output "E:\交接\spotify-organizer-minimal.zip"
```

若 ZIP 要放在專案內，請只用：

`D:\SpotifyOrganizer\.data-sync-out\你的檔名.zip`

## 密碼

- 執行後 **7-Zip 會以 `-p` 互動方式** 要求輸入密碼（兩次），**不會**寫在命令列、`.env` 或日誌。
- 封裝完成後會執行 **`7z l -slt -p`**（互動或終端單次輸入 → stdin，僅列表）與 **`7z x -p`**（**互動解壓**至系統 temp）以 **重新計算 SHA-256** 與 manifest 比對。
- **注意**：7-Zip 25.01（Windows）對 **`7z x` 無法自 stdin 讀密碼**，正式匯化解壓驗證需您在 **7-Zip 解壓提示**再輸入一次密碼；密碼仍不寫 argv／`.env`／日誌。
- **Zip AES-256 通常仍會顯示檔名與目錄結構**；敏感內容靠加密，請使用強密碼。

## ZIP 內容

根目錄含 **`export-manifest.json`**（SHA-256、Git commit、profile、檔案清單），供日後 `import-data.bat` 比對。

## 限制（本階段）

- 僅匯出，**不匯入**、不修改 `backup/`／`imports/`／`reports/` 正式資料。
- 已存在的 ZIP 路徑會**拒絕覆寫**。
- 不會掃描或寫入 `D:\workCase`、`D:\vulcan-project-skills` 等專案外路徑。
