@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Creating Python venv...
  python -m venv .venv
  if errorlevel 1 (
    echo Failed: install Python 3.11+ and add to PATH.
    pause
    exit /b 1
  )
)
echo Installing/updating API dependencies...
call ".venv\Scripts\pip.exe" install -r requirements.txt -q
if errorlevel 1 (
  echo pip install failed.
  pause
  exit /b 1
)
call ".venv\Scripts\python.exe" -c "import fitz; print('pymupdf OK')"
if errorlevel 1 (
  echo pymupdf missing - run: .venv\Scripts\pip install pymupdf
  pause
  exit /b 1
)
if not exist ".env" if exist ".env.example" copy /y ".env.example" ".env" >nul
call ".venv\Scripts\python.exe" scripts\seed_demo.py
if not defined DRILLLY_PORT set DRILLLY_PORT=5213
echo Drillly API http://127.0.0.1:%DRILLLY_PORT%/docs
call ".venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port %DRILLLY_PORT% --reload
pause
endlocal
