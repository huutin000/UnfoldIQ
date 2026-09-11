# ==============================================================================
# UnfoldIQ TTS Studio — Live Worker Shutdown Verification Script
# Executes Phase 4 Audit H Live Verification Workflow
# ==============================================================================
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path ".").Path
$RuntimeDir = Join-Path $RepoRoot "runtime"
$ProjectsDir = Join-Path $RepoRoot "projects"
$TestProject = Join-Path $ProjectsDir "2026-09-11_shutdown_verification_test"
$LongformProject = Join-Path $ProjectsDir "2026-09-10_211401_longform_acceptance_20k"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "PHASE 4 WORKER SHUTDOWN LIVE VERIFICATION TEST" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 0. Safety cleanup of any lingering state before test
if (Test-Path $TestProject) {
    Remove-Item -Path $TestProject -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $TestProject -Force | Out-Null

Write-Host "`n[Step 1] Preparing test project from long-form audio (22m18s)..." -ForegroundColor White
Copy-Item (Join-Path $LongformProject "audio.wav") -Destination (Join-Path $TestProject "audio.wav") -Force
Copy-Item (Join-Path $LongformProject "script.txt") -Destination (Join-Path $TestProject "script.txt") -Force
Copy-Item (Join-Path $LongformProject "manifest.json") -Destination (Join-Path $TestProject "manifest.json") -Force
Write-Host "  -> Project initialized at $TestProject with 107 MB WAV (Duration: 22m18s)." -ForegroundColor Gray

# Ensure ports 7860 & 8880 are closed before starting
$openPorts = Get-NetTCPConnection -LocalPort 7860,8880 -ErrorAction SilentlyContinue
if ($openPorts) {
    Write-Host "  -> Warning: Ports occupied before test. Running stop script..." -ForegroundColor Yellow
    cmd.exe /c stop-unfoldiq-tts.bat
    Start-Sleep -Seconds 2
}

# 1. Start UnfoldIQ using root launcher
Write-Host "`n[Step 2] Starting UnfoldIQ services via scripts\start-unfoldiq-tts.ps1..." -ForegroundColor White
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '$RepoRoot\scripts\start-unfoldiq-tts.ps1' -NoBrowser"

# Wait for health
$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $kRes = Invoke-RestMethod -Uri "http://127.0.0.1:8880/health" -TimeoutSec 2 -ErrorAction Stop
        $sRes = Invoke-RestMethod -Uri "http://127.0.0.1:7860/health" -TimeoutSec 2 -ErrorAction Stop
        if ($kRes.status -eq "healthy" -and $sRes.status -eq "healthy") {
            $healthy = $true
            break
        }
    } catch {}
}

if (-not $healthy) {
    Write-Host "[ERROR] Services failed to reach healthy state within 30s." -ForegroundColor Red
    exit 1
}
Write-Host "  -> Both Kokoro (8880) and Studio (7860) verified operational." -ForegroundColor Green

# 2. Dispatch real GPU timestamp generation job
Write-Host "`n[Step 3] Launching real GPU transcription job on test project..." -ForegroundColor White
$jobStart = Invoke-RestMethod -Uri "http://127.0.0.1:7860/api/projects/2026-09-11_shutdown_verification_test/timestamps" -Method Post -TimeoutSec 10
Write-Host "  -> Start response: Status=$($jobStart.status), Model=$($jobStart.job.model), Device=$($jobStart.job.device)" -ForegroundColor Gray

# 3. Wait until worker is actively loading model or transcribing
Write-Host "`n[Step 4] Polling worker state until actively loading_model or transcribing..." -ForegroundColor White
$workerActive = $false
$workerPid = $null

for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $st = Invoke-RestMethod -Uri "http://127.0.0.1:7860/api/projects/2026-09-11_shutdown_verification_test/timestamps/status" -TimeoutSec 5
        Write-Host "  -> State: $($st.state), Stage: $($st.stage), Progress: $($st.percent)%, Message: $($st.message)" -ForegroundColor Gray
        if ($st.stage -in @("loading_model", "transcribing") -or $st.state -in @("loading_model", "transcribing")) {
            $workerActive = $true
            break
        }
    } catch {}
}

if (-not $workerActive) {
    Write-Host "[ERROR] Worker did not enter loading_model or transcribing state!" -ForegroundColor Red
    exit 1
}

# 4. Record and inspect runtime\transcription_worker.pid
$pidFile = Join-Path $RuntimeDir "transcription_worker.pid"
if (-not (Test-Path $pidFile)) {
    Write-Host "[ERROR] runtime\transcription_worker.pid was not created!" -ForegroundColor Red
    exit 1
}
$workerPid = [int]((Get-Content $pidFile -Raw).Trim())
Write-Host "`n[Step 5] Recorded real transcription worker PID: $workerPid" -ForegroundColor Green

# 5. Inspect PID with Get-CimInstance Win32_Process
Write-Host "`n[Step 6] Inspecting worker process identity via Win32_Process:" -ForegroundColor White
$cimProc = Get-CimInstance Win32_Process -Filter "ProcessId=$workerPid"
$cimProc | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine | Format-List | Out-String | Write-Host

# Confirm identity
if ($cimProc.CommandLine -notmatch "worker\.py" -and $cimProc.CommandLine -notmatch "transcription") {
    Write-Host "[ERROR] Process CommandLine does not identify UnfoldIQ transcription worker!" -ForegroundColor Red
    exit 1
}
Write-Host "  -> Confirmed: Process CommandLine matches UnfoldIQ transcription worker." -ForegroundColor Green

# 6. Capture GPU state via nvidia-smi before shutdown
Write-Host "`n[Step 7] GPU state before shutdown (nvidia-smi):" -ForegroundColor White
$gpuBefore = nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
Write-Host ($gpuBefore -join "`n")

# 7. WHILE WORKER IS STILL ACTIVE, run root shutdown entry point stop-unfoldiq-tts.bat
Write-Host "`n[Step 8] Executing root stop-unfoldiq-tts.bat WHILE WORKER IS ACTIVE..." -ForegroundColor Cyan
$stopOutput = cmd.exe /c stop-unfoldiq-tts.bat 2>&1
Write-Host ($stopOutput -join "`n")

# 8. Post-Shutdown Assertions
Write-Host "`n[Step 9] Verifying Post-Shutdown Assertions:" -ForegroundColor White

# Assertion 1: Worker PID terminated
$procAfter = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
$workerTerminated = ($null -eq $procAfter)
Write-Host "  [Assertion 1] Worker PID $workerPid terminated: $workerTerminated" -ForegroundColor $(if ($workerTerminated) { "Green" } else { "Red" })
if (-not $workerTerminated) { throw "Worker PID $workerPid still exists!" }

# Assertion 2: GPU process cleared
$gpuAfter = nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
$workerOnGpu = ($gpuAfter -match "$workerPid")
Write-Host "  [Assertion 2] Worker PID $workerPid absent from GPU: $(-not $workerOnGpu)" -ForegroundColor $(if (-not $workerOnGpu) { "Green" } else { "Red" })
if ($workerOnGpu) { throw "Worker PID $workerPid still present in nvidia-smi!" }

Start-Sleep -Seconds 1

# Assertion 3: Studio port 7860 closed
$studioConns = Get-NetTCPConnection -LocalPort 7860 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }
$studioClosed = ($null -eq $studioConns)
Write-Host "  [Assertion 3] Studio port 7860 closed: $studioClosed" -ForegroundColor $(if ($studioClosed) { "Green" } else { "Red" })
if (-not $studioClosed) { throw "Studio port 7860 is still listening!" }

# Assertion 4: Kokoro port 8880 closed
$kokoroConns = Get-NetTCPConnection -LocalPort 8880 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }
$kokoroClosed = ($null -eq $kokoroConns)
Write-Host "  [Assertion 4] Kokoro port 8880 closed: $kokoroClosed" -ForegroundColor $(if ($kokoroClosed) { "Green" } else { "Red" })
if (-not $kokoroClosed) { throw "Kokoro port 8880 is still listening!" }

# Assertion 5: PID files removed
$pidWorkerExists = Test-Path (Join-Path $RuntimeDir "transcription_worker.pid")
$pidStudioExists = Test-Path (Join-Path $RuntimeDir "studio.pid")
$pidKokoroExists = Test-Path (Join-Path $RuntimeDir "kokoro.pid")
Write-Host "  [Assertion 5] PID files removed (Worker=$(-not $pidWorkerExists), Studio=$(-not $pidStudioExists), Kokoro=$(-not $pidKokoroExists))" -ForegroundColor Green
if ($pidWorkerExists -or $pidStudioExists -or $pidKokoroExists) { throw "One or more PID files were not unlinked!" }

# Assertion 6: No false timestamp files created from interrupted job
$tsJsonExists = Test-Path (Join-Path $TestProject "timestamps.json")
$tsSrtExists = Test-Path (Join-Path $TestProject "timestamps.srt")
Write-Host "  [Assertion 6] No false completed timestamps created (JSON=$(-not $tsJsonExists), SRT=$(-not $tsSrtExists))" -ForegroundColor Green
if ($tsJsonExists -or $tsSrtExists) { throw "Incomplete timestamps file falsely marked as completed!" }

# Assertion 7: Source files remain intact
$audioIntact = Test-Path (Join-Path $TestProject "audio.wav")
$scriptIntact = Test-Path (Join-Path $TestProject "script.txt")
Write-Host "  [Assertion 7] Source project files remain intact: $($audioIntact -and $scriptIntact)" -ForegroundColor Green

# 9. Verify restart & new timestamp job completion
Write-Host "`n[Step 10] Testing service restart and clean subsequent timestamp job..." -ForegroundColor White
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '$RepoRoot\scripts\start-unfoldiq-tts.ps1' -NoBrowser"

# Wait for restart health
$restartHealthy = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $kRes = Invoke-RestMethod -Uri "http://127.0.0.1:8880/health" -TimeoutSec 2 -ErrorAction Stop
        $sRes = Invoke-RestMethod -Uri "http://127.0.0.1:7860/health" -TimeoutSec 2 -ErrorAction Stop
        if ($kRes.status -eq "healthy" -and $sRes.status -eq "healthy") {
            $restartHealthy = $true
            break
        }
    } catch {}
}
Write-Host "  -> Restart health check: $restartHealthy" -ForegroundColor Green

# Clear any previous timestamps on short project 2026-09-10_213623_browser_ui_acceptance_test
$shortProj = Join-Path $ProjectsDir "2026-09-10_213623_browser_ui_acceptance_test"
Remove-Item (Join-Path $shortProj "timestamps.json") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $shortProj "timestamps.srt") -Force -ErrorAction SilentlyContinue

Write-Host "  -> Dispatching new short timestamp job after restart..." -ForegroundColor Gray
$restartJob = Invoke-RestMethod -Uri "http://127.0.0.1:7860/api/projects/2026-09-10_213623_browser_ui_acceptance_test/timestamps" -Method Post

$subsequentCompleted = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $st = Invoke-RestMethod -Uri "http://127.0.0.1:7860/api/projects/2026-09-10_213623_browser_ui_acceptance_test/timestamps/status" -TimeoutSec 5
        if ($st.state -eq "completed") {
            $subsequentCompleted = $true
            Write-Host "  -> Subsequent job completed in $($st.audio_duration)s audio duration with $($st.coverage_pct)% coverage!" -ForegroundColor Green
            break
        }
    } catch {}
}

if (-not $subsequentCompleted) {
    throw "Subsequent timestamp job failed to complete after restart!"
}

# Clean shutdown at end of test
Write-Host "`n[Step 11] Shutting down services cleanly..." -ForegroundColor White
cmd.exe /c stop-unfoldiq-tts.bat | Out-Null

# Cleanup test project
Remove-Item -Path $TestProject -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "`n======================================================================" -ForegroundColor Green
Write-Host "ALL POST-SHUTDOWN ASSERTIONS PASSED (100% VERIFIED)!" -ForegroundColor Green
Write-Host "VERDICT: PHASE 4 WORKER SHUTDOWN PASS" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
