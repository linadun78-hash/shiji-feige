@echo off
setlocal
cd /d "%~dp0"
python -m server.native_setup uninstall
echo This removes auto-start registration only. To stop the background service use stop-feige.cmd.
pause
