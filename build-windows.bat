@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1" %*
set "BUILD_EXIT_CODE=%ERRORLEVEL%"

if not "%BUILD_EXIT_CODE%"=="0" (
  echo.
  echo Windows build failed with exit code %BUILD_EXIT_CODE%.
)

echo.
echo Build finished. Press any key to exit...
pause >nul
exit /b %BUILD_EXIT_CODE%
