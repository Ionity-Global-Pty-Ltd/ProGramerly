@echo off
cd /d "%~dp0.."
node scripts\ui-check-330.js > "%TEMP%\pg-ui330.log" 2>&1
echo EXIT=%ERRORLEVEL% >> "%TEMP%\pg-ui330.log"
