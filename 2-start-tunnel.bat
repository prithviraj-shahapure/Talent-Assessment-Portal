@echo off
title Zanvar Exam Portal - Cloudflare Public Tunnel
echo ============================================================
echo   ZANVAR GROUP EXAM PORTAL - CLOUDFLARE PUBLIC TUNNEL
echo ============================================================
echo.
cd /d "%~dp0"
echo Starting secure public HTTPS link to http://localhost:4000...
echo.
echo Look for the line below starting with:
echo https://xxxx.trycloudflare.com
echo.
echo Copy that link and share it with your candidates!
echo (Keep this window open while the exam is taking place)
echo.
tools\cloudflared.exe tunnel --url http://localhost:4000
pause
