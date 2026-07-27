@echo off
title Bailey ^& Beau - Backend
cd /d C:\laragon\www\bailyandbeau\backend
if not exist .env copy .env.example .env
call venv\Scripts\activate.bat
python manage.py migrate
REM Windows reserves TCP 7912-8011 and 8017-8116 (netsh interface ipv4
REM show excludedportrange protocol=tcp), so the default port 8000 and the
REM previously used 8001 both fail to bind. 8300 is outside every range and
REM matches frontend/.env.local.
python manage.py runserver 8300
pause
