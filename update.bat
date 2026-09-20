@echo off
REM ==========================================
REM TikTok Automation Bridge — Auto Update (Windows)
REM ==========================================
REM Just double-click this file.
REM Uses git pull (works with private repos).

set "SCRIPT_DIR=%~dp0"

echo ==========================================
echo   TikTok Automation Bridge - Update
echo ==========================================
echo.

cd /d "%SCRIPT_DIR%"

echo Pulling latest code...
git pull origin main

if %ERRORLEVEL% neq 0 (
  echo.
  echo Update failed. Make sure git is installed and you have access to the repo.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   Updated successfully!
echo ==========================================
echo.
echo Now go to chrome://extensions and click the
echo refresh button on the extension card.
echo.
pause
