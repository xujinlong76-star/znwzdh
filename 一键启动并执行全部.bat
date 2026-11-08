@echo off
title NavHub v5.0 Auto Launcher

echo ======================================================================
echo   NavHub AI-Native Hub v5.0 - Auto Clean and Launch Pipeline
echo ======================================================================
echo.

echo [1/4] Mapping virtual drive G: to Desktop...
subst G: /d >nul 2>&1
subst G: "C:\Users\88\Desktop"

cd /d "%~dp0"

echo [2/4] Current project directory: %CD%

echo.
echo [3/4] Running database clean, taxonomy restructuring and deduplication...
node scripts/clean-taxonomy-and-duplicates.mjs

echo.
echo [4/4] Checking and clearing ports 3000 and 8787 ...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo     Releasing port 3000 (PID: %%a)...
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8787 " ^| findstr "LISTENING"') do (
    echo     Releasing port 8787 (PID: %%a)...
    taskkill /f /pid %%a >nul 2>&1
)

echo     Launching browser at http://localhost:3000 ...
start "" "http://localhost:3000"
node scripts/dev-all.mjs

pause
