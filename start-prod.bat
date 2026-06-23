@echo off
title LME Bloomberg Bridge - PROD
set LME_ENV=PROD

if not exist "%~dp0.env.prod" (
    echo ERROR: .env.prod not found. Copy .env.prod.example to .env.prod and fill in your values.
    pause
    exit /b 1
)

echo Starting Bloomberg bridge in PROD...
start "LME Bloomberg Bridge - PROD" cmd /k "cd /d %~dp0 && set LME_ENV=PROD && python -m uvicorn backend.main:app --port 8000"

timeout /t 3 /nobreak > nul

echo Opening LME Order Entry...
start "" "%~dp0index.html"
