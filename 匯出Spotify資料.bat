@echo off
REM 階段 1 隱藏檔案選擇；階段 2 才顯示命令視窗（密碼／結果）
start "" /B wscript.exe //nologo "%~dp0scripts\data-sync\run-gui-launcher.vbs" export
exit /b 0
