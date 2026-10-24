@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run START-ATHENA.bat first so the Python environment is created.
  pause
  exit /b 1
)
call ".venv\Scripts\activate.bat"
echo Installing deep-learning training packages. This can download PyTorch.
python -m pip install -r ml\requirements.txt
if errorlevel 1 goto :fail
python ml\train.py
if errorlevel 1 goto :fail
echo.
echo Done. Go back to the dashboard and click Reload model.
pause
exit /b 0
:fail
echo Training failed. Check the error text and the training-data requirements in README_AR.md.
pause
exit /b 1
