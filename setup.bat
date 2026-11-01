@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20+ is required: https://nodejs.org & pause & exit /b 1)
call npm install --no-audit --no-fund --no-update-notifier || (pause & exit /b 1)
set PIPARGS=-m pip install --user --upgrade --disable-pip-version-check --no-warn-script-location scapy==2.8.0
where py >nul 2>nul && (py -3 %PIPARGS%) || (python %PIPARGS%)
echo.
echo Setup done. Install Npcap (https://npcap.com, tick WinPcap API-compatible mode) for Live sync, then run start.bat
pause
