@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3 was not found. Install Python 3 and enable Add to PATH.
  pause
  exit /b 1
)
echo Starting ATHENA RF demo at http://localhost:8080
start "ATHENA RF Web" cmd /k "python -m http.server 8080"
timeout /t 2 >nul
start "" http://localhost:8080
endlocal
