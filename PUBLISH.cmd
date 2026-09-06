@echo off
REM ProGramerly - publish to GitHub and cut a Release, in one double-click.
REM Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
title ProGramerly - publish to GitHub
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish-github.ps1" %*
echo.
pause
