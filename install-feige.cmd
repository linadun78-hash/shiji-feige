@echo off
setlocal
cd /d "%~dp0"
python -m server.native_setup install
if errorlevel 1 goto done
echo Registration complete. Enable or reload the Feige extension, then click its toolbar icon.
echo Keep this project folder and the registered Python installation in place.
:done
pause
