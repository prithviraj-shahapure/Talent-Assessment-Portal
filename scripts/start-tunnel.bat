@echo off
echo ============================================================
echo   ZANVAR GROUP TALENT ASSESSMENT PORTAL - CLOUDFLARE TUNNEL
echo ============================================================
echo.
echo Starting secure HTTPS tunnel to http://localhost:4000...
echo.
tools\cloudflared.exe tunnel --url http://localhost:4000
pause

