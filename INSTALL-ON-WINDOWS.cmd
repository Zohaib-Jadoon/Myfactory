@echo off
setlocal
cd /d "%~dp0"
echo =========================================================
echo   UNIVERSAL SOFTWARE FACTORY - ANTIGRAVITY INSTALLER
 echo =========================================================
echo Installing native skills and rule globally for this user.
echo Third-party pstack and Ponytail require Git and internet.
echo Existing skills will not be overwritten.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Install-All.ps1"
set CODE=%ERRORLEVEL%
echo.
if not "%CODE%"=="0" echo INSTALL FAILED. Check the error above and README.md.
if "%CODE%"=="0" echo Finished. Restart Antigravity agent chat and inspect Customizations - Skills.
pause
exit /b %CODE%
