@echo off
title Zanvar Group Exam Portal Launcher
echo ============================================================
echo   LAUNCHING ZANVAR GROUP EXAM PORTAL (CLOUDFLARE TUNNEL)
echo ============================================================
echo.
cd /d "%~dp0"
echo 1. Starting Database and Application Server...
start "Zanvar Server & Database" cmd /k "node scripts/dev-local.mjs"
echo.
echo 2. Waiting for server to initialize (6 seconds)...
timeout /t 6 /nobreak >nul
echo.
echo 3. Starting Cloudflare Public HTTPS Tunnel...
start "Zanvar Cloudflare Tunnel" cmd /k "tools\cloudflared.exe tunnel --url http://localhost:4000"
echo.
echo ============================================================
echo  Both windows are now running!
echo.
echo  1. Look at the "Zanvar Cloudflare Tunnel" window.
echo  2. Copy the https://xxxx.trycloudflare.com link.
echo  3. Open it in your browser or send to students!
echo  (Keep both windows open while the test is active)
echo ============================================================
echo.
pause
