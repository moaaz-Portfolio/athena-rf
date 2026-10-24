@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3 was not found. Install Python 3.11 or newer and enable Add to PATH.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo Creating Python environment...
  python -m venv .venv
  if errorlevel 1 goto :fail
)
call ".venv\Scripts\activate.bat"
echo Installing backend dependencies...
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
if errorlevel 1 goto :fail
echo Starting ATHENA RF API + UDP CSI listener on port 5005...
start "ATHENA RF Server" cmd /k ""%CD%\.venv\Scripts\python.exe" -m uvicorn backend.app:app --host 0.0.0.0 --port 8080"
timeout /t 3 >nul
start "" http://localhost:8080
echo The dashboard should open at http://localhost:8080.
echo Leave the ATHENA RF Server window open while using the dashboard.
exit /b 0
:fail
echo Setup failed. Copy the complete error above and send it for troubleshooting.
pause
exit /b 1
