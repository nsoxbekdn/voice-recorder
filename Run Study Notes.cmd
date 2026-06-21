@echo off
REM Double-click this any time you finish studying to process new recordings now.
echo Processing study recordings...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0study-notes.ps1"
echo.
echo Done. Press any key to close.
pause >nul
