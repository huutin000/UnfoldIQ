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
$KokoroDir = Join-Path $RepoRoot "upstream\kokoro-fastapi"
$KokoroPidFile = Join-Path $RuntimeDir "kokoro.pid"
$KokoroLogFile = Join-Path $RuntimeDir "kokoro.log"
$KokoroErrFile = Join-Path $RuntimeDir "kokoro_err.log"

$StudioPidFile = Join-Path $RuntimeDir "studio.pid"
$StudioLogFile = Join-Path $RuntimeDir "studio.log"
$StudioErrFile = Join-Path $RuntimeDir "studio_err.log"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  UNFOLDIQ TTS STUDIO — KHOI DONG MOI TRUONG" -ForegroundColor Cyan
Write-Host "  Thu muc goc: $RepoRoot" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan

# Kiem tra ket noi port bang Get-NetTCPConnection (an toan, khong chiem dung socket)
function Test-PortListening([int]$Port) {
    try {
        $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
        return ($null -ne $conn)
    } catch {
        return $false
    }
}

# Kiem tra trang thai health endpoint cua service
function Test-HttpHealth([string]$Url) {
    try {
        $resp = Invoke-RestMethod -Uri $Url -TimeoutSec 2 -ErrorAction Stop
        return ($resp.status -eq "healthy")
    } catch {
        return $false
    }
}

# Lay PID dang lang nghe tren port
function Get-PortOwnerPid([int]$Port) {
    try {
        $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1
        if ($conn) { return [int]$conn }
    } catch {}
    return $null
}

# Lay thong tin chi tiet ve tien trinh
function Get-ProcessInfo([int]$PidToQuery) {
    $pName = "Khong ro"
    $cLine = ""
    if ($PidToQuery) {
        $p = Get-Process -Id $PidToQuery -ErrorAction SilentlyContinue
        if ($p) { $pName = $p.ProcessName }
        try {
            $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$PidToQuery" -ErrorAction SilentlyContinue
            if ($cim -and $cim.CommandLine) { $cLine = $cim.CommandLine }
        } catch {}
    }
    return @{ Name = $pName; CommandLine = $cLine }
}

# Bien theo doi de ho tro rollback neu khoi dong that bai
$spawnedKokoro = $false
$procKokoro = $null
$spawnedStudio = $false
$procStudio = $null

# ------------------------------------------------------------------------------
# BUOC 1: KIEM TRA MOI TRUONG HE THONG
# ------------------------------------------------------------------------------
Write-Host "`n[1/4] Kiem tra moi truong he thong..." -ForegroundColor White

if (-not (Test-Path $PythonExe)) {
    Write-Host "  [LOI] Khong tim thay moi truong ao Python tai:" -ForegroundColor Red
    Write-Host "        $PythonExe" -ForegroundColor Yellow
    Write-Host "  Vui long kiem tra lai qua trinh cai dat Phase 1 truoc khi khoi dong." -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Python venv : $PythonExe" -ForegroundColor Green
Write-Host "  [OK] Thu muc log : $RuntimeDir" -ForegroundColor Green

# ------------------------------------------------------------------------------
# BUOC 2: KIEM TRA VA KHOI DONG KOKORO-FASTAPI (PORT 8880)
# ------------------------------------------------------------------------------
Write-Host "`n[2/4] Kiem tra va khoi dong Kokoro-FastAPI (Cong 8880)..." -ForegroundColor White

$kokoroPortOccupied = Test-PortListening 8880
if ($kokoroPortOccupied) {
    if (Test-HttpHealth "http://127.0.0.1:8880/health") {
        $existingKokoroPid = Get-PortOwnerPid 8880
        if ($existingKokoroPid) {
            Set-Content -Path $KokoroPidFile -Value $existingKokoroPid -Encoding utf8
            Write-Host "  [OK] Kokoro-FastAPI da chay san va dang hoat dong tot (PID $existingKokoroPid)." -ForegroundColor Green
        } else {
            Write-Host "  [OK] Kokoro-FastAPI da chay san va dang hoat dong tot tren port 8880." -ForegroundColor Green
        }
    } else {
        $ownerPid = Get-PortOwnerPid 8880
        $info = Get-ProcessInfo $ownerPid
        Write-Host "  [LOI] Port 8880 dang duoc su dung boi process khac khong phan hoi." -ForegroundColor Red
        Write-Host "        Process : $($info.Name)" -ForegroundColor Yellow
        Write-Host "        PID     : $ownerPid" -ForegroundColor Yellow
        Write-Host "        Port    : 8880" -ForegroundColor Yellow
        Write-Host "  Quy tac an toan UnfoldIQ: Khong bao gio tu dong terminate tien trinh la." -ForegroundColor Yellow
        Write-Host "  Vui long kiem tra hoac tat tien trinh dang chiem port 8880 thu cong." -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "  [..] Dang khoi dong Kokoro-FastAPI trong che do background..." -ForegroundColor Gray

    $nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Set-Content -Path $KokoroLogFile -Value "[$nowStr] [LAUNCHER] Starting Kokoro-FastAPI on port 8880..." -Encoding utf8

    # Ghi chu: khong dung -WindowStyle Hidden cung voi -RedirectStandardOutput
    # vi ket hop do gay deadlock pipe tren Windows. Process se chay an vi
    # no khong duoc cap phat console window moi (inherit tu parent).
    $procKokoro = Start-Process `
        -FilePath $PythonExe `
        -ArgumentList "-m uvicorn api.src.main:app --host 127.0.0.1 --port 8880" `
        -WorkingDirectory $KokoroDir `
        -RedirectStandardOutput $KokoroLogFile `
        -RedirectStandardError $KokoroErrFile `
        -PassThru

    $spawnedKokoro = $true
    Set-Content -Path $KokoroPidFile -Value $procKokoro.Id -Encoding utf8
    Write-Host "  [..] Da spawn tien trinh Kokoro-FastAPI (PID: $($procKokoro.Id))." -ForegroundColor Gray
    Write-Host "  [..] Dang cho Kokoro nap model CUDA va health check" -NoNewline -ForegroundColor Gray

    # Cho tai model CUDA va health check (toi da 35 giay)
    $maxKokoroWait = 35
    $kokoroHealthy = $false
    for ($i = 1; $i -le $maxKokoroWait; $i++) {
        Start-Sleep -Seconds 1
        Write-Host "." -NoNewline -ForegroundColor Gray
        if (Test-PortListening 8880) {
            if (Test-HttpHealth "http://127.0.0.1:8880/health") {
                $kokoroHealthy = $true
                break
            }
        }
    }
    Write-Host ""

    if (-not $kokoroHealthy) {
        Write-Host "  [LOI] Kokoro-FastAPI khong vuot qua kiem tra health check trong ${maxKokoroWait} giay." -ForegroundColor Red
        Write-Host "  Kiem tra file log: $KokoroLogFile / $KokoroErrFile" -ForegroundColor Yellow

        if (Test-Path $KokoroErrFile) {
            $errLines = Get-Content -Path $KokoroErrFile -Tail 15 -ErrorAction SilentlyContinue
            if ($errLines) {
                Write-Host "--- 15 dong cuoi tu $KokoroErrFile ---" -ForegroundColor DarkGray
                $errLines | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
            }
        }
        if (Test-Path $KokoroLogFile) {
            $logLines = Get-Content -Path $KokoroLogFile -Tail 15 -ErrorAction SilentlyContinue
            if ($logLines) {
                Write-Host "--- 15 dong cuoi tu $KokoroLogFile ---" -ForegroundColor DarkGray
                $logLines | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
            }
        }

        if ($procKokoro -and -not $procKokoro.HasExited) {
            Stop-Process -Id $procKokoro.Id -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -Path $KokoroPidFile -Force -ErrorAction SilentlyContinue
        exit 1
    }

    $actualKokoroPid = Get-PortOwnerPid 8880
    if ($actualKokoroPid) {
        $cimProc = Get-CimInstance Win32_Process -Filter "ProcessId=$actualKokoroPid" -ErrorAction SilentlyContinue
        if ($cimProc.ProcessId -eq $procKokoro.Id -or $cimProc.ParentProcessId -eq $procKokoro.Id) {
            Set-Content -Path $KokoroPidFile -Value $actualKokoroPid -Encoding utf8
            if ($cimProc.ParentProcessId -eq $procKokoro.Id) {
                Set-Content -Path (Join-Path $RuntimeDir "kokoro_wrapper.pid") -Value $procKokoro.Id -Encoding utf8
            }
            Write-Host "  [OK] Kokoro-FastAPI da xac thuc san sang (Service PID: $actualKokoroPid)." -ForegroundColor Green
        } else {
            Write-Host "  [OK] Kokoro-FastAPI da san sang tren http://127.0.0.1:8880" -ForegroundColor Green
        }
    } else {
        Write-Host "  [OK] Kokoro-FastAPI da san sang tren http://127.0.0.1:8880" -ForegroundColor Green
    }
}

# ------------------------------------------------------------------------------
# BUOC 3: KIEM TRA VA KHOI DONG UNFOLDIQ STUDIO (PORT 7860)
# ------------------------------------------------------------------------------
Write-Host "`n[3/4] Kiem tra va khoi dong UnfoldIQ Studio (Cong 7860)..." -ForegroundColor White

$studioPortOccupied = Test-PortListening 7860
if ($studioPortOccupied) {
    if (Test-HttpHealth "http://127.0.0.1:7860/health") {
        $existingStudioPid = Get-PortOwnerPid 7860
        if ($existingStudioPid) {
            Set-Content -Path $StudioPidFile -Value $existingStudioPid -Encoding utf8
            Write-Host "  [OK] UnfoldIQ Studio da chay san va dang hoat dong tot (PID $existingStudioPid)." -ForegroundColor Green
        } else {
            Write-Host "  [OK] UnfoldIQ Studio da chay san va dang hoat dong tot tren port 7860." -ForegroundColor Green
        }
    } else {
        $ownerPid = Get-PortOwnerPid 7860
        $info = Get-ProcessInfo $ownerPid
        Write-Host "  [LOI] Port 7860 dang duoc su dung boi process khac khong phan hoi." -ForegroundColor Red
        Write-Host "        Process : $($info.Name)" -ForegroundColor Yellow
        Write-Host "        PID     : $ownerPid" -ForegroundColor Yellow
        Write-Host "        Port    : 7860" -ForegroundColor Yellow
        Write-Host "  Vui long kiem tra hoac tat tien trinh dang chiem port 7860 thu cong." -ForegroundColor Yellow

        if ($spawnedKokoro -and $procKokoro -and -not $procKokoro.HasExited) {
            Write-Host "  [..] Rollback: Dang dung tien trinh Kokoro vua khoi dong (PID $($procKokoro.Id))..." -ForegroundColor Yellow
            Stop-Process -Id $procKokoro.Id -Force -ErrorAction SilentlyContinue
            Remove-Item -Path $KokoroPidFile -Force -ErrorAction SilentlyContinue
            Remove-Item -Path (Join-Path $RuntimeDir "kokoro_wrapper.pid") -Force -ErrorAction SilentlyContinue
        }
        exit 1
    }
} else {
    Write-Host "  [..] Dang khoi dong UnfoldIQ Studio trong che do background..." -ForegroundColor Gray

    $nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Set-Content -Path $StudioLogFile -Value "[$nowStr] [LAUNCHER] Starting UnfoldIQ Studio on port 7860..." -Encoding utf8

    $procStudio = Start-Process `
        -FilePath $PythonExe `
        -ArgumentList "-m uvicorn studio.app:app --host 127.0.0.1 --port 7860" `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $StudioLogFile `
        -RedirectStandardError $StudioErrFile `
        -PassThru

    $spawnedStudio = $true
    Set-Content -Path $StudioPidFile -Value $procStudio.Id -Encoding utf8
    Write-Host "  [..] Da spawn tien trinh Studio (PID: $($procStudio.Id))." -ForegroundColor Gray
    Write-Host "  [..] Dang cho UnfoldIQ Studio san sang" -NoNewline -ForegroundColor Gray

    # Cho health check (toi da 15 giay)
    $maxStudioWait = 15
    $studioHealthy = $false
    for ($i = 1; $i -le $maxStudioWait; $i++) {
        Start-Sleep -Seconds 1
        Write-Host "." -NoNewline -ForegroundColor Gray
        if (Test-PortListening 7860) {
            if (Test-HttpHealth "http://127.0.0.1:7860/health") {
                $studioHealthy = $true
                break
            }
        }
    }
    Write-Host ""

    if (-not $studioHealthy) {
        Write-Host "  [LOI] UnfoldIQ Studio khong vuot qua kiem tra health check trong ${maxStudioWait} giay." -ForegroundColor Red
        Write-Host "  Kiem tra file log: $StudioLogFile / $StudioErrFile" -ForegroundColor Yellow

        if (Test-Path $StudioErrFile) {
            $errLines = Get-Content -Path $StudioErrFile -Tail 15 -ErrorAction SilentlyContinue
            if ($errLines) {
                Write-Host "--- 15 dong cuoi tu $StudioErrFile ---" -ForegroundColor DarkGray
                $errLines | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
            }
        }
        if (Test-Path $StudioLogFile) {
            $logLines = Get-Content -Path $StudioLogFile -Tail 15 -ErrorAction SilentlyContinue
            if ($logLines) {
                Write-Host "--- 15 dong cuoi tu $StudioLogFile ---" -ForegroundColor DarkGray
                $logLines | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
            }
        }

        if ($procStudio -and -not $procStudio.HasExited) {
            Stop-Process -Id $procStudio.Id -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -Path $StudioPidFile -Force -ErrorAction SilentlyContinue

        if ($spawnedKokoro -and $procKokoro -and -not $procKokoro.HasExited) {
            Write-Host "  [..] Rollback: Dang dung tien trinh Kokoro vua khoi dong (PID $($procKokoro.Id))..." -ForegroundColor Yellow
            Stop-Process -Id $procKokoro.Id -Force -ErrorAction SilentlyContinue
            Remove-Item -Path $KokoroPidFile -Force -ErrorAction SilentlyContinue
            Remove-Item -Path (Join-Path $RuntimeDir "kokoro_wrapper.pid") -Force -ErrorAction SilentlyContinue
        }
        exit 1
    }

    $actualStudioPid = Get-PortOwnerPid 7860
    if ($actualStudioPid) {
        $cimProc = Get-CimInstance Win32_Process -Filter "ProcessId=$actualStudioPid" -ErrorAction SilentlyContinue
        if ($cimProc.ProcessId -eq $procStudio.Id -or $cimProc.ParentProcessId -eq $procStudio.Id) {
            Set-Content -Path $StudioPidFile -Value $actualStudioPid -Encoding utf8
            if ($cimProc.ParentProcessId -eq $procStudio.Id) {
                Set-Content -Path (Join-Path $RuntimeDir "studio_wrapper.pid") -Value $procStudio.Id -Encoding utf8
            }
            Write-Host "  [OK] UnfoldIQ Studio da xac thuc san sang (Service PID: $actualStudioPid)." -ForegroundColor Green
        } else {
            Write-Host "  [OK] UnfoldIQ Studio da san sang tren http://127.0.0.1:7860" -ForegroundColor Green
        }
    } else {
        Write-Host "  [OK] UnfoldIQ Studio da san sang tren http://127.0.0.1:7860" -ForegroundColor Green
    }
}

# ------------------------------------------------------------------------------
# BUOC 4: KIEM TRA KET NOI VA MO TRINH DUYET
# ------------------------------------------------------------------------------
Write-Host "`n[4/4] Kiem tra ket noi va mo trinh duyet..." -ForegroundColor White

$kokoroOk = Test-HttpHealth "http://127.0.0.1:8880/health"
$studioOk = Test-HttpHealth "http://127.0.0.1:7860/health"

if (-not ($kokoroOk -and $studioOk)) {
    Write-Host "  [LOI] Kiem tra ket noi cuoi cung khong vuot qua (Kokoro: $kokoroOk, Studio: $studioOk)." -ForegroundColor Red
    exit 1
}

Write-Host "  [OK] Kokoro API : http://127.0.0.1:8880/health (Healthy)" -ForegroundColor Green
Write-Host "  [OK] Studio Web : http://127.0.0.1:7860/health (Healthy)" -ForegroundColor Green

if (-not $NoBrowser) {
    Write-Host "  [..] Dang mo UnfoldIQ Studio tren trinh duyet..." -ForegroundColor Gray
    try {
        Start-Process "http://127.0.0.1:7860"
        Write-Host "  [OK] Da mo trinh duyet thanh cong." -ForegroundColor Green
    } catch {
        Write-Host "  [CANH BAO] He thong da san sang nhung khong the tu mo trinh duyet ($($_.Exception.Message))." -ForegroundColor Yellow
        Write-Host "            Vui long truy cap thu cong tai: http://127.0.0.1:7860" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [OK] Bo qua mo trinh duyet (-NoBrowser duoc chi dinh)." -ForegroundColor Gray
}

$displayStudioPid = Get-PortOwnerPid 7860
$displayKokoroPid = Get-PortOwnerPid 8880

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  HE THONG DA SAN SANG SU DUNG!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Studio Web UI : http://127.0.0.1:7860  (PID: $displayStudioPid)" -ForegroundColor Cyan
Write-Host "  Kokoro API    : http://127.0.0.1:8880  (PID: $displayKokoroPid)" -ForegroundColor Cyan
Write-Host "  De dung he thong an toan, chay: stop-unfoldiq-tts.bat" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Green
exit 0
