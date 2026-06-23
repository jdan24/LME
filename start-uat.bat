@echo off
title LME Bloomberg Bridge - UAT
set LME_ENV=UAT

if not exist "%~dp0.env.uat" (
    echo ERROR: .env.uat not found. Copy .env.uat.example to .env.uat and fill in your values.
    pause
    exit /b 1
)

echo Starting Bloomberg bridge in UAT...
start "LME Bloomberg Bridge - UAT" cmd /k "cd /d %~dp0 && set LME_ENV=UAT && python -m uvicorn backend.main:app --port 8000"

timeout /t 3 /nobreak > nul

echo Opening LME Order Entry...
start "" "%~dp0index.html"
