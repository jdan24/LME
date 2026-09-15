@echo off
title LME Bloomberg Bridge - PROD
set LME_ENV=PROD

if not exist "%~dp0.env.prod" (
    echo ERROR: .env.prod not found. Copy .env.prod.example to .env.prod and fill in your values.
    pause
    exit /b 1
)

echo Starting Bloomberg bridge in PROD...
:: backend.launch picks a free port (8000 or the next one free), or reuses an
:: already-running PROD bridge, then opens LME Order Entry in the browser.
start "LME Bloomberg Bridge - PROD" cmd /k "cd /d %~dp0 && python -m backend.launch"
