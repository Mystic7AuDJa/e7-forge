@echo off
cd /d "%~dp0"
rem electron-builder is fetched on demand here so the normal install stays lean and warning-free.
call npm run dist:win --no-update-notifier && echo Built: release\win-unpacked\E7 Forge.exe
pause
