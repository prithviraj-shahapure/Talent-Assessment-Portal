@echo off
title Zanvar Exam Portal - Permanent Ngrok Tunnel
echo ============================================================
echo   ZANVAR GROUP EXAM PORTAL - PERMANENT STATIC TUNNEL
echo ============================================================
echo.
cd /d "%~dp0"
echo Starting permanent static HTTPS tunnel to http://localhost:4000...
echo.
echo ============================================================
echo   PERMANENT LIVE URL (NEVER CHANGES):
echo   https://upside-congenial-bullpen.ngrok-free.dev
echo ============================================================
echo.
echo Share this permanent URL with your students/candidates!
echo (Keep this window open while the exam is taking place)
echo.
tools\ngrok.exe http --url=upside-congenial-bullpen.ngrok-free.dev 4000
pause
