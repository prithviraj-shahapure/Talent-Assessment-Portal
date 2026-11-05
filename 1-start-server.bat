@echo off
title Zanvar Exam Portal - Server & Database
echo ============================================================
echo   ZANVAR GROUP EXAM PORTAL - SERVER & DATABASE
echo ============================================================
echo.
cd /d "%~dp0"
echo Starting PostgreSQL database and Express server on port 4000...
echo.
node scripts/dev-local.mjs
pause
