@echo off
setlocal
cd /d "%~dp0..\.."
set "SO_GUI_PICK_TRACE=%TEMP%\so-gui-pick-trace-formal-%RANDOM%.log"
echo SO_GUI_PICK_TRACE=%SO_GUI_PICK_TRACE%
echo Host: same as Chinese BAT (start /B wscript)
if /i "%~1"=="acceptance" (
  start "" /B wscript.exe //nologo "%~dp0run-gui-launcher.vbs" acceptance
) else (
  start "" /B wscript.exe //nologo "%~dp0run-gui-launcher.vbs" import
)
echo Launched. Wait then read:
echo   %TEMP%\so-gui-pick-trace-latest.txt
endlocal
