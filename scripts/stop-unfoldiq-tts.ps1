# ==============================================================================
# UnfoldIQ TTS Studio — Safe One-Click Stop Script
# ==============================================================================
$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $RepoRoot

$RuntimeDir = Join-Path $RepoRoot "runtime"
$KokoroPidFile = Join-Path $RuntimeDir "kokoro.pid"
$StudioPidFile = Join-Path $RuntimeDir "studio.pid"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "UNFOLDIQ TTS STUDIO — SAFE SHUTDOWN (PHASE 3)" -ForegroundColor Cyan
Write-Host "Workspace: $RepoRoot" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan

function Stop-OwnedService([string]$ServiceName, [string]$PidFilePath, [string]$WrapperPidFilePath = $null) {
    if (-not (Test-Path $PidFilePath)) {
        Write-Host "  -> No owned PID record for $ServiceName (File not found)." -ForegroundColor Gray
        return
    }

    $pidContent = (Get-Content -Path $PidFilePath -ErrorAction SilentlyContinue).Trim()
    if (-not $pidContent -or -not ($pidContent -match "^\d+$")) {
        Write-Host "  -> Stale or empty PID record for $ServiceName. Cleaning marker." -ForegroundColor Yellow
        Remove-Item -Path $PidFilePath -Force -ErrorAction SilentlyContinue
        if ($WrapperPidFilePath -and (Test-Path $WrapperPidFilePath)) {
            Remove-Item -Path $WrapperPidFilePath -Force -ErrorAction SilentlyContinue
        }
        return
    }

    $targetPid = [int]$pidContent
    $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue

    if ($null -eq $proc) {
        Write-Host "  -> $ServiceName (PID $targetPid) is already stopped. Cleaning PID record." -ForegroundColor Gray
        Remove-Item -Path $PidFilePath -Force -ErrorAction SilentlyContinue
        if ($WrapperPidFilePath -and (Test-Path $WrapperPidFilePath)) {
            Remove-Item -Path $WrapperPidFilePath -Force -ErrorAction SilentlyContinue
        }
        return
    }

    # Verify process name to guard against Windows PID recycling
    if ($proc.ProcessName -notmatch "python") {
        Write-Host "  -> [SAFETY WARNING] PID $targetPid is no longer Python ($($proc.ProcessName))." -ForegroundColor Yellow
        Write-Host "     Refusing to terminate recycled process ID. Cleaning stale record." -ForegroundColor Yellow
        Remove-Item -Path $PidFilePath -Force -ErrorAction SilentlyContinue
        if ($WrapperPidFilePath -and (Test-Path $WrapperPidFilePath)) {
            Remove-Item -Path $WrapperPidFilePath -Force -ErrorAction SilentlyContinue
        }
        return
    }

    # Verify process identity to guard against PID recycling to unrelated Python processes
    $cimProc = Get-CimInstance Win32_Process -Filter "ProcessId=$targetPid" -ErrorAction SilentlyContinue
    $cmdLine = if ($cimProc) { $cimProc.CommandLine } else { "" }
    $isExpectedService = $false
    if ($ServiceName -match "Kokoro") {
        if ($cmdLine -match "uvicorn" -and ($cmdLine -match "kokoro" -or $cmdLine -match "api\.src\.main" -or $cmdLine -match "8880")) {
            $isExpectedService = $true
        }
    } elseif ($ServiceName -match "Studio") {
        if ($cmdLine -match "uvicorn" -and ($cmdLine -match "studio\.app" -or $cmdLine -match "7860" -or $cmdLine -match "UnfoldIQ")) {
            $isExpectedService = $true
        }
    } elseif ($ServiceName -match "Transcription") {
        if ($cmdLine -match "worker\.py" -or $cmdLine -match "transcription") {
            $isExpectedService = $true
        }
    }

    if (-not $isExpectedService) {
        Write-Host "  -> [SAFETY WARNING] PID $targetPid is Python, but command line does not match $ServiceName." -ForegroundColor Yellow
        Write-Host "     Refusing to terminate unrelated Python process. Cleaning stale record." -ForegroundColor Yellow
        Remove-Item -Path $PidFilePath -Force -ErrorAction SilentlyContinue
        if ($WrapperPidFilePath -and (Test-Path $WrapperPidFilePath)) {
            Remove-Item -Path $WrapperPidFilePath -Force -ErrorAction SilentlyContinue
        }
        return
    }

    Write-Host "  -> Stopping owned $ServiceName (PID $targetPid)..." -ForegroundColor White
    try {
        # Graceful stop attempt
        $proc.CloseMainWindow() | Out-Null
        $proc.WaitForExit(3000) | Out-Null
    } catch {}

    if (-not $proc.HasExited) {
        try {
            Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
        } catch {}
    }

    # Also terminate wrapper shim process if recorded and still running
    if ($WrapperPidFilePath -and (Test-Path $WrapperPidFilePath)) {
        $wrapPidContent = (Get-Content -Path $WrapperPidFilePath -ErrorAction SilentlyContinue).Trim()
        if ($wrapPidContent -match "^\d+$") {
            $wrapPid = [int]$wrapPidContent
            $wrapProc = Get-Process -Id $wrapPid -ErrorAction SilentlyContinue
            if ($wrapProc -and $wrapProc.ProcessName -match "python" -and -not $wrapProc.HasExited) {
                try {
                    Stop-Process -Id $wrapPid -Force -ErrorAction SilentlyContinue
                } catch {}
            }
        }
        Remove-Item -Path $WrapperPidFilePath -Force -ErrorAction SilentlyContinue
    }

    if ($proc.HasExited) {
        Write-Host "  -> Successfully stopped $ServiceName (PID $targetPid)." -ForegroundColor Green
    } else {
        Write-Host "  -> [WARN] Could not verify termination of $ServiceName (PID $targetPid)." -ForegroundColor Yellow
    }

    Remove-Item -Path $PidFilePath -Force -ErrorAction SilentlyContinue
}

$StudioWrapperPidFile = Join-Path $RuntimeDir "studio_wrapper.pid"
$KokoroWrapperPidFile = Join-Path $RuntimeDir "kokoro_wrapper.pid"
$TranscriptionWorkerPidFile = Join-Path $RuntimeDir "transcription_worker.pid"

# 1. Stop any active transcription worker first
Write-Host "`n[1/3] Stopping any active transcription worker..." -ForegroundColor White
Stop-OwnedService "Transcription Worker" $TranscriptionWorkerPidFile

# 2. Stop Studio
Write-Host "`n[2/3] Stopping Studio service..." -ForegroundColor White
Stop-OwnedService "UnfoldIQ Studio" $StudioPidFile $StudioWrapperPidFile

# 3. Stop Kokoro
Write-Host "`n[3/3] Stopping Kokoro-FastAPI service..." -ForegroundColor White
Stop-OwnedService "Kokoro-FastAPI" $KokoroPidFile $KokoroWrapperPidFile

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "CLEANUP COMPLETE. Unrelated processes and audio files left untouched." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
exit 0
