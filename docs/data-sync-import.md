# 資料同步 — 匯入（第二階段）

## 流程

1. **預覽**：`import-data.bat --input "…zip" --dry-run`（不修改 `backup/` 等正式資料）
2. **正式匯入**：`import-data.bat --input "…zip" --apply --confirm=I_UNDERSTAND_DATA_SYNC_IMPORT`

ZIP 密碼由 **7-Zip 互動 `-p`** 輸入。解壓前會先檢查 ZIP 成員路徑（白名單／穿越／大小寫碰撞），再只解出 `export-manifest.json` 比對 listing，通過後才全量解壓至 `.data-sync-import-staging/` 驗證 SHA-256。

## 交接狀態（A 方案往返）

| 檔案 | 時機 | 用途 |
|------|------|------|
| `.data-sync-state/last-export.json` | 成功 **export** 後 | 本機最後匯出的 bundle_id、檔案 SHA 基準、handoff 父節點 |
| `.data-sync-state/last-import.json` | 成功 **import** 後 | 本機最後匯入的 bundle_id、基準、handoff 父節點 |

**Manifest**（`export-manifest.json`）新增可選欄位 `handoff_previous_bundle_id`：指向上一包 bundle 的 **內容雜湊 ID**（非 `exported_at`）。`bundle_id` 仍只由 `files[]` 內容決定；`source_git_commit` 僅供程式版本相容提示。

典型往返：家裡有資料、先匯出 ZIP A（建立 `last-export`）→ 公司空白匯入 A → 公司改資料匯出 B → 家裡匯入 B 時以 **`export_handoff_continuation`**（父 bundle = 家裡 last-export）接續，**不**再誤判 `local_data_no_state`。

- 同一 bundle 重複匯入：`duplicate_bundle`（可略過寫入）
- 兩台各自匯出、父節點相同但 bundle 不同：`handoff_branch` → **停止**，不自動合併
- 缺少 `handoff_previous_bundle_id` 的舊版 ZIP 在已有交接狀態時：**停止**（請用新版 export 重匯）

## 衝突與安全

- 本機已有工作資料但無 `last-export`／`last-import` → **停止**
- 本機檔案 SHA 偏離「交接 tip」對應基準 → **local_modified**
- 不得寫入 `.env`、token；ZIP 成員白名單與匯出相同

## 備份

正式匯入前備份至 `.data-sync-pre-import-backup/{run-id}/`（含 `last-import.json`／`last-export.json`）。失敗時還原已覆蓋檔、**刪除本次匯入才新增的檔**、還原交接狀態；備份驗證失敗則不寫入正式資料。

## 7-Zip

與匯出相同：PATH → Program Files → (x86)，或 `--seven-zip`／`SPOTIFY_ORGANIZER_7Z_PATH`。
