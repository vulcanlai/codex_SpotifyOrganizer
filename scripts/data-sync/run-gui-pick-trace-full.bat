@echo off
setlocal
cd /d "%~dp0..\.."
if /i "%~1"=="skip-initial-dir" (
  cscript //nologo "%~dp0run-gui-launcher.vbs" __trace__ import skip-initial-dir
) else if /i "%~1"=="acceptance" (
  cscript //nologo "%~dp0run-gui-launcher.vbs" __trace__ acceptance
) else (
  cscript //nologo "%~dp0run-gui-launcher.vbs" __trace__ import
)
if errorlevel 1 (
  echo TRACE FULL FAILED: launcher exit %ERRORLEVEL%
  exit /b 1
)
node "%~dp0verify-gui-pick-trace-latest.js"
if errorlevel 1 (
  echo TRACE FULL FAILED: log verify
  exit /b 1
)
echo TRACE FULL OK
endlocal & exit /b 0
