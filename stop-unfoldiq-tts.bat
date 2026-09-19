@echo off
setlocal
title UnfoldIQ TTS Studio Shutdown
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-unfoldiq-tts.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
if %EXIT_CODE% NEQ 0 (
    echo.
    echo ================================================================================
    echo   [LOI] Dung he thong gap su co (Ma loi: %EXIT_CODE%).
    echo   Nhan phim bat ky de dong cua so nay...
    echo ================================================================================
    pause >nul
)
exit /b %EXIT_CODE%
