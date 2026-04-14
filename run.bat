@echo off
title Bailey and Beau - Dev Servers

:: Kill anything on ports 8000 and 3000
echo Clearing ports 8000 and 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 "') do taskkill /PID %%a /F >nul 2>&1

:: Start Django backend in a new window
echo Starting Django backend on http://localhost:8000 ...
start "Django Backend" cmd /k "cd /d c:\laragon\www\bailyandbeau\backend && python manage.py runserver 8000"

:: Wait a moment then start Next.js frontend
timeout /t 2 /nobreak >nul

echo Starting Next.js frontend on http://localhost:3000 ...
start "Next.js Frontend" cmd /k "cd /d c:\laragon\www\bailyandbeau\frontend && npm run dev"

echo.
echo Both servers are starting up.
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:3000
echo.
pause
