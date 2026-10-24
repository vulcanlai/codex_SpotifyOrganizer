@echo off
setlocal EnableExtensions
if /i "%~1"=="__syntax_check__" exit /b 0
chcp 65001 >nul 2>&1
set "DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN="
set "DATA_SYNC_ALLOW_PROJECT_ROOT_OVERRIDE="
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

echo Unknown GUI mode: %GUI_MODE%
set "ERR=1"
goto done

:done
set "ERR=%ERRORLEVEL%"
echo.
pause
endlocal & exit /b %ERR%
