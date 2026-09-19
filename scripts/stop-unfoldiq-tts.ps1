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
$StudioWrapperPidFile = Join-Path $RuntimeDir "studio_wrapper.pid"
$KokoroWrapperPidFile = Join-Path $RuntimeDir "kokoro_wrapper.pid"
$TranscriptionWorkerPidFile = Join-Path $RuntimeDir "transcription_worker.pid"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  UNFOLDIQ TTS STUDIO — DUNG HE THONG" -ForegroundColor Cyan
Write-Host "  Thu muc goc: $RepoRoot" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan

function Stop-OwnedService([string]$ServiceName, [string]$PidFilePath, [string]$WrapperPidFilePath = $null, [int]$ExpectedPort = 0) {
    if (-not (Test-Path $PidFilePath)) {
        Write-Host "  [OK] Khong co ban ghi PID cho $ServiceName (File not found)." -ForegroundColor Gray
        if ($ExpectedPort -gt 0) {
            $conn = Get-NetTCPConnection -State Listen -LocalPort $ExpectedPort -ErrorAction SilentlyContinue
            if ($conn) {
                Write-Host "  [CANH BAO] Cong $ExpectedPort van dang lang nghe boi PID $($conn.OwningProcess[0])." -ForegroundColor Yellow
            }
        }
        return $true
    }

    $pidContent = (Get-Content -Path $PidFilePath -ErrorAction SilentlyContinue).Trim()
    if (-not $pidContent -or -not ($pidContent -match "^\d+$")) {
        Write-Host "  [CANH BAO] Ban ghi PID cho $ServiceName bi trong hoac khong hop le. Dang don dep marker." -ForegroundColor Yellow
        Remove-Item -Path $PidFilePath -Force -ErrorAction SilentlyContinue
        if ($WrapperPidFilePath -and (Test-Path $WrapperPidFilePath)) {
            Remove-Item -Path $WrapperPidFilePath -Force -ErrorAction SilentlyContinue
        }
        return $true
    }

    $targetPid = [int]$pidContent
    $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue

    if ($null -eq $proc) {
        Write-Host "  [OK] $ServiceName (PID $targetPid) already stopped. Cleaning PID record." -ForegroundColor Gray
        Remove-Item -Path $PidFilePath -Force -ErrorAction SilentlyContinue
        if ($WrapperPidFilePath -and (Test-Path $WrapperPidFilePath)) {
            Remove-Item -Path $WrapperPidFilePath -Force -ErrorAction SilentlyContinue
        }
        return $true
    }

    # Verify process name to guard against Windows PID recycling
    if ($proc.ProcessName -notmatch "python") {
        Write-Host "  [CANH BAO] PID $targetPid khong phai Python ($($proc.ProcessName))." -ForegroundColor Yellow
        Write-Host "     Refusing to terminate recycled process ID. Cleaning stale record." -ForegroundColor Yellow
        Remove-Item -Path $PidFilePath -Force -ErrorAction SilentlyContinue
        if ($WrapperPidFilePath -and (Test-Path $WrapperPidFilePath)) {
            Remove-Item -Path $WrapperPidFilePath -Force -ErrorAction SilentlyContinue
        }
        return $true
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
        Write-Host "  [CANH BAO] PID $targetPid la Python, nhung command line does not match $ServiceName." -ForegroundColor Yellow
        Write-Host "     Refusing to terminate unrelated Python process. Cleaning stale record." -ForegroundColor Yellow
        Remove-Item -Path $PidFilePath -Force -ErrorAction SilentlyContinue
        if ($WrapperPidFilePath -and (Test-Path $WrapperPidFilePath)) {
            Remove-Item -Path $WrapperPidFilePath -Force -ErrorAction SilentlyContinue
        }
        return $true
    }

    Write-Host "  [..] Dang dung tien trinh $ServiceName (PID $targetPid)..." -ForegroundColor White
    try {
        $proc.CloseMainWindow() | Out-Null
        $proc.WaitForExit(3000) | Out-Null
    } catch {}

    if (-not $proc.HasExited) {
        try {
            Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
            for ($w = 0; $w -lt 6; $w++) {
                Start-Sleep -Milliseconds 500
                if ($proc.HasExited) { break }
            }
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

    # Verify process exit
    $stoppedSuccessfully = $false
    if ($proc.HasExited) {
        Write-Host "  [OK] Successfully stopped $ServiceName (PID $targetPid)." -ForegroundColor Green
        $stoppedSuccessfully = $true
    } else {
        Write-Host "  [LOI] Khong the dung tien trinh $ServiceName (PID $targetPid)." -ForegroundColor Red
    }

    # Verify port release if ExpectedPort > 0
    if ($ExpectedPort -gt 0) {
        Start-Sleep -Milliseconds 300
        $portConn = Get-NetTCPConnection -State Listen -LocalPort $ExpectedPort -ErrorAction SilentlyContinue
        if (-not $portConn) {
            Write-Host "  [OK] Port $ExpectedPort da duoc giai phong hoan toan." -ForegroundColor Green
        } else {
            Write-Host "  [CANH BAO] Port $ExpectedPort van chua duoc giai phong (Dang duoc chiem boi PID $($portConn.OwningProcess[0]))." -ForegroundColor Yellow
        }
    }

    Remove-Item -Path $PidFilePath -Force -ErrorAction SilentlyContinue
    return $stoppedSuccessfully
}

$allStoppedCleanly = $true

# 1. Dung bat ky transcription worker nao dang hoat dong
Write-Host "`n[1/3] Dung tien trinh Transcription Worker..." -ForegroundColor White
$res1 = Stop-OwnedService "Transcription Worker" $TranscriptionWorkerPidFile
if (-not $res1) { $allStoppedCleanly = $false }

# 2. Dung UnfoldIQ Studio
Write-Host "`n[2/3] Dung dich vu UnfoldIQ Studio (Cong 7860)..." -ForegroundColor White
$res2 = Stop-OwnedService "UnfoldIQ Studio" $StudioPidFile $StudioWrapperPidFile 7860
if (-not $res2) { $allStoppedCleanly = $false }

# 3. Dung Kokoro-FastAPI
Write-Host "`n[3/3] Dung dich vu Kokoro-FastAPI (Cong 8880)..." -ForegroundColor White
$res3 = Stop-OwnedService "Kokoro-FastAPI" $KokoroPidFile $KokoroWrapperPidFile 8880
if (-not $res3) { $allStoppedCleanly = $false }

Write-Host "`n============================================================" -ForegroundColor Green
if ($allStoppedCleanly) {
    Write-Host "  HOAN TAT DUNG HE THONG." -ForegroundColor Green
    Write-Host "  Cac tien trinh va port cua UnfoldIQ da duoc giai phong." -ForegroundColor Gray
    Write-Host "============================================================" -ForegroundColor Green
    exit 0
} else {
    Write-Host "  [LOI] Mot so tien trinh chua the dung hoan toan." -ForegroundColor Red
    Write-Host "  Vui long kiem tra Task Manager hoac cac port lien quan." -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Red
    exit 1
}
