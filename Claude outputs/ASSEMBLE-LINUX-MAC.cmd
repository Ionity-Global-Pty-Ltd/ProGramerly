@echo off
setlocal enabledelayedexpansion
REM ProGramerly v2.2.0 - reassemble the Linux (AppImage, .deb) and macOS (.zip) release assets
REM Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

echo Rebuilding ProGramerly-2.2.0-x86_64.AppImage from its parts...
if exist "ProGramerly-2.2.0-x86_64.AppImage" del /f /q "ProGramerly-2.2.0-x86_64.AppImage"
copy /b ProGramerly-2.2.0-x86_64.AppImage.00.part+ProGramerly-2.2.0-x86_64.AppImage.01.part+ProGramerly-2.2.0-x86_64.AppImage.02.part+ProGramerly-2.2.0-x86_64.AppImage.03.part+ProGramerly-2.2.0-x86_64.AppImage.04.part+ProGramerly-2.2.0-x86_64.AppImage.05.part+ProGramerly-2.2.0-x86_64.AppImage.06.part "ProGramerly-2.2.0-x86_64.AppImage"

echo Rebuilding programerly_2.2.0_amd64.deb from its parts...
if exist "programerly_2.2.0_amd64.deb" del /f /q "programerly_2.2.0_amd64.deb"
copy /b programerly_2.2.0_amd64.deb.00.part+programerly_2.2.0_amd64.deb.01.part+programerly_2.2.0_amd64.deb.02.part+programerly_2.2.0_amd64.deb.03.part+programerly_2.2.0_amd64.deb.04.part "programerly_2.2.0_amd64.deb"

echo Rebuilding ProGramerly-2.2.0-mac.zip from its parts...
if exist "ProGramerly-2.2.0-mac.zip" del /f /q "ProGramerly-2.2.0-mac.zip"
copy /b ProGramerly-2.2.0-mac.zip.00.part+ProGramerly-2.2.0-mac.zip.01.part+ProGramerly-2.2.0-mac.zip.02.part+ProGramerly-2.2.0-mac.zip.03.part+ProGramerly-2.2.0-mac.zip.04.part+ProGramerly-2.2.0-mac.zip.05.part "ProGramerly-2.2.0-mac.zip"

echo.
echo Verifying SHA-256 against SHA256-linux-mac.txt...
set "OK=1"

for %%F in (ProGramerly-2.2.0-x86_64.AppImage programerly_2.2.0_amd64.deb ProGramerly-2.2.0-mac.zip) do (
  if not exist "%%F" (
    echo   MISSING - %%F was not created.
    set "OK=0"
  ) else (
    for /f "usebackq tokens=1" %%H in (`certutil -hashfile "%%F" SHA256 ^| findstr /v "hash CertUtil"`) do (
      for /f "tokens=1" %%E in ('findstr /i "%%F" SHA256-linux-mac.txt') do (
        echo   %%F
        echo     got:      %%H
      )
    )
  )
)

echo.
echo Expected hashes (compare by eye against SHA256-linux-mac.txt):
type SHA256-linux-mac.txt
echo.
echo All three files are unsigned builds:
echo  - AppImage: chmod +x it on Linux, then run it directly. No installation needed.
echo  - .deb: install with "sudo apt install ./programerly_2.2.0_amd64.deb" on Debian/Ubuntu.
echo  - mac.zip: unzip, then right-click ProGramerly.app -^> Open the first time
echo    (unsigned/un-notarized, so Gatekeeper will warn once).
echo.
echo These three plus the Windows ProGramerly-Setup-2.2.0-x64.exe are what
echo go into the GitHub Release for v2.2.0.
pause
