@echo off
cd /d "%~dp0"
echo Launching desktop app with debug logging...
echo Debug log: %~dp0desktop_debug.log
python desktop_app.py
echo.
echo If it failed, open desktop_debug.log in this folder.
pause
