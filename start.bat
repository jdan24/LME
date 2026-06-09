@echo off
title LME Order Entry

echo Starting Bloomberg backend...
start "LME Backend" cmd /k "cd /d %~dp0 && uvicorn backend.main:app --port 8000 --reload"

timeout /t 3 /nobreak > nul

echo Starting frontend dev server...
start "LME Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 3 /nobreak > nul

echo Opening browser...
start http://localhost:5173

echo.
echo LME Order Entry is starting up.
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:5173
echo.
echo Close the two terminal windows to shut down.
