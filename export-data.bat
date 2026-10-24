@echo off
REM SpotifyOrganizer 加密資料匯出（工作目錄固定為本 bat 所在專案根）
setlocal
REM 正式匯出：清除測試專用環境變數，避免意外啟用 stdin／argv 密碼模式
set DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN=
set DATA_SYNC_ALLOW_PROJECT_ROOT_OVERRIDE=
cd /d "%~dp0"
node "%~dp0scripts\data-sync\export-data.js" %*
set EXITCODE=%ERRORLEVEL%
endlocal & exit /b %EXITCODE%
