@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Creating Python environment...
  python -m venv .venv
  if errorlevel 1 goto :fail
)
call ".venv\Scripts\activate.bat"
echo Installing importer/training dependencies...
python -m pip install --upgrade pip
python -m pip install -r ml\requirements.txt
if errorlevel 1 goto :fail
echo.
echo Download the ESP-Fi HAR dataset ZIP from:
echo https://github.com/AutoSmartGroup/ESP-Fi-HAR
set /p DATASET_DIR=Enter the full path to the extracted dataset folder: 
if "%DATASET_DIR%"=="" goto :fail
python ml\import_esp_fi_har.py --input "%DATASET_DIR%"
if errorlevel 1 goto :fail
echo.
echo Import complete. Next run START-TRAIN.bat.
pause
exit /b 0
:fail
echo Import failed. Check the error above.
pause
exit /b 1
