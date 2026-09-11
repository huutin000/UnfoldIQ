@echo off
title UnfoldIQ TTS Studio Shutdown
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-unfoldiq-tts.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Shutdown encountered an issue. Press any key to exit.
    pause >nul
)
