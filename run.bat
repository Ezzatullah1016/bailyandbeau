@echo off
title Bailey and Beau - Dev Servers

:: Kill anything on ports 8000 and 3000
echo Clearing ports 8000 and 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 "') do taskkill /PID %%a /F >nul 2>&1

:: Start Django backend in a new window
echo Starting Django backend (listening on all interfaces — LAN access) ...
start "Django Backend" cmd /k "cd /d %~dp0backend && if exist .venv\Scripts\python.exe (.venv\Scripts\python.exe manage.py runserver 0.0.0.0:8000) else (venv\Scripts\python.exe manage.py runserver 0.0.0.0:8000)"

:: Wait a moment then start Next.js frontend
timeout /t 2 /nobreak >nul

echo Starting Next.js frontend (all interfaces — LAN access) ...
start "Next.js Frontend" cmd /k "cd /d %~dp0frontend && npm run dev:lan"

echo.
echo Both servers are starting up.
echo   On this PC:  http://localhost:8000  ^|  http://localhost:3000
echo   Same Wi-Fi/LAN: http://YOUR_IP:8000  ^|  http://YOUR_IP:3000  (run ipconfig, use IPv4 address)
echo   If admin login CSRF fails from another PC, set in backend\.env:
echo     DJANGO_DEV_CSRF_ORIGINS=http://YOUR_IP:8000
echo   Allow Python / Node.js through Windows Firewall for Private networks if prompted.
echo.
pause
