@echo off
REM ==========================================
REM TikTok Automation Bridge — Auto Update (Windows)
REM ==========================================
REM Just double-click this file.

set REPO=yongprener/tiktok-automation-bridge
set BRANCH=main
set SCRIPT_DIR=%~dp0
set TMP_DIR=%TEMP%\tiktab-update
set ZIP_FILE=%TMP_DIR%\tiktab-latest.zip
set EXTRACT_DIR=%TMP_DIR%\extracted

echo ==========================================
echo   TikTok Automation Bridge - Update
echo ==========================================
echo.

REM Check for curl or powershell
where curl >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo curl not found. Using PowerShell...
  powershell -Command "Invoke-WebRequest -Uri 'https://github.com/%REPO%/archive/refs/heads/%BRANCH%.zip' -OutFile '%ZIP_FILE%'"
) else (
  echo Downloading latest version...
  mkdir "%TMP_DIR%" 2>nul
  curl -sL "https://github.com/%REPO%/archive/refs/heads/%BRANCH%.zip" -o "%ZIP_FILE%"
)

echo Extracting...
powershell -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%EXTRACT_DIR%' -Force"

REM Find extracted folder
for /d %%D in ("%EXTRACT_DIR%\*") do set EXTRACTED_FOLDER=%%D

if not exist "%EXTRACTED_FOLDER%\chrome-extension" (
  echo ERROR: Could not find chrome-extension folder.
  pause
  exit /b 1
)

echo Updating files...
xcopy /E /Y /I "%EXTRACTED_FOLDER%\chrome-extension" "%SCRIPT_DIR%\chrome-extension"

REM Clean up
rmdir /S /Q "%TMP_DIR%" 2>nul

echo.
echo ==========================================
echo   Updated successfully!
echo ==========================================
echo.
echo Now go to chrome://extensions and click the
echo refresh button on the extension card.
echo.
pause
