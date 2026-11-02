@echo off
setlocal
cd /d "%~dp0..\.."
set "SO_GUI_PICK_TRACE=%TEMP%\so-gui-pick-trace-formal-cscript-%RANDOM%.log"
echo SO_GUI_PICK_TRACE=%SO_GUI_PICK_TRACE%
echo Host: cscript sync (same node path as trace-full)
if /i "%~1"=="acceptance" (
  cscript //nologo "%~dp0run-gui-launcher.vbs" acceptance
) else (
  cscript //nologo "%~dp0run-gui-launcher.vbs" import
)
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" echo formal cscript exit %ERR%
if exist "%TEMP%\so-gui-pick-trace-latest.txt" type "%TEMP%\so-gui-pick-trace-latest.txt"
endlocal & exit /b %ERR%
