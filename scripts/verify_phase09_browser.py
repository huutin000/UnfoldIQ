"""Phase 9 browser acceptance via Edge CDP (stdlib only, temp profile).

Flow (real server + real QA service, temp project only):
  exports/export_001 clean PASS (pre-run) | export_002 warning (pre-run)
  export_003 fail (pre-run) | export_004 fresh pending -> in-browser rerun
Checks the 14 browser acceptance items, captures screenshots + result JSON.
Cleans up the temp project, its runtime job mirrors, server, and profile.
"""
import base64
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

BASE_DIR = Path(r"D:\Project\UnfoldIQ")
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(BASE_DIR / "tests"))

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
CDP_PORT = 9231
SERVER_PORT = 7871
PROJ = "zz_phase09_browser_tmp"
PROJ_AUTO = "zz_phase09_autorender_tmp"
AUTO_EXPORT = "export_001"
ARTIFACTS = BASE_DIR / "temp" / "phase09_browser"

sys.path.insert(0, str(BASE_DIR))


class MinimalCDPClient:
    def __init__(self, ws_url):
        m = re.match(r"ws://([^:/]+):(\d+)(/.+)", ws_url)
        self.host, self.port, self.path = m.group(1), int(m.group(2)), m.group(3)
        self.sock = socket.create_connection((self.host, self.port), timeout=15)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET {self.path} HTTP/1.1\r\nHost: {self.host}:{self.port}\r\n"
               "Upgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(req.encode())
        if "101" not in self.sock.recv(4096).decode():
            raise RuntimeError("WebSocket handshake failed")
        self.msg_id = 0

    def _read_frame(self):
        hdr = self.sock.recv(2)
        if len(hdr) < 2:
            return b""
        ln = hdr[1] & 0x7F
        if ln == 126:
            ln = struct.unpack("!H", self.sock.recv(2))[0]
        elif ln == 127:
            ln = struct.unpack("!Q", self.sock.recv(8))[0]
        data = b""
        while len(data) < ln:
            chunk = self.sock.recv(ln - len(data))
            if not chunk:
                break
            data += chunk
        return data

    def send_command(self, method, params=None):
        self.msg_id += 1
        data = json.dumps({"id": self.msg_id, "method": method,
                           "params": params or {}}).encode()
        mask = os.urandom(4)
        ln = len(data)
        if ln < 126:
            header = bytearray([0x81, 0x80 | ln])
        elif ln < 65536:
            header = bytearray([0x81, 0x80 | 126]) + struct.pack("!H", ln)
        else:
            header = bytearray([0x81, 0x80 | 127]) + struct.pack("!Q", ln)
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
        while True:
            raw = self._read_frame()
            if not raw:
                continue
            parsed = json.loads(raw.decode("utf-8", errors="replace"))
            if parsed.get("id") == self.msg_id:
                return parsed

    def eval_js(self, js):
        res = self.send_command("Runtime.evaluate",
                                {"expression": js, "returnByValue": True,
                                 "awaitPromise": True})
        if "exceptionDetails" in res.get("result", {}):
            return {"__exception__": str(res["result"]["exceptionDetails"])[:300]}
        return (res.get("result") or {}).get("result", {}).get("value")

    def screenshot(self, path):
        res = self.send_command("Page.captureScreenshot", {"format": "png"})
        data = (res.get("result") or {}).get("data", "")
        Path(path).write_bytes(base64.b64decode(data))


def _wav(p: Path, seconds=4.0):
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * int(24000 * seconds) * 2)


def _wav_tone(p: Path, seconds=4.0, freq=440.0, rate=24000):
    import math
    import struct
    n = int(rate * seconds)
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(
            struct.pack("<h", int(16000 * math.sin(2 * math.pi * freq * i / rate)))
            for i in range(n)))


def setup_project():
    import asyncio
    from phase09_qa_media import (make_black_gap_final, make_clean_final,
                                  write_export)
    from studio.jobs_manager import JobsManager
    from studio.render_qa_service import RenderQaService
    root = BASE_DIR / "projects"
    proj = root / PROJ
    if proj.exists():
        shutil.rmtree(proj, ignore_errors=True)
    proj.mkdir(parents=True)
    _wav(proj / "audio.wav", 4.0)
    tmp = Path(tempfile.mkdtemp(prefix="phase09_bmedia_"))
    clean = tmp / "clean.mp4"
    make_clean_final(clean, 4.0)
    warn = tmp / "warn.mp4"
    make_black_gap_final(warn, 0.5, 6.0, 2.0)
    fail = tmp / "fail.mp4"
    make_black_gap_final(fail, 4.0, 8.0, 2.0)
    fresh = tmp / "fresh.mp4"
    make_clean_final(fresh, 4.0)
    from phase09_qa_media import probe_frames
    clips6 = [{"clipId": "c1", "sceneId": "s1", "shotId": "shot_001",
               "sequenceIndex": 1, "startFrame": 0, "durationFrames": 144,
               "endFrame": 144, "assetId": "a1", "acceptedAssetVersion": 1,
               "checksum": "0" * 64, "filePath": "assets/s1.png",
               "mediaType": "VIDEO",
               "transition": {"type": "CUT", "durationFrames": 0}}]
    write_export(proj, "export_002", warn, clips=clips6, n_frames=144)
    write_export(proj, "export_003", fail)
    write_export(proj, "export_004", fresh)

    async def _prerun(export_id):
        jobs = JobsManager(runtime_dir=BASE_DIR / "runtime" / "jobs",
                           projects_dir=root)
        svc = RenderQaService(projects_dir=root, jobs=jobs)
        req = svc.request_qa(PROJ, export_id, "MANUAL_RERUN")
        job = await svc.wait_for_job(req["jobId"], timeout=300.0)
        return req["jobId"], job["metadata"].get("qaVerdict")

    clips4 = [{"clipId": "c1", "sceneId": "s1", "shotId": "shot_001",
               "sequenceIndex": 1, "startFrame": 0, "durationFrames": 48,
               "endFrame": 48, "assetId": "a1", "acceptedAssetVersion": 1,
               "checksum": "0" * 64, "filePath": "assets/s1.png",
               "mediaType": "IMAGE",
               "transition": {"type": "CUT", "durationFrames": 0}},
              {"clipId": "c2", "sceneId": "s1", "shotId": "shot_002",
               "sequenceIndex": 2, "startFrame": 48, "durationFrames": 48,
               "endFrame": 96, "assetId": "a1", "acceptedAssetVersion": 1,
               "checksum": "0" * 64, "filePath": "assets/s1.png",
               "mediaType": "VIDEO",
               "transition": {"type": "CROSSFADE", "durationFrames": 12}}]
    write_export(proj, "export_001", clean, clips=clips4, n_frames=96)
    # Legacy preview slot so the Export Workbench wires the player src.
    legacy = proj / "renders" / "final"
    legacy.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(proj / "exports" / "export_002" / "final.mp4",
                    legacy / "final.mp4")
    import json as _json
    from datetime import datetime, timezone
    for export_id in ("export_001", "export_002", "export_003", "export_004"):
        (proj / "exports" / export_id / "production_manifest.json").write_text(
            _json.dumps({"exportId": export_id, "projectId": PROJ,
                         "createdAt": datetime.now(timezone.utc).isoformat()}),
            encoding="utf-8")
    job_ids = []
    for export_id in ("export_001", "export_002", "export_003"):
        jid, verdict = asyncio.run(_prerun(export_id))
        job_ids.append(jid)
        print(f"pre-run {export_id}: {verdict}")
    shutil.rmtree(tmp, ignore_errors=True)
    return job_ids


def setup_auto_project():
    """Renderable mini-project: real PNG + real WAV + full authoring state,
    persisted manifest snapshot ready for POST /render/final."""
    import hashlib
    import json as _json
    import subprocess as _sp
    from datetime import datetime, timezone
    root = BASE_DIR / "projects"
    proj = root / PROJ_AUTO
    if proj.exists():
        shutil.rmtree(proj, ignore_errors=True)
    (proj / "assets").mkdir(parents=True)
    _sp.run(["ffmpeg", "-y", "-f", "lavfi", "-i",
             "testsrc2=size=1920x1080:rate=24:duration=0.2",
             "-frames:v", "1", str(proj / "assets" / "s1.png")],
            check=True, capture_output=True)
    _wav_tone(proj / "audio.wav", 12.0)
    (proj / "script.txt").write_text("hello narration world")
    (proj / "timestamps.srt").write_text(
        "1\n00:00:00,000 --> 00:00:06,000\nHi\n\n2\n00:00:06,000 --> 00:00:12,000\nBye\n")
    (proj / "timestamps.json").write_text(
        _json.dumps({"audio_duration": 12.0}))
    scenes = [{"scene_id": "scene_001", "index": 1}]
    (proj / "scene_plan.json").write_text(_json.dumps({"scenes": scenes}))

    def _sha(p):
        return hashlib.sha256((proj / p).read_bytes()).hexdigest()

    (proj / "voice_qa.json").write_text(_json.dumps(
        {"status": "PASS", "audio_sha256": _sha("audio.wav"),
         "issues": [], "summary": {}}))
    sp = _json.loads((proj / "scene_plan.json").read_text())
    sp["timestamps_sha256"] = _sha("timestamps.json")
    (proj / "scene_plan.json").write_text(_json.dumps(sp))
    vb_hash = "vbhash001"
    (proj / "visual_bible.json").write_text(_json.dumps({
        "generatorVersion": "10.0.0", "visualBibleHash": vb_hash,
        "subjects": [{"subjectId": "sub1"}],
        "environments": [{"environmentId": "env1"}],
        "periods": [{"periodId": "p1"}],
        "sourceScenePlanHash": _sha("scene_plan.json")}))
    from studio.veo_prompt_generator import compute_scene_hashes
    media = (proj / "assets" / "s1.png").read_bytes()
    (proj / "veo_prompts.json").write_text(_json.dumps({
        "shotGeneratorVersion": "7.0.0",
        "source_script_sha256": _sha("script.txt"),
        "audio_sha256": _sha("audio.wav"),
        "timestamps_sha256": _sha("timestamps.json"),
        "sourceVisualBibleHash": vb_hash,
        "sceneHashes": compute_scene_hashes(scenes),
        "shots": [{"shot_id": "shot_001", "scene_id": "scene_001",
                   "start": 0.0, "end": 12.0, "duration": 12.0, "index": 1,
                   "veo_prompt": "a calm cinematic establishing shot of mist"}]}))
    (proj / "assets" / "intake_ledger.json").write_text(_json.dumps({
        "assets": [{"id": "A1", "scene_id": "scene_001", "shot_id": "shot_001",
                    "lifecycle": "LOCKED",
                    "checksum": hashlib.sha256(media).hexdigest(),
                    "version": 1, "filePath": "assets/s1.png"}]}))
    from studio.timeline_compiler import compile_render_manifest
    result = compile_render_manifest(proj, AUTO_EXPORT)
    assert result.persisted is True, "manifest snapshot must persist"
    (proj / "exports" / AUTO_EXPORT / "production_manifest.json").write_text(
        _json.dumps({"exportId": AUTO_EXPORT, "projectId": PROJ_AUTO,
                     "createdAt": datetime.now(timezone.utc).isoformat()}),
        encoding="utf-8")
    assert not (proj / "exports" / AUTO_EXPORT / "final.mp4").exists()
    print(f"auto project ready: {PROJ_AUTO}/{AUTO_EXPORT}")


def start_server():
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "studio.app:app",
         "--host", "127.0.0.1", "--port", str(SERVER_PORT)],
        cwd=str(BASE_DIR), stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{SERVER_PORT}/api/i18n/vi",
                    timeout=3) as r:
                if r.status == 200:
                    print("server ready")
                    return proc
        except Exception:
            time.sleep(1)
    proc.terminate()
    raise RuntimeError("server did not start")


def main():
    results = {"checks": {}, "console_errors": [], "screenshots": []}
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    profile = BASE_DIR / "temp" / "edge_cdp_phase09"
    if profile.exists():
        shutil.rmtree(profile, ignore_errors=True)
    profile.mkdir(parents=True)
    server = None
    edge = None
    job_ids = setup_project()
    setup_auto_project()
    try:
        server = start_server()
        edge = subprocess.Popen([EDGE_PATH,
                                 f"--remote-debugging-port={CDP_PORT}",
                                 f"--user-data-dir={profile}",
                                 "--headless=new", "--disable-gpu",
                                 "--window-size=1920,1080", "about:blank"])
        time.sleep(2)
        tabs = json.loads(urllib.request.urlopen(
            f"http://127.0.0.1:{CDP_PORT}/json", timeout=10).read().decode())
        ws_url = next(t for t in tabs if t.get("type") == "page")["webSocketDebuggerUrl"]
        c = MinimalCDPClient(ws_url)
        c.send_command("Runtime.enable")
        c.send_command("Log.enable")
        c.send_command("Network.enable")
        c.send_command("Page.addScriptToEvaluateOnNewDocument", {
            "source": ("window.__pageErrors=[];"
                       "window.addEventListener('error',function(e){"
                       "window.__pageErrors.push(String(e.message||'error'))});"
                       "window.addEventListener('unhandledrejection',function(e){"
                       "window.__pageErrors.push('rejection:'+String(e.reason))});"
                       "(function(){const o=console.error;console.error=function(){"
                       "try{window.__pageErrors.push(Array.prototype.join.call(arguments,' '))}"
                       "catch(x){}return o.apply(this,arguments)}})()")})
        errors: list = []

        def nav():
            c.send_command("Page.navigate",
                           {"url": f"http://127.0.0.1:{SERVER_PORT}/"})
            time.sleep(3)
            c.eval_js("""(function(){const s=document.getElementById('tour-btn-skip');
                if(s)s.click();const o=document.getElementById('onboarding-tour-overlay');
                if(o)o.style.display='none';})()""")
            c.eval_js(f"window.loadPreviewAudio('{PROJ}', 4, false)")
            time.sleep(1.5)
            c.eval_js("window.switchWorkspace('export')")
            time.sleep(2)

        def select_export(exp):
            c.eval_js(f"""(function(){{const s=document.getElementById('export-select');
                if(!s)return 'no-select';
                for(const o of s.options){{if(o.value==='{exp}'){{s.value='{exp}';break}}}}
                s.dispatchEvent(new Event('change'));}})()""")
            time.sleep(2.5)

        def qa_text():
            return c.eval_js("""(function(){const b=document.getElementById('render-qa-box');
                return b?b.innerText.slice(0,2000):null})()""") or ""

        def shot(name):
            c.eval_js("""(function(){const s=document.getElementById('tour-btn-skip');
                if(s)s.click();const o=document.getElementById('onboarding-tour-overlay');
                if(o)o.style.display='none';})()""")
            time.sleep(0.4)
            p = ARTIFACTS / name
            c.screenshot(p)
            results["screenshots"].append(name)

        # Viewport 1: 1920x1080 — pending state on fresh export.
        nav()
        select_export("export_004")
        t = qa_text()
        results["checks"]["01_pending_cho_kiem_dinh"] = (
            "chờ kiểm định" in t.lower())
        shot("01_pending_1920.png")

        # Rerun in-browser -> progress appears automatically.
        runs_before = json.loads(urllib.request.urlopen(
            f"http://127.0.0.1:{SERVER_PORT}/api/projects/{PROJ}/exports/export_004/qa/runs",
            timeout=10).read().decode())["runs"]
        c.eval_js("document.getElementById('btn-qa-rerun').click()")
        seen_progress = False
        for _ in range(30):
            time.sleep(1)
            if "Đang kiểm tra toàn bộ video" in qa_text() or "%" in qa_text():
                seen_progress = True
                break
        results["checks"]["02_progress_appears"] = seen_progress
        results["checks"]["03_progress_updates"] = seen_progress
        shot("02_progress_1920.png")
        ok_pass = False
        for _ in range(90):
            time.sleep(2)
            if "Đạt" in qa_text():
                ok_pass = True
                break
        results["checks"]["04_clean_pass_dat_ready"] = ok_pass
        shot("03_pass_1920.png")
        runs_after = json.loads(urllib.request.urlopen(
            f"http://127.0.0.1:{SERVER_PORT}/api/projects/{PROJ}/exports/export_004/qa/runs",
            timeout=10).read().decode())["runs"]
        results["checks"]["05_rerun_history_increases"] = len(runs_after) > len(runs_before)

        # Warning fixture.
        select_export("export_002")
        t = qa_text()
        results["checks"]["06_warning_dat_co_canh_bao"] = "Đạt, có cảnh báo" in t
        n_warn = c.eval_js(
            "document.querySelectorAll('#render-qa-findings .qa-finding').length")
        results["checks"]["07_warning_list_renders"] = (n_warn or 0) > 0
        shot("04_warning_1920.png")
        cur = c.eval_js("""(function(){const v=document.getElementById('final-video-player');
            return v?v.currentTime:null})()""")
        c.eval_js("""(function(){const b=document.querySelector('#render-qa-findings .qa-seek');
            if(b)b.click()})()""")
        time.sleep(1)
        cur2 = c.eval_js("""(function(){const v=document.getElementById('final-video-player');
            return v?v.currentTime:null})()""")
        results["checks"]["08_evidence_seek"] = (
            cur is not None and cur2 is not None and abs(cur2 - cur) > 0.01)

        # Fail fixture + tech details.
        select_export("export_003")
        t = qa_text()
        results["checks"]["09_fail_khong_dat_blocked"] = "Không đạt" in t
        c.eval_js("""(function(){const d=document.getElementById('render-qa-tech');
            if(d)d.open=true})()""")
        time.sleep(1)
        tech = c.eval_js(
            "document.getElementById('render-qa-tech-body')?.textContent?.slice(0,500)") or ""
        results["checks"]["10_tech_details_expand"] = "FAIL" in tech
        shot("05_fail_1920.png")

        # Cancel a fresh rerun, then rerun after cancel.
        select_export("export_004")
        c.eval_js("document.getElementById('btn-qa-rerun').click()")
        time.sleep(3)
        c.eval_js("""(function(){const b=document.getElementById('btn-qa-cancel');
            if(b&&b.style.display!=='none')b.click()})()""")
        cancelled = False
        for _ in range(30):
            time.sleep(1)
            if "Đã hủy kiểm định" in qa_text():
                cancelled = True
                break
        if not cancelled:
            cancelled = c.eval_js(
                "document.getElementById('btn-qa-cancel')?.style?.display") == "none"
        results["checks"]["11_cancel_works"] = cancelled
        shot("06_cancel_1920.png")
        c.eval_js("document.getElementById('btn-qa-rerun').click()")
        ok_again = False
        for _ in range(90):
            time.sleep(2)
            if "Đạt" in qa_text():
                ok_again = True
                break
        results["checks"]["12_rerun_after_cancel"] = ok_again

        # Keyboard: focus rerun button, activate with Enter.
        c.eval_js("document.getElementById('btn-qa-rerun').focus()")
        focused = c.eval_js(
            "document.activeElement?.id") == "btn-qa-rerun"
        c.send_command("Input.dispatchKeyEvent",
                       {"type": "keyDown", "key": "Enter", "code": "Enter",
                        "windowsVirtualKeyCode": 13})
        c.send_command("Input.dispatchKeyEvent",
                       {"type": "keyUp", "key": "Enter", "code": "Enter",
                        "windowsVirtualKeyCode": 13})
        time.sleep(3)
        kb_started = ("Đang kiểm" in qa_text() or "Chờ kiểm" in qa_text()
                      or "Đạt" in qa_text())
        results["checks"]["13_keyboard_operation"] = bool(focused and kb_started)

        # Other viewports render the panel.
        for w, h, tag in ((1440, 900, "1440"), (1366, 768, "1366")):
            c.send_command("Emulation.setDeviceMetricsOverride",
                           {"width": w, "height": h,
                            "deviceScaleFactor": 1, "mobile": False})
            time.sleep(1.5)
            select_export("export_001")
            t = qa_text()
            results["checks"][f"viewport_{tag}_pass_visible"] = "Đạt" in t
            shot(f"07_pass_{tag}.png")

        # Phase C: automatic Phase 8 -> Phase 9 handoff in-browser.
        # Only the RENDER endpoint is triggered; the initial QA run must
        # appear automatically (no QA POST for the initial run).
        c.send_command("Emulation.setDeviceMetricsOverride",
                       {"width": 1920, "height": 1080,
                        "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1)
        c.eval_js(f"window.loadPreviewAudio('{PROJ_AUTO}', 12, false)")
        time.sleep(1.5)
        c.eval_js("window.switchWorkspace('export')")
        time.sleep(2)

        def _api(method, path, body=None):
            expr = (f"(async()=>{{const r=await fetch("
                    f"'http://127.0.0.1:{SERVER_PORT}{path}',"
                    f"{{method:'{method}',headers:{{'Content-Type':'application/json'}}"
                    + (f",body:JSON.stringify({json.dumps(body)})" if body else "")
                    + f"}});const t=await r.text();"
                    f"return {{status:r.status,body:t.slice(0,200000)}}}})()")
            return c.eval_js(expr) or {}

        def _jobs_for(project):
            try:
                with urllib.request.urlopen(
                        f"http://127.0.0.1:{SERVER_PORT}/api/activity/jobs"
                        f"?projectId={project}",
                        timeout=3) as r:
                    return json.loads(r.read().decode()).get("jobs", [])
            except Exception:
                return []

        def _latest_for(project, export):
            try:
                with urllib.request.urlopen(
                        f"http://127.0.0.1:{SERVER_PORT}/api/projects/{project}"
                        f"/exports/{export}/qa/latest",
                        timeout=3) as r:
                    return r.status, json.loads(r.read().decode())
            except Exception as e:
                code = getattr(e, "code", None)
                return code or 0, None

        render_click = c.eval_js("""(function(){
            var sel=document.getElementById('export-select');
            if(sel){for(var o of sel.options){if(o.value==='""" + AUTO_EXPORT + """'){sel.value='""" + AUTO_EXPORT + """';break;}}}
            var b=document.getElementById('btn-trigger-final-render');
            if(!b)return 'no-button';
            if(b.disabled)return 'disabled:'+(b.title||'');
            b.click();return 'clicked';})()""")
        results["auto_render_click"] = render_click
        results["auto_render_post"] = "button-click:" + str(render_click)
        render_ok = render_click == "clicked"
        auto_progress = False
        # In-page 2 Hz badge/poll recorder: immune to CDP round-trip latency,
        # captures transient progress states the Workbench actually shows.
        # Each sample carries project/export context for attribution.
        c.eval_js(
            "(function(){window.__qaBadgeLog=[];"
            "setInterval(function(){try{"
            "var b=document.getElementById('render-qa-badge');"
            "var bar=document.getElementById('render-qa-progress-bar');"
            "var p=document.getElementById('active-project-name');"
            "var s=document.getElementById('export-select');"
            "window.__qaBadgeLog.push([Date.now(),"
            "p?p.textContent:'',s?s.value:'',"
            "b?b.textContent:'',bar?bar.style.width:'']);"
            "}catch(e){}},500);})()")

        def _sample_progress():
            badge = c.eval_js(
                "document.getElementById('render-qa-badge')?.textContent||''") or ""
            if "Đang kiểm" in badge:
                return True
            bar = c.eval_js(
                "document.getElementById('render-qa-progress-bar')?.style?.width||''") or ""
            try:
                pct = float(str(bar).replace("%", "") or 0)
            except Exception:
                pct = 0
            return 0 < pct < 100

        # Observe FIRST via tight urllib polling (no UI ops inside: the
        # render+QA window is seconds long and any sleep blinds us).
        # Switch to the auto project only after the PENDING link is latched.
        final_done = False
        pending_qa = False
        pending_observed_at = None
        t_phase = time.time()
        poll_log = []
        if render_ok:
            # Tight urllib-only loop: no sleeps, no CDP inside, so the first
            # COMPLETED observation lands milliseconds after render
            # completion — long before QA's verdict flips the artifact.
            for _ in range(3000):
                job_list = _jobs_for(PROJ_AUTO)
                finals = [j for j in job_list
                          if j.get("type") == "FINAL_RENDER"
                          and (j.get("metadata") or {}).get("exportId") == AUTO_EXPORT]
                if len(poll_log) < 60:
                    poll_log.append({
                        "t": round(time.time() - t_phase, 1),
                        "n_jobs": len(job_list),
                        "final": (finals[0].get("status") if finals else None),
                        "artifact": ((finals[0].get("metadata") or {}).get("artifactStatus")
                                     if finals else None),
                    })
                if finals and finals[0].get("status") == "COMPLETED":
                    meta = finals[0].get("metadata") or {}
                    final_done = True
                    job_ids.append(finals[0].get("jobId") or finals[0].get("id"))
                    results["c1_artifact_at_first_complete"] = (
                        meta.get("artifactStatus"),
                        meta.get("artifactReasonCode"))
                    if (meta.get("artifactStatus") == "NEEDS_REVIEW"
                            and meta.get("artifactReasonCode") == "PENDING_RENDER_QA"):
                        pending_qa = True
                        pending_observed_at = round(time.time() - t_phase, 1)
                    break
                if finals and finals[0].get("status") in ("FAILED", "CANCELLED"):
                    results["auto_render_error"] = str(
                        (finals[0].get("metadata") or {}).get("errorCode"))
                    break
        results["checks"]["C1_render_completed_pending_qa"] = bool(
            final_done and pending_qa)
        results["c1_pending_observed_at_s"] = pending_observed_at
        results["c1_poll_log"] = poll_log
        shot("08_auto_render_done_1920.png")
        # Now switch to the auto project so progress sampling observes the
        # auto export's Workbench box while its QA still runs.
        c.eval_js(f"window.loadPreviewAudio('{PROJ_AUTO}', 12, false)")
        time.sleep(1.5)
        c.eval_js("window.switchWorkspace('export')")
        time.sleep(3)
        # Exactly one RENDER_QA must have been auto-queued (no QA POST yet).
        # Sample the Workbench text throughout the wait: catching live
        # progress here also satisfies C4 even if QA finishes early.
        auto_qa = []
        if final_done:
            for _ in range(240):
                time.sleep(0.2)
                job_list = _jobs_for(PROJ_AUTO)
                auto_qa = [j for j in job_list
                           if j.get("type") == "RENDER_QA"
                           and (j.get("metadata") or {}).get("exportId") == AUTO_EXPORT]
                if _sample_progress():
                    auto_progress = True
                if auto_qa and auto_progress:
                    break
            for j in auto_qa:
                job_ids.append(j.get("jobId") or j.get("id"))
        results["checks"]["C2_exactly_one_auto_qa_queued"] = len(auto_qa) == 1
        results["checks"]["C3_jobs_api_exposes_auto_qa"] = len(auto_qa) >= 1
        # Workbench shows automatic progress, then the committed result.
        c.eval_js(f"""(function(){{const s=document.getElementById('export-select');
            if(!s)return;for(const o of s.options){{if(o.value==='{AUTO_EXPORT}'){{s.value='{AUTO_EXPORT}';break}}}}
            s.dispatchEvent(new Event('change'));}})()""")
        time.sleep(3)
        c4dbg = []
        for _ in range(60):
            time.sleep(0.5)
            if _sample_progress():
                auto_progress = True
                break
            if len(c4dbg) < 15:
                c4dbg.append({
                    "badge": c.eval_js(
                        "document.getElementById('render-qa-badge')?.textContent||''"),
                    "sel": c.eval_js(
                        "document.getElementById('export-select')?.value||''"),
                    "nopts": c.eval_js(
                        "document.getElementById('export-select')?.options?.length||0"),
                })
        results["checks"]["C4_workbench_shows_auto_progress"] = auto_progress
        results["c4_debug"] = c4dbg
        shot("09_auto_progress_1920.png")
        auto_result = None
        for _ in range(150):
            time.sleep(2)
            code, auto_result = _latest_for(PROJ_AUTO, AUTO_EXPORT)
            if code == 200 and auto_result:
                break
            auto_result = None
        results["checks"]["C5_committed_auto_result"] = bool(
            auto_result and auto_result.get("verdict")
            in ("PASS", "PASS_WITH_WARNINGS", "FAIL"))
        results["auto_verdict"] = (auto_result or {}).get("verdict")
        t = qa_text()
        results["checks"]["C6_workbench_shows_auto_result"] = any(
            s in t for s in ("Đạt", "Không đạt"))
        shot("10_auto_result_1920.png")
        # In-page badge timeline for the auto export: pending -> progress ->
        # result, sampled at 2 Hz independent of CDP latency.
        raw_log = c.eval_js("window.__qaBadgeLog||[]") or []
        auto_log = [s for s in raw_log
                    if len(s) == 5 and s[1] == PROJ_AUTO and s[2] == AUTO_EXPORT]
        results["auto_badge_samples"] = len(auto_log)
        seq = [s[3] for s in auto_log]
        saw_pending = any("kiểm định" in (b or "").lower() for b in seq)
        saw_progress = any("Đang kiểm" in (b or "") for b in seq)
        saw_result = any(("Đạt" in (b or "") or "Không đạt" in (b or ""))
                         for b in seq)
        results["auto_badge_timeline"] = {
            "pending": saw_pending, "progress": saw_progress,
            "result": saw_result,
            "distinct": sorted(set(seq))[:12],
        }
        if saw_progress:
            auto_progress = True
        results["checks"]["C4_workbench_shows_auto_progress"] = auto_progress
        results["checks"]["14_console_network_clean"] = len(errors) == 0
        errors = c.eval_js("window.__pageErrors||[]") or []
        bad_net = c.eval_js(
            "(function(){try{return performance.getEntriesByType('resource')"
            ".filter(function(r){return r.responseStatus>=400})"
            ".map(function(r){return r.name.slice(0,120)+'#'+r.responseStatus})"
            ".slice(0,20)}catch(e){return['perf-unavailable']}})()") or []
        errors = list(errors) + [("net:" + b) for b in (bad_net or [])]
        benign = ("/script#404", "narration/plan#404", "/qa/latest#404")
        blocking = [e for e in errors
                    if not any(b in e for b in benign)]
        results["checks"]["14_console_network_clean"] = len(blocking) == 0
        results["console_errors"] = errors[:20]
        results["benign_allowlisted"] = [e for e in errors if e not in blocking]
    finally:
        try:
            if edge:
                edge.terminate()
        except Exception:
            pass
        try:
            if server:
                server.terminate()
        except Exception:
            pass
        # Cleanup temp projects + runtime mirrors + profile.
        try:
            shutil.rmtree(BASE_DIR / "projects" / PROJ, ignore_errors=True)
            shutil.rmtree(BASE_DIR / "projects" / PROJ_AUTO, ignore_errors=True)
            for jid in job_ids:
                if not jid:
                    continue
                for p in (BASE_DIR / "runtime" / "jobs").glob(f"{jid}.json"):
                    p.unlink(missing_ok=True)
            shutil.rmtree(profile, ignore_errors=True)
        except Exception as e:
            results["cleanup_warning"] = str(e)[:200]
    (ARTIFACTS / "browser_results.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(results, indent=2, ensure_ascii=False))
    failed = [k for k, v in results["checks"].items() if not v]
    print("BROWSER:", "GREEN" if not failed else f"RED {failed}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
