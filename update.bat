@echo off
REM ==========================================
REM TikTok Automation Bridge — Auto Update (Windows)
REM ==========================================
REM Just double-click this file.

set "SCRIPT_DIR=%~dp0"
set "TMP_DIR=%TEMP%\tiktab-update"

echo ==========================================
echo   TikTok Automation Bridge - Update
echo ==========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$url = 'https://github.com/yongprener/tiktok-automation-bridge/archive/refs/heads/main.zip';" ^
  "$tmp = '%TMP_DIR%';" ^
  "$zip = Join-Path $tmp 'tiktab-latest.zip';" ^
  "$extract = Join-Path $tmp 'extracted';" ^
  "Write-Host 'Downloading...';" ^
  "New-Item -ItemType Directory -Force -Path $tmp | Out-Null;" ^
  "Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing;" ^
  "Write-Host 'Extracting...';" ^
  "if (Test-Path $extract) { Remove-Item -Recurse -Force $extract };" ^
  "Expand-Archive -Path $zip -DestinationPath $extract -Force;" ^
  "$src = Get-ChildItem -Directory $extract | Select-Object -First 1;" ^
  "$extSrc = Join-Path $src.FullName 'chrome-extension';" ^
  "if (-not (Test-Path $extSrc)) { Write-Host 'ERROR: chrome-extension not found'; exit 1 };" ^
  "$dest = '%SCRIPT_DIR%chrome-extension';" ^
  "Write-Host 'Copying files...';" ^
  "Copy-Item -Path (Join-Path $extSrc '*') -Destination $dest -Recurse -Force;" ^
  "Remove-Item -Recurse -Force $tmp;" ^
  "Write-Host 'Done!'"

if %ERRORLEVEL% neq 0 (
  echo.
  echo Update failed. Try manually:
  echo 1. Download from https://github.com/yongprener/tiktok-automation-bridge/archive/refs/heads/main.zip
  echo 2. Extract and copy chrome-extension folder
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
