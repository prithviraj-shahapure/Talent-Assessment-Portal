@echo off
title Zanvar Group Exam Portal Launcher
echo ============================================================
echo   LAUNCHING ZANVAR GROUP EXAM PORTAL
echo ============================================================
echo.
cd /d "%~dp0"
echo 1. Starting Database and Application Server...
start "Zanvar Server & Database" cmd /k "node scripts/dev-local.mjs"
echo.
echo 2. Waiting for server to initialize (6 seconds)...
timeout /t 6 /nobreak >nul
echo.
echo 3. Starting Permanent Static Ngrok Tunnel...
start "Zanvar Permanent Ngrok Tunnel" cmd /k "tools\ngrok.exe http --url=upside-congenial-bullpen.ngrok-free.dev 4000"
echo.
echo ============================================================
echo  Both windows are now running!
echo.
echo  YOUR PERMANENT HTTPS LINK (NEVER CHANGES):
echo  https://upside-congenial-bullpen.ngrok-free.dev
echo.
echo  Share this exact link with your candidates!
echo  (Keep both windows open while candidates are testing)
echo ============================================================
echo.
pause
