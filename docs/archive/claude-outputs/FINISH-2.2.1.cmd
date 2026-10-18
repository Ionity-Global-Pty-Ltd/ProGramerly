@echo off
setlocal
title ProGramerly v2.2.1 - finish commit, push and release
cd /d "G:\.Development\ProGramerly-Basic Software for All"

echo ==========================================================
echo  ProGramerly v2.2.1 - finish the commit, push and release
echo  Ionity (Pty) Ltd ^| AEDI - Policy 986 AED
echo ==========================================================
echo.

echo [1/7] Identity git will stamp on the commit
git var GIT_AUTHOR_IDENT
if errorlevel 1 (
  echo.
  echo   ^> The identity above is malformed - that is what blocks the commit.
  echo   ^> Setting a clean one for this repository only...
  git config user.name "Johan Wilhelm van Antwerp"
  git config user.email "ai@ionity.today"
  git var GIT_AUTHOR_IDENT
)
echo.

echo [2/7] Checking that .git is writable
echo probe> .git\.writeprobe 2>nul
if exist .git\.writeprobe (
  del .git\.writeprobe
  echo   OK - .git accepts writes.
) else (
  echo   FAILED - cannot write inside .git
  echo   G: may have dropped out, or antivirus / another Git client is holding
  echo   the folder. Close any Git GUI, confirm G: is present, then re-run this.
  echo.
  pause
  exit /b 1
)
echo.

echo [3/7] Staging the four fixed files
git add package.json src/renderer/renderer.js src/renderer/hud.js src/renderer/styles.css
git status --short package.json src/renderer/renderer.js src/renderer/hud.js src/renderer/styles.css
echo.

echo [4/7] Committing
if not exist commitmsg.txt (
  echo   commitmsg.txt is missing - writing a short message instead.
  git commit -m "Fix four inline styles silently dropped by the renderer CSP"
) else (
  git commit -F commitmsg.txt
)
if errorlevel 1 (
  echo.
  echo   COMMIT FAILED. Nothing has been pushed. The four fixes are still on
  echo   disk and still staged, so nothing is lost - send Claude the lines above.
  echo.
  pause
  exit /b 1
)
echo   Committed.
echo.

echo [5/7] Pushing main to GitHub
git push origin main
if errorlevel 1 (
  echo.
  echo   PUSH FAILED - check "gh auth status" and your network, then re-run.
  echo.
  pause
  exit /b 1
)
echo   Pushed.
echo.

echo [6/7] Tagging v2.2.1 and pushing the tag
git tag -f v2.2.1
git push --force origin refs/tags/v2.2.1
if errorlevel 1 (
  echo.
  echo   TAG PUSH FAILED - the code is on GitHub, only the release trigger
  echo   did not fire. Re-run this script to retry just this step.
  echo.
  pause
  exit /b 1
)
echo   Tag pushed - GitHub Actions is now building.
echo.

echo [7/7] Cleaning up the helper files
if exist commitmsg.txt del commitmsg.txt
if exist do-commit.cmd del do-commit.cmd
if exist diag.cmd del diag.cmd
echo   Done.
echo.

echo ==========================================================
echo  Pushing the v2.2.1 tag starts .github/workflows/build.yml,
echo  which builds on GitHub's own runners and attaches the files
echo  to the release by itself:
echo.
echo    Windows  .exe      - built on a Windows runner
echo    macOS    .dmg      - built on a real macOS runner (native)
echo    Linux    AppImage + .deb
echo    SHA256.txt
echo.
echo  Watch it here:
echo    https://github.com/Ionity-Global-Pty-Ltd/ProGramerly/actions
echo  Release lands here when it is green (about 10-15 min):
echo    https://github.com/Ionity-Global-Pty-Ltd/ProGramerly/releases/tag/v2.2.1
echo ==========================================================
echo.
pause
