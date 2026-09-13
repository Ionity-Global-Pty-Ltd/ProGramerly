@echo off
setlocal
title ProGramerly - publish the bundled utilities payload (programs-v1)
cd /d "%~dp0"

echo ==========================================================
echo  ProGramerly - publish the programs-v1 payload release
echo  Ionity (Pty) Ltd ^| AEDI - Policy 986 AED
echo ==========================================================
echo.
echo  Uploads the four Ionity utilities (~495 MB) from
echo    "PROGRAMS TO REF AND USE\"
echo  as assets on the dedicated pre-release tag programs-v1 in
echo    https://github.com/Ionity-Global-Pty-Ltd/ProGramerly
echo.
echo  The Windows CI runner bundles them into the installer from there,
echo  and the app downloads + SHA-256-verifies them on first launch when
echo  a build ships without them. Safe to re-run: existing assets are
echo  replaced (--clobber), nothing else is touched.
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

set REPO=Ionity-Global-Pty-Ltd/ProGramerly
set TAG=programs-v1
set SRC=PROGRAMS TO REF AND USE

echo [3/4] Creating the release if it does not exist yet
gh release view %TAG% --repo %REPO% >nul 2>&1
if errorlevel 1 (
  gh release create %TAG% --repo %REPO% --target main --prerelease ^
    --title "Bundled utilities payload (programs-v1)" ^
    --notes "Bundled Ionity utilities consumed by ProGramerly's Command Center launcher (Windows). The Windows CI runner packs these into resources/programs; builds that ship without them download each one from here on first launch. Every file is pinned by byte size and SHA-256 in src/main/data/programs.json and verified before it runs. Not an application release - install ProGramerly from the latest v* release. Download page: https://www.ionity.fun  --  Governance: Policy 986 AED - (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM"
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
echo  Then re-run the Windows build so the installer bundles them:
echo    gh workflow run build.yml --repo %REPO% -f release_tag=v2.3.0
echo  or simply push the next v* tag.
echo ==========================================================
echo.
pause
