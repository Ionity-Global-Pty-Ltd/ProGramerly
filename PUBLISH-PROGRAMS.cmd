@echo off
setlocal
title ProGramerly - publish the bundled utilities payload (programs-v1)
cd /d "%~dp0"

echo ==========================================================
echo  ProGramerly - publish the programs-v1 payload release
echo  Ionity (Pty) Ltd ^| AEDI - Policy 986 AED
echo ==========================================================
echo.
echo  Uploads the integrated Ionity tools (~495 MB) from
echo    "PROGRAMS TO REF AND USE\"
echo  as assets on the tag programs-v1 in the PRIVATE repository
echo    https://github.com/Ionity-Global-Pty-Ltd/programerly-payload
echo.
echo  The Windows CI runner (secret PAYLOAD_TOKEN) bundles them into the
echo  installer from there. They are never published for separate
echo  download. Safe to re-run: existing assets are replaced (--clobber).
echo.

echo [1/4] Verifying the payload against src\main\data\programs.json
node scripts\check-programs.js --strict --write-sums
if errorlevel 1 (
  echo.
  echo   The payload does not match its pins. Nothing was uploaded.
  pause
  exit /b 1
)
echo.

echo [2/4] GitHub CLI sign-in
gh auth status
if errorlevel 1 (
  gh auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow"
)
echo.

set REPO=Ionity-Global-Pty-Ltd/programerly-payload
set TAG=programs-v1
set SRC=PROGRAMS TO REF AND USE

echo [3/4] Creating the release if it does not exist yet
gh release view %TAG% --repo %REPO% >nul 2>&1
if errorlevel 1 (
  gh release create %TAG% --repo %REPO% --target main ^
    --title "ProGramerly bundled utilities payload (programs-v1)" ^
    --notes "Private payload consumed by the ProGramerly Windows CI job. Pins live in ProGramerly/src/main/data/programs.json. Not for independent distribution. Policy 986 AED - (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM"
  if errorlevel 1 (
    echo   Could not create the release - check the messages above.
    pause
    exit /b 1
  )
) else (
  echo   %TAG% already exists - assets will be replaced.
)
echo.

echo [4/4] Uploading assets (this is ~495 MB; a few minutes on a normal line)
gh release upload %TAG% --repo %REPO% --clobber ^
  "%SRC%\SHA256-programs.txt" ^
  "%SRC%\CiC.exe" ^
  "%SRC%\IONITY-AiOS-Demo-v1.6.0.exe" ^
  "%SRC%\Fanzi.FanControl.exe" ^
  "%SRC%\MCP-AUDIT.Setup.1.15.0.exe"
if errorlevel 1 (
  echo.
  echo   UPLOAD FAILED - re-run this script; finished assets are kept and
  echo   only the missing or partial ones are sent again.
  pause
  exit /b 1
)
echo.

echo ==========================================================
echo  Published. Verify here:
echo    https://github.com/%REPO%/releases/tag/%TAG%
echo.
echo  The ProGramerly repository needs a read-only token for this repo as
echo  the Actions secret PAYLOAD_TOKEN (fine-grained PAT, Contents: read):
echo    gh secret set PAYLOAD_TOKEN --repo Ionity-Global-Pty-Ltd/ProGramerly
echo  Then push the next v* tag, or re-run the build onto an existing one:
echo    gh workflow run build.yml --repo Ionity-Global-Pty-Ltd/ProGramerly -f release_tag=v3.0.5
echo ==========================================================
echo.
pause
