@echo off
REM 模擬公司端匯入驗收（僅 TEMP 沙箱，不寫入正式專案工作資料）
setlocal
set DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN=
set DATA_SYNC_ALLOW_PROJECT_ROOT_OVERRIDE=
cd /d "%~dp0"
node "%~dp0scripts\data-sync\acceptance-sandbox-import.js" %*
set EXITCODE=%ERRORLEVEL%
endlocal & exit /b %EXITCODE%
