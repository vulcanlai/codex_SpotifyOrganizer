@echo off
REM 階段 2：顯示命令視窗（由 run-gui-launcher.vbs 呼叫）
chcp 65001 >nul 2>&1
setlocal
set DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN=
set DATA_SYNC_ALLOW_PROJECT_ROOT_OVERRIDE=
cd /d "%~dp0..\.."

set "GUI_MODE=%~1"
set "GUI_PICK_RESULT=%~2"

if /i "%GUI_MODE%"=="export" (
  node "%~dp0export-data-gui.js" --pick-result-file "%GUI_PICK_RESULT%"
  goto done
)
if /i "%GUI_MODE%"=="import" (
  node "%~dp0import-data-gui.js" --pick-result-file "%GUI_PICK_RESULT%"
  goto done
)
if /i "%GUI_MODE%"=="acceptance" (
  node "%~dp0acceptance-sandbox-gui.js" --pick-result-file "%GUI_PICK_RESULT%"
  goto done
)

echo 未知 GUI 模式：%GUI_MODE%
set ERR=1
goto done

:done
set ERR=%ERRORLEVEL%
echo.
pause
endlocal & exit /b %ERR%
