@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Stopping Drillly API on port 5213...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5213" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5213"') do (
  taskkill /F /PID %%a >nul 2>&1
)

if not exist ".venv\Scripts\python.exe" (
  echo Venv missing. Run run.bat once to create it.
  pause
  exit /b 1
)

call ".venv\Scripts\python.exe" scripts\reset_all.py
if errorlevel 1 (
  echo.
  echo Reset failed. Close all Drillly API windows manually, then run this again.
  pause
  exit /b 1
)
echo.
echo Done. Start Drillly API with Start-Drillly-API.bat, then re-import PDFs.
pause
endlocal
