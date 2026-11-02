@echo off
setlocal
cd /d "%~dp0..\.."
echo AB test: same as run-formal-pick-with-trace.bat but NO SO_GUI_PICK_TRACE
if /i "%~1"=="acceptance" (
  start "" /B wscript.exe //nologo "%~dp0run-gui-launcher.vbs" acceptance
) else (
  start "" /B wscript.exe //nologo "%~dp0run-gui-launcher.vbs" import
)
echo Launched (no trace).
endlocal
