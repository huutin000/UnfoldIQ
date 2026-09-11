# ==============================================================================
# UnfoldIQ TTS Studio — Safe One-Click Start Script
# ==============================================================================
param (
    [switch]$NoBrowser = $false
)

$ErrorActionPreference = "Stop"

# 1. Resolve repository root safely
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $RepoRoot

$RuntimeDir = Join-Path $RepoRoot "runtime"
if (-not (Test-Path $RuntimeDir)) {
    New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
}

$PythonExe = Join-Path $RepoRoot "upstream\kokoro-fastapi\.venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    Write-Host "[ERROR] Python virtual environment not found at:" -ForegroundColor Red
    Write-Host "  $PythonExe" -ForegroundColor Yellow
    Write-Host "Please verify Phase 1 baseline installation." -ForegroundColor Red
    exit 1
}

$KokoroDir = Join-Path $RepoRoot "upstream\kokoro-fastapi"
$KokoroPidFile = Join-Path $RuntimeDir "kokoro.pid"
$KokoroLogFile = Join-Path $RuntimeDir "kokoro.log"

$StudioPidFile = Join-Path $RuntimeDir "studio.pid"
$StudioLogFile = Join-Path $RuntimeDir "studio.log"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "UNFOLDIQ TTS STUDIO — SAFE LAUNCHER (PHASE 3)" -ForegroundColor Cyan
Write-Host "Workspace: $RepoRoot" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan

# Reliable unprivileged port check via TcpClient
function Test-PortListening([int]$Port) {
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $tcp.BeginConnect("127.0.0.1", $Port, $null, $null)
        $wait = $iar.AsyncWaitHandle.WaitOne(600)
        if ($wait -and $tcp.Connected) {
            $tcp.EndConnect($iar)
            return $true
        }
        return $false
    } catch {
        return $false
    } finally {
        $tcp.Close()
    }
}

function Test-HttpHealth([string]$Url) {
    try {
        $resp = Invoke-RestMethod -Uri $Url -TimeoutSec 2 -ErrorAction Stop
        return ($resp.status -eq "healthy")
    } catch {
        return $false
    }
}

# ------------------------------------------------------------------------------
# STEP 1: KOKORO SERVICE (PORT 8880)
# ------------------------------------------------------------------------------
Write-Host "`n[1/3] Checking Kokoro-FastAPI service (Port 8880)..." -ForegroundColor White

$kokoroPortOccupied = Test-PortListening 8880
if ($kokoroPortOccupied) {
    if (Test-HttpHealth "http://127.0.0.1:8880/health") {
        Write-Host "  -> Kokoro is already running and healthy on port 8880. Reusing existing service." -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Port 8880 is occupied by an unexpected, unresponsive process." -ForegroundColor Red
        Write-Host "UnfoldIQ safety rule: Foreign processes are never forcibly killed." -ForegroundColor Yellow
        Write-Host "Please close or terminate the process listening on port 8880 manually." -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "  -> Starting Kokoro-FastAPI in background..." -ForegroundColor Gray
    
    $nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Set-Content -Path $KokoroLogFile -Value "[$nowStr] [LAUNCHER] Starting Kokoro-FastAPI on port 8880..." -Encoding utf8

    $procKokoro = Start-Process `
        -FilePath $PythonExe `
        -ArgumentList "-m uvicorn api.src.main:app --host 127.0.0.1 --port 8880" `
        -WorkingDirectory $KokoroDir `
        -RedirectStandardOutput $KokoroLogFile `
        -RedirectStandardError (Join-Path $RuntimeDir "kokoro_err.log") `
        -WindowStyle Hidden `
        -PassThru

    Set-Content -Path $KokoroPidFile -Value $procKokoro.Id -Encoding utf8
    Write-Host "  -> Kokoro process spawned (Owned PID: $($procKokoro.Id))." -ForegroundColor Gray
    Write-Host "  -> Waiting for CUDA model loading and health check..." -NoNewline -ForegroundColor Gray

    # Poll /health for up to 35 seconds
    $kokoroHealthy = $false
    for ($i = 1; $i -le 35; $i++) {
        Start-Sleep -Seconds 1
        Write-Host "." -NoNewline -ForegroundColor Gray
        if (Test-HttpHealth "http://127.0.0.1:8880/health") {
            $kokoroHealthy = $true
            break
        }
    }
    Write-Host ""

    if (-not $kokoroHealthy) {
        Write-Host "`n[ERROR] Kokoro failed to report healthy within 35 seconds." -ForegroundColor Red
        Write-Host "See log output at: $KokoroLogFile" -ForegroundColor Yellow
        if (Test-Path $KokoroLogFile) {
            Write-Host "--- Last 10 lines of $KokoroLogFile ---" -ForegroundColor DarkGray
            Get-Content -Path $KokoroLogFile -Tail 10
        }
        # Clean up failed spawn
        if ($procKokoro -and -not $procKokoro.HasExited) {
            Stop-Process -Id $procKokoro.Id -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -Path $KokoroPidFile -Force -ErrorAction SilentlyContinue
        exit 1
    }

    # Resolve actual long-lived service process (port owner & CUDA GPU process)
    $actualKokoroPid = (Get-NetTCPConnection -State Listen -LocalPort 8880 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1)
    if ($actualKokoroPid) {
        $cimProc = Get-CimInstance Win32_Process -Filter "ProcessId=$actualKokoroPid" -ErrorAction SilentlyContinue
        if ($cimProc.ProcessId -eq $procKokoro.Id -or $cimProc.ParentProcessId -eq $procKokoro.Id) {
            Set-Content -Path $KokoroPidFile -Value $actualKokoroPid -Encoding utf8
            if ($cimProc.ParentProcessId -eq $procKokoro.Id) {
                Set-Content -Path (Join-Path $RuntimeDir "kokoro_wrapper.pid") -Value $procKokoro.Id -Encoding utf8
            }
            Write-Host "  -> Kokoro service verified (Owned Service PID: $actualKokoroPid, Shim PID: $($procKokoro.Id))." -ForegroundColor Gray
        }
    }

    Write-Host "  -> Kokoro started and verified healthy on http://127.0.0.1:8880" -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# STEP 2: STUDIO APPLICATION (PORT 7860)
# ------------------------------------------------------------------------------
Write-Host "`n[2/3] Checking UnfoldIQ Studio service (Port 7860)..." -ForegroundColor White

$studioPortOccupied = Test-PortListening 7860
if ($studioPortOccupied) {
    if (Test-HttpHealth "http://127.0.0.1:7860/health") {
        Write-Host "  -> Studio is already running and healthy on port 7860. Reusing existing service." -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Port 7860 is occupied by an unexpected, unresponsive process." -ForegroundColor Red
        Write-Host "Please close the process listening on port 7860 manually." -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "  -> Starting UnfoldIQ Studio in background..." -ForegroundColor Gray
    
    $nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Set-Content -Path $StudioLogFile -Value "[$nowStr] [LAUNCHER] Starting UnfoldIQ Studio on port 7860..." -Encoding utf8

    $procStudio = Start-Process `
        -FilePath $PythonExe `
        -ArgumentList "-m uvicorn studio.app:app --host 127.0.0.1 --port 7860" `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $StudioLogFile `
        -RedirectStandardError (Join-Path $RuntimeDir "studio_err.log") `
        -WindowStyle Hidden `
        -PassThru

    Set-Content -Path $StudioPidFile -Value $procStudio.Id -Encoding utf8
    Write-Host "  -> Studio process spawned (Owned PID: $($procStudio.Id))." -ForegroundColor Gray
    Write-Host "  -> Waiting for Studio health check..." -NoNewline -ForegroundColor Gray

    # Poll /health for up to 15 seconds
    $studioHealthy = $false
    for ($i = 1; $i -le 15; $i++) {
        Start-Sleep -Seconds 1
        Write-Host "." -NoNewline -ForegroundColor Gray
        if (Test-HttpHealth "http://127.0.0.1:7860/health") {
            $studioHealthy = $true
            break
        }
    }
    Write-Host ""

    if (-not $studioHealthy) {
        Write-Host "`n[ERROR] Studio failed to report healthy within 15 seconds." -ForegroundColor Red
        Write-Host "See log output at: $StudioLogFile" -ForegroundColor Yellow
        if (Test-Path $StudioLogFile) {
            Write-Host "--- Last 10 lines of $StudioLogFile ---" -ForegroundColor DarkGray
            Get-Content -Path $StudioLogFile -Tail 10
        }
        if ($procStudio -and -not $procStudio.HasExited) {
            Stop-Process -Id $procStudio.Id -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -Path $StudioPidFile -Force -ErrorAction SilentlyContinue
        exit 1
    }

    # Resolve actual long-lived service process (port owner)
    $actualStudioPid = (Get-NetTCPConnection -State Listen -LocalPort 7860 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1)
    if ($actualStudioPid) {
        $cimProc = Get-CimInstance Win32_Process -Filter "ProcessId=$actualStudioPid" -ErrorAction SilentlyContinue
        if ($cimProc.ProcessId -eq $procStudio.Id -or $cimProc.ParentProcessId -eq $procStudio.Id) {
            Set-Content -Path $StudioPidFile -Value $actualStudioPid -Encoding utf8
            if ($cimProc.ParentProcessId -eq $procStudio.Id) {
                Set-Content -Path (Join-Path $RuntimeDir "studio_wrapper.pid") -Value $procStudio.Id -Encoding utf8
            }
            Write-Host "  -> Studio service verified (Owned Service PID: $actualStudioPid, Shim PID: $($procStudio.Id))." -ForegroundColor Gray
        }
    }

    Write-Host "  -> Studio started and verified healthy on http://127.0.0.1:7860" -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# STEP 3: BROWSER ACCEPTANCE LAUNCH
# ------------------------------------------------------------------------------
if (-not $NoBrowser) {
    Write-Host "`n[3/3] Opening UnfoldIQ Studio in your browser..." -ForegroundColor White
    Start-Process "http://127.0.0.1:7860"
} else {
    Write-Host "`n[3/3] Skipping browser launch (-NoBrowser specified)." -ForegroundColor Gray
}

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "ALL SERVICES OPERATIONAL!" -ForegroundColor Green
Write-Host "Studio Web UI:  http://127.0.0.1:7860" -ForegroundColor Cyan
Write-Host "Kokoro API:     http://127.0.0.1:8880" -ForegroundColor Cyan
Write-Host "To stop services cleanly, run stop-unfoldiq-tts.bat" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Green
exit 0
