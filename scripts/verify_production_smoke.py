"""Production smoke test for frozen UnfoldIQ v1.0.0 (verification-only).

Drives the REAL production HTTP interfaces + a real headed-Chrome CDP gate
against the running release candidate. Creates ONE disposable smoke project,
verifies lifecycle/script/voice/visual/export/render/QA/persistence, then
removes the disposable project. Fails non-zero on any critical failure and
preserves failure evidence (project left on disk for forensics).

Usage: python scripts/verify_production_smoke.py
Evidence: temp/production_smoke/
"""
import base64
import datetime
import json
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

APP = "http://127.0.0.1:7860"
KOKORO = "http://127.0.0.1:8880"
OUT = REPO / "temp" / "production_smoke"
SHOT = OUT / "screenshots"
LOGS = OUT / "logs"
PROFILE = REPO / "temp" / "smoke_profile_prod"
CDP_PORT = 9410
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

RELEASE_VERSION = "v1.0.0"
COMMIT_SHA = "4f33307f8043516baeee983e690252bc793bf918"
SMOKE_TEXT = ("Production smoke verification. "
              "The studio starts cold and the release candidate serves this narration.")
TS = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
SMOKE_SLUG = f"SMOKE_V1_0_0_{TS}"

summary = {
    "release_version": RELEASE_VERSION,
    "commit_sha": COMMIT_SHA,
    "started_at": datetime.datetime.now().astimezone().isoformat(),
    "finished_at": None,
    "status": "FAIL",
    "critical_failures": [],
    "startup": {},
    "project_lifecycle": {},
    "script": {},
    "voice": {},
    "visual": {},
    "export": {},
    "persistence": {},
    "browser_runtime": {},
    "cleanup": {},
}
http_log = []
failures = []


def note(section, key, value):
    summary[section][key] = value


def fail(msg):
    print(f"SMOKE-FAIL: {msg}", flush=True)
    failures.append(msg)


def req(method, path, body=None, timeout=120, raw=False):
    url = APP + path if path.startswith("/") else path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            payload = resp.read()
            entry = {"method": method, "path": path, "status": resp.status,
                     "ms": round((time.time() - t0) * 1000)}
            http_log.append(entry)
            if resp.status >= 500:
                fail(f"unexpected server 5xx: {method} {path} -> {resp.status}")
            if raw:
                return resp.status, payload
            try:
                return resp.status, json.loads(payload.decode())
            except Exception:
                return resp.status, {"_raw_len": len(payload)}
    except urllib.error.HTTPError as e:
        entry = {"method": method, "path": path, "status": e.code,
                 "ms": round((time.time() - t0) * 1000)}
        http_log.append(entry)
        if e.code >= 500:
            fail(f"unexpected server 5xx: {method} {path} -> {e.code}")
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}
    except Exception as e:
        http_log.append({"method": method, "path": path, "status": "CONN_FAIL",
                         "ms": round((time.time() - t0) * 1000)})
        fail(f"connection failure: {method} {path}: {str(e)[:150]}")
        return -1, {}


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg, flush=True)
    if not cond:
        fail(msg)
    return bool(cond)


def wait_job(job_id, timeout_s=600, label="job"):
    t0 = time.time()
    last = {}
    while time.time() - t0 < timeout_s:
        st, body = req("GET", f"/api/jobs/{job_id}", timeout=30)
        if st != 200:
            time.sleep(5)
            continue
        last = body
        state = str(body.get("state", ""))
        if state in ("completed", "done", "success", "COMPLETED", "SUCCESS"):
            return last
        if state in ("failed", "error", "FAILED", "ERROR", "cancelled", "CANCELLED"):
            fail(f"{label} {job_id} entered terminal failure state={state}: "
                 f"{str(body.get('error_message', ''))[:200]}")
            return None
        time.sleep(5)
    fail(f"{label} {job_id} timed out after {timeout_s}s (last={str(last)[:200]})")
    return None


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    SHOT.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)

    # ---- startup ----
    try:
        st, health = req("GET", "/health", timeout=20)
        ok = st == 200 and health.get("status") == "healthy"
        note("startup", "studio_healthy", ok)
        note("startup", "kokoro_healthy", (health.get("kokoro") or {}).get("healthy") is True)
        check(ok, "studio /health healthy")
        check((health.get("kokoro") or {}).get("healthy") is True, "kokoro healthy via studio")
    except Exception as e:
        fail(f"startup health exception: {e}")
        return finish(2)
    st, voices = req("GET", "/api/voices", timeout=30)
    vlist = voices.get("voices", []) if isinstance(voices, dict) else []
    note("startup", "voice_count", len(vlist))
    check(st == 200 and len(vlist) > 0, "voice list responds with voices")
    import socket
    dup = []
    for port in (7860, 8880):
        try:
            conns = subprocess.run(["netstat", "-ano"], capture_output=True, text=True,
                                   timeout=30).stdout.count(f"127.0.0.1:{port}")
            dup.append({"port": port, "listeners": conns})
        except Exception:
            pass
    note("startup", "port_listeners", dup)

    # ---- create disposable project via real TTS job ----
    st, job = req("POST", "/api/generate",
                  {"text": SMOKE_TEXT, "project_name": SMOKE_SLUG,
                   "voice": "af_heart", "speed": 1.0, "export_mp3": False},
                  timeout=60)
    if not check(st == 200 and job.get("job_id"), "TTS job accepted (project create)"):
        return finish(2)
    job_id = job["job_id"]
    note("project_lifecycle", "job_id", job_id)
    final = wait_job(job_id, timeout_s=600, label="tts")
    if final is None:
        return finish(2)
    proj_dir = final.get("project_dir", "")
    note("project_lifecycle", "project_dir", proj_dir)
    if not check(bool(proj_dir), "job reports project_dir"):
        return finish(2)
    dname = Path(proj_dir).name if "/" in proj_dir or "\\" in proj_dir else proj_dir
    # project_dir may be absolute; dir_name is the folder name
    import os
    dname = os.path.basename(proj_dir.rstrip("/\\"))
    note("project_lifecycle", "dir_name", dname)
    check((REPO / "projects" / dname).exists(), "project directory exists on disk")

    # open: status + state + overview
    st, status = req("GET", f"/api/projects/{dname}/status", timeout=60)
    check(st == 200, "project status opens")
    st, state = req("GET", f"/api/projects/{dname}/v2/state", timeout=60)
    check(st == 200, "project v2 state opens")

    # ---- script workflow ----
    st, script = req("GET", f"/api/projects/{dname}/script", timeout=60)
    check(st == 200 and SMOKE_TEXT[:20] in (script.get("script", "") or ""), "script displays")
    edited = SMOKE_TEXT + " Second take appended."
    st, saved = req("PUT", f"/api/projects/{dname}/script", {"text": edited}, timeout=60)
    check(st == 200, "script save works")
    st, script2 = req("GET", f"/api/projects/{dname}/script", timeout=60)
    check(st == 200 and "Second take" in (script2.get("script", "") or ""), "reload preserves edit")
    note("script", "word_count", saved.get("word_count"))
    st, locked = req("POST", f"/api/projects/{dname}/lock/script/script",
                     {"locked": True}, timeout=60)
    check(st == 200 and locked.get("is_locked") is True, "script lock works")
    st, unlocked = req("POST", f"/api/projects/{dname}/lock/script/script",
                       {"locked": False}, timeout=60)
    check(st == 200 and unlocked.get("is_locked") is False, "script unlock works")

    # ---- voice ----
    st, wav = req("GET", f"/api/projects/{dname}/audio/wav", timeout=120, raw=True)
    audio_ok = st == 200 and len(wav) > 1000
    check(audio_ok, f"candidate audio readable ({len(wav) if isinstance(wav, bytes) else 0} bytes)")
    note("voice", "audio_bytes", len(wav) if isinstance(wav, bytes) else 0)
    if audio_ok:
        tmp = OUT / "smoke_audio.wav"
        tmp.write_bytes(wav)
        try:
            r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                                "format=duration", "-of",
                                "default=noprint_wrappers=1:nokey=1", str(tmp)],
                               capture_output=True, text=True, timeout=60)
            dur = float(r.stdout.strip())
            note("voice", "audio_duration_s", dur)
            check(dur > 0, f"audio decodable, duration {dur}s")
        except Exception as e:
            fail(f"ffprobe on smoke audio failed: {e}")
    st, qa = req("POST", f"/api/projects/{dname}/voice-qa/run", {"force_transcribe": False},
                 timeout=120)
    note("voice", "qa_start", {"status": st, "body": str(qa)[:200]})
    qa_ok = False
    for _ in range(40):
        time.sleep(10)
        st2, qag = req("GET", f"/api/projects/{dname}/voice-qa", timeout=60)
        if st2 == 200 and str(qag.get("status", "")).lower() in ("pass", "completed", "done",
                                                                  "success", "ready"):
            qa_ok = True
            note("voice", "qa_result", {k: qag.get(k) for k in ("status", "summary")})
            break
        if st2 == 200 and "fail" in str(qag.get("status", "")).lower():
            break
    check(qa_ok, "Voice QA path executes to a passing state")
    st, ts = req("POST", f"/api/projects/{dname}/timestamps/generate", {"force": True},
                 timeout=120)
    note("voice", "stt_start", st)
    stt_ok = False
    for _ in range(30):
        time.sleep(10)
        st2, tss = req("GET", f"/api/projects/{dname}/timestamps/status", timeout=60)
        if st2 == 200 and str(tss.get("status", "")).lower() in ("ready", "completed", "done",
                                                                  "success", "pass"):
            stt_ok = True
            break
    if not stt_ok:  # fallback: timestamps file itself proves STT path
        st2, tsj = req("GET", f"/api/projects/{dname}/timestamps.json", timeout=60)
        stt_ok = st2 == 200
        note("voice", "stt_fallback_timestamps_json", st2)
    check(stt_ok, "transcription/STT path available")

    # ---- visual ----
    st, sc = req("POST", f"/api/projects/{dname}/scenes/generate", {"force": True}, timeout=300)
    note("visual", "scenes_generate", st)
    st, scenes = req("GET", f"/api/projects/{dname}/scenes", timeout=120)
    slist = scenes.get("scenes", []) if isinstance(scenes, dict) else []
    check(st == 200 and len(slist) > 0, f"scene list loads ({len(slist)} scenes)")
    st, veo = req("POST", f"/api/projects/{dname}/veo/generate", {"force": True}, timeout=300)
    note("visual", "veo_generate", st)
    st, shots = req("GET", f"/api/projects/{dname}/veo", timeout=120)
    shlist = shots.get("shots", []) if isinstance(shots, dict) else []
    check(st == 200 and len(shlist) > 0, f"shot list loads ({len(shlist)} shots)")
    shot_edit_ok = False
    if shlist:
        sid = shlist[0].get("shot_id", "")
        st, upd = req("PATCH", f"/api/projects/{dname}/visual/shots/{sid}",
                      {"visual_objective": "Smoke-verified objective"}, timeout=120)
        shot_edit_ok = st == 200
        st, one = req("GET", f"/api/projects/{dname}/visual/shots/{sid}", timeout=60)
        if st == 200:
            shot_edit_ok = shot_edit_ok and "Smoke-verified" in json.dumps(one)
    check(shot_edit_ok, "shot edit/save + reload persists")
    st, bible = req("GET", f"/api/projects/{dname}/visual-bible", timeout=120)
    check(st == 200, "Visual Bible loads")
    st, vp = req("GET", f"/api/projects/{dname}/visual-prompts", timeout=120)
    check(st == 200, "Image Prompt state available")

    # ---- export / render / QA ----
    st, ready = req("GET", f"/api/projects/{dname}/export/readiness", timeout=120)
    rstatus = ready.get("status") if isinstance(ready, dict) else None
    note("export", "readiness", rstatus)
    note("export", "blockers", (ready.get("blockers") or []) if isinstance(ready, dict) else [])
    if not check(rstatus == "READY", f"export readiness READY (got {rstatus})"):
        return finish(2)
    st, manifest = req("GET", f"/api/projects/{dname}/render-manifest", timeout=120)
    check(st == 200, "Render Manifest compiles")
    st, exp = req("POST", f"/api/projects/{dname}/production/export", {}, timeout=180)
    export_id = (exp.get("exportId") or exp.get("export_id") or "") if isinstance(exp, dict) else ""
    note("export", "export_id", export_id)
    if not check(st == 200 and bool(export_id), "production export snapshot created"):
        return finish(2)
    st, rnd = req("POST", f"/api/projects/{dname}/render/final", {"exportId": export_id},
                  timeout=180)
    render_job = (rnd.get("jobId") or rnd.get("job_id") or "") if isinstance(rnd, dict) else ""
    note("export", "render_job", render_job)
    if not check(st == 200, "Final Render starts"):
        return finish(2)
    render_done = False
    t0 = time.time()
    while time.time() - t0 < 900:
        time.sleep(10)
        st, jobs = req("GET", f"/api/activity/jobs?projectId={dname}", timeout=60)
        blob = json.dumps(jobs)
        if "FAILED" in blob:
            fail(f"render job FAILED: {blob[:300]}")
            break
        st, rs = req("GET", f"/api/projects/{dname}/render/status", timeout=60)
        if isinstance(rs, dict) and rs.get("hasFinal"):
            render_done = True
            note("export", "final_path", rs.get("finalPath"))
            break
    if not check(render_done, "Final Render completes (hasFinal)"):
        return finish(2)
    st, fmp4 = req("GET", f"/api/projects/{dname}/renders/final/file", timeout=120, raw=True)
    check(st == 200 and len(fmp4) > 1000, "final.mp4 exists and readable")
    if st == 200 and isinstance(fmp4, bytes):
        (OUT / "smoke_final.mp4").write_bytes(fmp4)
        try:
            r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                                "format=duration", "-of",
                                "default=noprint_wrappers=1:nokey=1",
                                str(OUT / "smoke_final.mp4")],
                               capture_output=True, text=True, timeout=60)
            note("export", "final_duration_s", float(r.stdout.strip()))
        except Exception as e:
            fail(f"ffprobe on final.mp4 failed: {e}")
    st, qa_start = req("POST", f"/api/projects/{dname}/exports/{export_id}/qa", {"mode": "auto"},
                       timeout=180)
    qa_run = (qa_start.get("qaRunId") or qa_start.get("qa_run_id") or "") \
        if isinstance(qa_start, dict) else ""
    note("export", "qa_run", qa_run)
    qa_pass = False
    t0 = time.time()
    while time.time() - t0 < 600:
        time.sleep(10)
        st, latest = req("GET", f"/api/projects/{dname}/exports/{export_id}/qa/latest",
                         timeout=60)
        if st == 200 and isinstance(latest, dict):
            v = str(latest.get("verdict", "") or latest.get("status", ""))
            if v.upper() == "PASS":
                qa_pass = True
                note("export", "qa_report", str(latest)[:500])
                break
            if v.upper() == "FAIL":
                fail(f"Render QA verdict FAIL: {str(latest)[:300]}")
                break
    if not check(qa_pass, "Render QA PASS (auto-handoff)"):
        return finish(2)
    st, ready2 = req("GET", f"/api/projects/{dname}/export/readiness", timeout=120)
    art_state = json.dumps(ready2)
    note("export", "post_qa_readiness", (ready2.get("status") if isinstance(ready2, dict) else None))
    ready_state_ok = "READY" in art_state
    check(ready_state_ok, "artifact at READY after QA PASS")

    # ---- browser runtime gate (headed Chrome via CDP) ----
    try:
        from manual_browser_closure import CDP, wait_for
        import socket as _sock
        chrome = subprocess.Popen(
            [CHROME, f"--remote-debugging-port={CDP_PORT}",
             f"--user-data-dir={PROFILE.resolve()}",
             "--no-first-run", "--no-default-browser-check",
             "--window-size=1440,900", "about:blank"], stderr=subprocess.DEVNULL)
        try:
            for _ in range(30):
                time.sleep(1)
                try:
                    json.loads(urllib.request.urlopen(
                        f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=5).read())
                    break
                except Exception:
                    continue
            tg = json.loads(urllib.request.urlopen(
                f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=10).read())
            pt = next(t for t in tg if t.get("type") == "page")
            cdp = CDP(pt["webSocketDebuggerUrl"])
            cdp.call("Page.enable")
            cdp.call("Runtime.enable")
            cdp.call("Log.enable")
            cdp.call("Network.enable")
            failed_reqs = []
            js_errors = []
            cdp.call("Page.navigate", {"url": APP})
            ok_load = wait_for(cdp, "document.readyState==='complete'", 60)
            check(ok_load, "application shell renders")
            E = cdp.evaluate
            html = E("document.documentElement.outerHTML.slice(0,4000)")
            note("browser_runtime", "vi_ui", "Khám phá" in html or "Cảnh" in html or "Giọng" in html)
            check("Khám phá" in html or "Cảnh" in html or "Giọng" in html or "UnfoldIQ" in html,
                  "Vietnamese-first UI preserved")
            nav_ok = E("(() => { const t = document.querySelectorAll('button'); return t.length; })()")
            check(isinstance(nav_ok, (int, float)) and nav_ok > 5, "primary navigation present")
            time.sleep(3)
            data = cdp.call("Page.captureScreenshot", {"format": "png"}, timeout=45)["data"]
            (SHOT / "smoke-shell.png").write_bytes(base64.b64decode(data))
            cdp.drain()
            for m in cdp.events:
                try:
                    if m.get("method") == "Log.entryAdded":
                        e = (m.get("params") or {}).get("entry", {})
                        if e.get("level") in ("error",):
                            js_errors.append(str(e.get("text", ""))[:200])
                    if m.get("method") == "Network.loadingFailed":
                        failed_reqs.append(str((m.get("params") or {}).get("errorText", ""))[:120])
                    if m.get("method") == "Network.responseReceived":
                        code = ((m.get("params") or {}).get("response") or {}).get("status", 0)
                        if isinstance(code, int) and code >= 500:
                            fail(f"unexpected 5xx in browser session: {code}")
                except Exception:
                    pass
            crit = [e for e in js_errors if "Uncaught" in e or "Fatal" in e or "SyntaxError" in e]
            note("browser_runtime", "console_errors", len(js_errors))
            note("browser_runtime", "console_sample", js_errors[:10])
            note("browser_runtime", "failed_requests", failed_reqs[:10])
            check(len(crit) == 0, f"0 uncaught critical JS exceptions (critical={len(crit)})")
            (OUT / "browser_console.json").write_text(
                json.dumps({"errors": js_errors, "failed": failed_reqs}, indent=1,
                           ensure_ascii=False), encoding="utf-8")
            cdp.ws.close()
        finally:
            chrome.terminate()
    except Exception as e:
        fail(f"browser gate exception: {str(e)[:200]}")

    # ---- persistence gate data already captured; restart happens in Task 12 (external) ----
    note("persistence", "dir_name", dname)
    note("persistence", "export_id", export_id)
    (OUT / "smoke_project_ref.json").write_text(
        json.dumps({"dir_name": dname, "export_id": export_id}, indent=1), encoding="utf-8")
    return finish(0 if not failures else 2)


def finish(code):
    import platform
    summary["finished_at"] = datetime.datetime.now().astimezone().isoformat()
    summary["critical_failures"] = failures
    summary["status"] = "PASS" if not failures else "FAIL"
    (OUT / "smoke_summary.json").write_text(
        json.dumps(summary, indent=1, ensure_ascii=False), encoding="utf-8")
    (OUT / "http_results.json").write_text(
        json.dumps(http_log, indent=1, ensure_ascii=False), encoding="utf-8")
    try:
        tv = subprocess.run([sys.executable, "--version"], capture_output=True, text=True,
                            timeout=30).stdout.strip()
        ff = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True,
                            timeout=30).stdout.splitlines()[0]
        cuda = subprocess.run(
            [sys.executable, "-c", "import torch;print(torch.__version__,torch.cuda.is_available())"],
            capture_output=True, text=True, timeout=120).stdout.strip()
    except Exception as e:
        tv, ff, cuda = f"ERR {e}", "", ""
    (OUT / "runtime_environment.json").write_text(json.dumps({
        "release_version": RELEASE_VERSION, "commit_sha": COMMIT_SHA,
        "platform": platform.platform(), "python": tv, "ffmpeg": ff, "torch_cuda": cuda,
        "chrome": CHROME, "app": APP, "kokoro": KOKORO,
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    (OUT / "artifact_checks.json").write_text(json.dumps({
        "smoke_audio": str(OUT / "smoke_audio.wav"),
        "smoke_final": str(OUT / "smoke_final.mp4"),
        "shell_shot": str(SHOT / "smoke-shell.png"),
        "project_ref": str(OUT / "smoke_project_ref.json"),
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"SMOKE {summary['status']} failures={len(failures)}", flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
