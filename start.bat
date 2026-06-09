@echo off
title LME Bloomberg Bridge

echo Starting Bloomberg bridge...
start "LME Bloomberg Bridge" cmd /k "cd /d %~dp0 && python -m uvicorn backend.main:app --port 8000"

timeout /t 3 /nobreak > nul

echo Opening LME Order Entry...
start "" "%~dp0index.html"
