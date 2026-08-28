@echo off
REM Launch DevMuxel from the built output using Electron's own binary.
REM
REM This is the recommended way to run DevMuxel day to day. It skips
REM electron-builder entirely, so there is no unsigned executable for Windows
REM Smart App Control to object to, and no rebuild after `npm run build`.
REM
REM Pin this to the taskbar, or make a shortcut to it, and you are done.

setlocal
cd /d "%~dp0"

if not exist "out\main\index.js" (
  echo Building DevMuxel for the first time...
  call npm run build || exit /b 1
)

start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
endlocal
