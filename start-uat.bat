@echo off
title LME Bloomberg Bridge - UAT
set LME_ENV=UAT

if not exist "%~dp0.env.uat" (
    echo ERROR: .env.uat not found. Copy .env.uat.example to .env.uat and fill in your values.
    pause
    exit /b 1
)

echo Starting Bloomberg bridge in UAT...
:: backend.launch picks a free port (8000 or the next one free), or reuses an
:: already-running UAT bridge, then opens LME Order Entry in the browser.
start "LME Bloomberg Bridge - UAT" cmd /k "cd /d %~dp0 && python -m backend.launch"
