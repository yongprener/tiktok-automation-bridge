@echo off
REM ==========================================
REM TikTok Automation Bridge - Update (Windows)
REM ==========================================
REM Just double-click this file.
REM Uses git pull: smaller than re-downloading the zip, and shows you the diff.

set "SCRIPT_DIR=%~dp0"

echo ==========================================
echo   TikTok Automation Bridge - Update
echo ==========================================
echo.

cd /d "%SCRIPT_DIR%"

where git >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo ERROR: git tidak terinstall.
  echo Install dari https://git-scm.com/download/win lalu coba lagi.
  echo.
  pause
  exit /b 1
)

if not exist ".git" (
  echo ERROR: Folder ini bukan hasil git clone.
  echo Clone ulang:
  echo   git clone https://github.com/yongprener/tiktok-automation-bridge.git
  echo.
  pause
  exit /b 1
)

echo Pulling latest code...
git pull origin main

if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: git pull gagal.
  echo Kalau ada perubahan lokal yang bentrok, jalankan dulu:
  echo   git stash
  echo lalu ulangi update.bat.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('python -c "import json;print(json.load(open('chrome-extension/manifest.json'))['version'])" 2^>nul') do set VER=%%v
if "%VER%"=="" set VER=unknown

echo.
echo ==========================================
echo   Updated to v%VER%
echo ==========================================
echo.
echo Now go to chrome://extensions and click the
echo reload button on the extension card.
echo.
pause
