@echo off
setlocal
title Zanvar Talent Assessment Portal
cd /d "%~dp0"
echo ============================================================
echo   Zanvar Group - Talent Assessment Portal (local start)
echo ============================================================

where node >nul 2>nul || (echo [X] Node.js not found. Install Node 20+ from https://nodejs.org and run this again. & pause & exit /b 1)
for /f "delims=" %%v in ('node -v') do echo [ok] Node %%v

call node scripts\dev-local.mjs env || (pause & exit /b 1)

rem Install dependencies on the first run, and again whenever package-lock.json changes
call node scripts\dev-local.mjs check-install
if errorlevel 1 (
  echo.
  echo Installing / updating dependencies - this can take a few minutes...
  call npm install
  if errorlevel 1 (
    echo [X] npm install failed.
    pause
    exit /b 1
  )
  call node scripts\dev-local.mjs mark-installed
)

node scripts\dev-local.mjs
pause
