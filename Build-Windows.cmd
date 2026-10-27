@echo off
setlocal
rem ------------------------------------------------------------------
rem  Gitpicky - build the Windows installer.
rem  Double-click this file. When it finishes, the release folder opens
rem  with Gitpicky-<version>-win-x64.exe (installer) and a portable zip.
rem  macOS and Linux builds come from GitHub Actions (push a v* tag).
rem ------------------------------------------------------------------
title Gitpicky - Windows build
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org and run this again.
  goto :fail
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git was not found. Install it from https://git-scm.com and run this again.
  goto :fail
)

echo.
echo [1/3] Installing dependencies (quick if nothing changed)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail

echo.
echo [2/3] Running tests...
call npm test
if errorlevel 1 (
  echo.
  echo Tests failed, so no installer was built. See the messages above.
  goto :fail
)

echo.
echo [3/3] Building the installer...
call npm run dist:win
if errorlevel 1 (
  echo.
  echo The build failed. If you see "Cannot create symbolic link", turn on
  echo Developer Mode in Windows Settings ^(or run this as administrator^) and try again.
  goto :fail
)

echo.
echo Done! Opening the release folder...
start "" "%~dp0release"
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
