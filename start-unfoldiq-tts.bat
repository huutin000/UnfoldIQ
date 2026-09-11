@echo off
title UnfoldIQ TTS Studio Launcher
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-unfoldiq-tts.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Launcher encountered an error. Press any key to exit.
    pause >nul
)
