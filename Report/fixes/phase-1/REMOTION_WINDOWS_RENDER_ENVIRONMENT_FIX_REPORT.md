# REMOTION WINDOWS RENDER ENVIRONMENT FIX — REPORT

Date: 2026-10-01
Goal per spec: reach 59/59 regression PASS by fixing the Windows Remotion render environment.
Final conclusion: **PARTIAL — 56/59 PASS; 3 real-render suites remain blocked by Windows Smart App Control on unsigned Remotion compositor binaries.** The user chose to keep SAC enabled; no per-app bypass exists; disabling SAC is a machine-wide security change and was not chosen for this task.

## 1. Exact root cause

**Windows Smart App Control is ON and blocks process creation of the unsigned vendored Remotion compositor binaries** (`ffmpeg.exe`, `remotion.exe`, `ffprobe.exe` inside `remotion/node_modules/@remotion/compositor-win32-x64-msvc/`).

Evidence chain (all collected on this machine, 2026-10-01):

1. **Code Integrity block event** (the decisive one), `Microsoft-Windows-CodeIntegrity/Operational`, event **3077** at the exact probe time:
   > Code Integrity determined that a process (…\node.exe) attempted to load …\@remotion\compositor-win32-x64-msvc\ffmpeg.exe that **did not meet the Enterprise signing level requirements** or violated code integrity policy (**Policy ID:{0283ac0f-fff1-49ae-ada1-8a933130cad6}** — the Smart App Control policy). Companion events 3033/3089 recorded.
2. **SAC state**: `HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy → VerifiedAndReputablePolicyState = 1` (= ON; 0 = off, 2 = evaluation). Host is Windows 11 Insider build 10.0.26300.
3. **Blocked execution signatures**: `spawnSync(ffmpeg.exe)` → `error UNKNOWN (errno -4094)` at CreateProcess (all variants: direct, with cwd, from a copied dir without `@` in the path, retried ×3 — consistent, not transient). Via cmd shell, the process runs and exits with **3236495362 = 0xC0E90002** — the Windows App Control block exit-code family. Control test: signed `node.exe` spawns fine (status 0).
4. **The binaries are unsigned**: `Get-AuthenticodeSignature` → **NotSigned** for `ffmpeg.exe` and `remotion.exe`. SAC blocks unsigned binaries regardless of malware status.
5. **Ruled out — package integrity**: all Remotion packages installed at exactly **4.0.529** (bundler/renderer/cli/remotion/compositor), matching `^4.0.529`; compositor package complete (20 files incl. all FFmpeg DLLs); PE headers valid x64 (MZ + PE signature + machine 0x8664) for all three exes; no `Zone.Identifier` ADS; ACLs normal (Authenticated Users: Modify).
6. **Ruled out — Defender malware quarantine**: Defender fully enabled (AM/Antivirus/RealTime/Behavior/Ioav), `Get-MpThreatDetection`/`Get-MpThreat` contain **no** detections for ffmpeg/compositor/remotion — the block is policy-based (SAC), not malware-based.
7. **Ruled out — reinstall/upgrade fix**: latest published `@remotion/compositor-win32-x64-msvc@4.0.531` was downloaded and inspected — its `ffmpeg.exe` is **also NotSigned**. Reinstalling or upgrading cannot satisfy an "Enterprise signing level" requirement.
8. **No per-binary exclusion exists**: SAC has no per-app/per-file exclusion mechanism (Microsoft SAC FAQ); Defender exclusions do not apply; a locally created self-signed certificate is not trusted by SAC (cloud reputation / Microsoft-trusted CAs only).

## 2. Environment changed

**None.** The one currently practical remediation on this machine — disabling SAC — is a machine-wide security change and was explicitly declined by the user when presented with the evidence. Probe artifacts (`_probe-ffmpeg.js`, `out/__sigcheck/`) were deleted; repository and packages untouched; no security settings modified.

## 3. Commands executed (diagnosis)

```text
node -p "process.version + arch"           → v24.16.0 x64; Windows x64, build 10.0.26300
npm ls-equivalent version checks           → all @remotion/* 4.0.529 (compatible)
dir + PE header inspection                 → compositor package complete, PE x64 valid
Get-Item -Stream / icacls                  → no ADS, ACLs normal
spawnSync probes (direct/cwd/shell/copy)   → UNKNOWN(-4094) / 0xC0E90002; node.exe control: OK
Get-MpComputerStatus / Get-MpThreat*       → Defender on; zero related detections
VerifiedAndReputablePolicyState            → 1 (SAC ON)
Get-WinEvent CodeIntegrity 3077            → Enterprise-signing-level block on ffmpeg.exe (SAC policy)
Get-AuthenticodeSignature (installed+4.0.531) → NotSigned both
```

## 4. Three failing-suite results (re-run after diagnosis)

| Suite | Result |
|---|---|
| `node tests/pipeline/test-step13-pipeline-e2e.js` | FAIL — real render step hits the blocked `ffmpeg.exe` spawn |
| `node tests/remotion/test-remotion-render-smoke.js` | FAIL — setup/stage/validate PASS (pure Node), `--render-test` FAILS at ffmpeg spawn; ffprobe fails downstream (no mp4 produced) |
| `node tests/remotion/test-render-control.js` | FAIL — RC0 (staging via render-plan-cli) PASS; RC1 (real 3s render) fails at ffmpeg spawn |

Not weakened, skipped, mocked, or marked optional — unchanged from the pre-task state.

## 5. Domain + full regression results

- `npm run test:remotion` → 2 failed suites (the two render-real ones); other 16 remotion suites PASS.
- `npm run test:pipeline` → 1 failed suite (step13 e2e); other 11 PASS.
- `npm test` (full) → **56/59 PASS** (same 3 failures; all flow/providers/media/policy/qa/topic domains + extension suite 394/0 green).
- `npm run check:repo-structure` → **REPOSITORY_STRUCTURE_OK** (the diagnosis introduced no root clutter; probes deleted).

## 6. Current blocker and possible future options

**Current practical blocker on this machine:** Smart App Control blocks the unsigned Remotion compositor binaries; SAC has no per-app/per-file exclusion mechanism (Microsoft SAC FAQ), Defender exclusions do not apply, and a locally created self-signed certificate is not trusted by SAC (cloud reputation / Microsoft-trusted CAs only).

**Possible future options** (none applied in this task):

- Remotion ships signed compositor binaries (vendor-side; latest 4.0.531 is still NotSigned);
- a trusted/signed compatible binaries directory is supplied through Remotion's supported `binariesDirectory` / `--binaries-directory` mechanism, if the supplied binaries satisfy the machine's code-integrity policy;
- an organization-managed App Control (WDAC) policy explicitly permits the binaries (managed devices only);
- the user disables SAC, if they choose to accept that machine-wide security trade-off.

Note: a plain system FFmpeg is NOT a supported drop-in replacement — Remotion v4 removed the `ffmpegExecutable`/system-FFmpeg option and requires its own compositor binaries; only the binaries-directory mechanism above stays within the supported architecture.

**Remediation the user may still choose** (deliberately NOT executed in this task): turn SAC off (Settings → Privacy & security → Windows Security → App & browser control → Smart App Control settings → Off, or admin PowerShell: `Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy" -Name VerifiedAndReputablePolicyState -Value 0`, then reboot). Current Microsoft documentation notes that recent Windows updates may allow re-enabling Smart App Control in Windows Security without a clean install — check the SAC state in Windows Security after the update rather than assuming either way. After disabling, re-run `npm run test:remotion`, `npm run test:pipeline`, `npm test` — expected 59/59 with zero code changes.

## 7. Remaining issues

- The blocker itself (see conclusion). No repository-side work in this task can satisfy the signing policy: the project architecture requires Remotion's own compositor binaries (Remotion v4 removed the `ffmpegExecutable`/system-FFmpeg option; a system FFmpeg is not a supported drop-in replacement). Longer-term paths are listed in §6.

### Factual correction

- The earlier statement that disabling SAC is irreversible and that "SAC cannot be re-enabled without resetting/reinstalling Windows" has been **corrected against current Microsoft documentation**: recent Windows updates may allow re-enabling Smart App Control in Windows Security without a clean install. The report no longer claims irreversibility.
- The remediation wording no longer claims that disabling SAC is "the only" theoretical path; it is the currently practical blocker removal on this machine, alongside the future options listed in §6 (signed vendor binaries, the supported `binariesDirectory` mechanism, an org-managed WDAC policy, or the user accepting the SAC trade-off).

## 8. Final conclusion

**PARTIAL — 56/59 PASS; 3 real-render suites remain blocked by Windows Smart App Control on unsigned Remotion compositor binaries.** (Root cause evidence unchanged: policy {0283ac0f-fff1-49ae-ada1-8a933130cad6}, VerifiedAndReputablePolicyState=1, CodeIntegrity event 3077, binaries NotSigned incl. latest 4.0.531. The user chose to keep SAC enabled; no per-app bypass exists; disabling SAC is a machine-wide security change and was not chosen for this task.)
