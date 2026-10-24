@echo off
REM SpotifyOrganizer 加密資料匯入
setlocal
set DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN=
set DATA_SYNC_ALLOW_PROJECT_ROOT_OVERRIDE=
cd /d "%~dp0"
node "%~dp0scripts\data-sync\import-data.js" %*
set EXITCODE=%ERRORLEVEL%
endlocal & exit /b %EXITCODE%
