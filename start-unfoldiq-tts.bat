@echo off
setlocal
title UnfoldIQ TTS Studio Launcher
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-unfoldiq-tts.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
if %EXIT_CODE% NEQ 0 (
    echo.
    echo ================================================================================
    echo   [LOI] Khoi dong that bai (Ma loi: %EXIT_CODE%).
    echo   Nhan phim bat ky de dong cua so nay...
    echo ================================================================================
    pause >nul
)
exit /b %EXIT_CODE%
