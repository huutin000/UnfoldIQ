"""Phase 5 CORRECTIVE final evidence closure — headed-Chrome frame-evidence
harness (CDP, NO headless, NO --disable-gpu).

Primary metric: Chrome DevTools compositor frame-presentation evidence from
CDP tracing (NOT requestAnimationFrame):
  presented = Display::FrameDisplayed (compositor-confirmed display;
              fallback: Graphics.Pipeline STEP_SWAP_BUFFERS_ACK chain)
  dropped   = Scheduler::BeginFrameDropped
              + LayerTreeHostImpl::DidNotProduceFrame[kRecoverLatency]
  skipped   = DidNotProduceFrame[kNoDamage] (correctly skipped, NOT drops)
  partial   = PipelineReporter frame_reporter has_high_latency /
              has_missing_content (honest proxy; 0 when absent)
  cross-check only (multi-surface): generic Swap counts
rAF is retained as HISTORICAL supporting metric only (see previous closure
report); it is NOT re-measured and NOT used for any verdict here.

Conditions (>=5 runs each, same browser/machine/viewport/build/input):
  large-virtualized : 579 scenes / 1641 shots, THRESHOLD_GROUPS=200
  large-direct      : same fixture,      THRESHOLD_GROUPS=1000000
  dense-300         : scene_900 x 300 shots (own FPS runs, NOT inferred)

Real wheel input via Input.dispatchMouseEvent (mouseWheel + pointerType).
Temp fixtures only, cleaned up at the end.

Usage:
  python scripts/verify_phase05_frame_evidence.py            # full (15 runs)
  python scripts/verify_phase05_frame_evidence.py --quick   # 2 runs/condition (smoke)
"""
import csv
import datetime
import hashlib
import json
import statistics
import subprocess
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for  # noqa: E402

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP = "http://127.0.0.1:7860"
REF = "2026-09-12_210003_youtube-narration-01"
OUT = Path("temp/phase05_evidence_closure")
PERF = OUT / "performance"
SHOT = PERF / "screenshots"
PROFILE = Path("temp/headed_profile_p5e")
CDP_PORT = 9349
TRACE_CATS = ("devtools.timeline,cc,viz,benchmark,gpu,"
              "disabled-by-default-devtools.timeline.frame")

BIG = "_p5e_big1500"
DENSE = "_p5e_dense300"

PRESENT_FALLBACK_STEPS = {"STEP_SWAP_BUFFERS_ACK", "STEP_FINISH_BUFFER_SWAP"}


# ---------------------------------------------------------------- parser
def parse_frame_evidence(events):
    """Classify headed-trace events into presented / dropped / skipped /
    partial frame evidence. Pure function (unit-tested). Never fabricates:
    signals that are absent are reported as 0 with the searched names."""
    presented_ts = sorted(
        e["ts"] for e in events
        if e.get("name") == "Display::FrameDisplayed"
        and isinstance(e.get("ts"), (int, float)))
    signal = "Display::FrameDisplayed"
    if not presented_ts:
        presented_ts = sorted(
            e["ts"] for e in events
            if e.get("name") == "Graphics.Pipeline"
            and isinstance(e.get("ts"), (int, float))
            and ((e.get("args", {}) or {}).get("chrome_graphics_pipeline", {}) or {}).get("step")
            in PRESENT_FALLBACK_STEPS)
        signal = "Graphics.Pipeline:STEP_SWAP_BUFFERS_ACK|FINISH_BUFFER_SWAP(fallback)"

    def count(name):
        return sum(1 for e in events if e.get("name") == name)

    recover = nodamage = 0
    for e in events:
        if e.get("name") == "LayerTreeHostImpl::DidNotProduceFrame":
            r = str(((e.get("args", {}) or {}).get("FrameSkippedReason")))
            if r == "kRecoverLatency":
                recover += 1
            elif r == "kNoDamage":
                nodamage += 1
    partial = 0
    pr_total = 0
    for e in events:
        if e.get("name") == "PipelineReporter":
            fr = (e.get("args", {}) or {}).get("frame_reporter")
            if isinstance(fr, dict):
                pr_total += 1
                if fr.get("has_high_latency") or fr.get("has_missing_content"):
                    partial += 1
    wheel_ts, wheel_durs_ms = [], []
    for e in events:
        if e.get("name") == "InputLatency::MouseWheel":
            if isinstance(e.get("ts"), (int, float)):
                wheel_ts.append(e["ts"])
            if isinstance(e.get("dur"), (int, float)):
                wheel_durs_ms.append(round(e["dur"] / 1000, 3))
    wheel_ts.sort()
    intervals = Counter()
    for e in events:
        if e.get("name") == "Scheduler::BeginFrame":
            try:
                iv = ((e.get("args", {}) or {}).get("args", {}) or {}).get("interval_us")
            except Exception:
                iv = None
            if isinstance(iv, (int, float)) and iv > 0:
                intervals[round(iv)] += 1
    vsync_us = intervals.most_common(1)[0][0] if intervals else None

    def pct(data, q):
        if not data:
            return None
        s = sorted(data)
        return s[min(len(s) - 1, int(len(s) * q))]

    gaps = [(b - a) / 1000 for a, b in zip(presented_ts, presented_ts[1:])
            if b > a] if len(presented_ts) >= 2 else []
    peak_1s = 0
    if presented_ts:
        lo = 0
        for hi in range(len(presented_ts)):
            while presented_ts[hi] - presented_ts[lo] > 1_000_000:
                lo += 1
            peak_1s = max(peak_1s, hi - lo + 1)
    return {
        "presented_signal": signal,
        "presented_count": len(presented_ts),
        "presented_ts_us": presented_ts,
        "presented_gap_p50_ms": round(statistics.median(gaps), 2) if gaps else None,
        "presented_gap_p95_ms": pct(gaps, 0.95),
        "presented_gap_max_ms": round(max(gaps), 2) if gaps else None,
        "presented_long_over_25ms": sum(1 for g in gaps if g > 25),
        "presented_long_over_50ms": sum(1 for g in gaps if g > 50),
        "presented_peak_1s": peak_1s,
        "dropped_beginframe_dropped": count("Scheduler::BeginFrameDropped"),
        "dropped_recover_latency": recover,
        "dropped_total": count("Scheduler::BeginFrameDropped") + recover,
        "skipped_no_damage": nodamage,
        "skipped_early_out_no_updates": count("EarlyOut_NoUpdates"),
        "partial_high_latency_or_missing": partial,
        "pipelinereporter_frames_seen": pr_total,
        "beginframes_devtools": count("BeginFrame"),
        "beginframes_viz_onbeginframe": count("ExternalBeginFrameSource::OnBeginFrame"),
        "anim_presentation": count("AnimationFrame::Presentation"),
        "swap_generic_crosscheck": count("Swap"),
        "wheel_trace_events": len(wheel_ts),
        "wheel_latency_p50_ms": round(statistics.median(wheel_durs_ms), 3) if wheel_durs_ms else None,
        "wheel_latency_p95_ms": pct(wheel_durs_ms, 0.95),
        "vsync_interval_us": vsync_us,
        "vsync_hz": round(1_000_000 / vsync_us, 1) if vsync_us else None,
    }


def fps_in_window(presented_ts_us, t0_us, t1_us):
    n = sum(1 for t in presented_ts_us if t0_us <= t <= t1_us)
    dur_s = max((t1_us - t0_us) / 1_000_000, 1e-6)
    return round(n / dur_s, 1), n, round(dur_s, 2)


# ---------------------------------------------------------------- harness
def start_trace(cdpTrace):
    cdpTrace.call("Tracing.start", {"categories": TRACE_CATS,
                                    "transferMode": "ReturnAsStream",
                                    "streamCompression": "none"})


def stop_trace_events(cdpTrace):
    cdpTrace.call("Tracing.end")
    stream = None
    cdpTrace.ws.socket.settimeout(20)
    try:
        while True:
            try:
                raw = cdpTrace.ws.recv(timeout=15)
            except Exception:
                break
            m = json.loads(raw)
            if m.get("method") == "Tracing.tracingComplete":
                stream = m.get("params", {}).get("stream")
                break
    finally:
        cdpTrace.ws.socket.settimeout(60)
    events = []
    if stream:
        parts = []
        while True:
            r = cdpTrace.call("IO.read", {"handle": stream}, timeout=60)
            if r.get("data"):
                parts.append(r["data"])
            if r.get("eof"):
                break
        cdpTrace.call("IO.close", {"handle": stream})
        try:
            events = json.loads("".join(parts)).get("traceEvents", [])
        except Exception as ex:
            print(f"  [trace parse failed: {str(ex)[:150]}]", flush=True)
    return events


def file_hash(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()[:16]


def main():
    quick = "--quick" in sys.argv
    n_runs = 2 if quick else 5
    PERF.mkdir(parents=True, exist_ok=True)
    SHOT.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)

    generated_at = datetime.datetime.now().astimezone().isoformat()

    # ---- fixtures (temp-only) ----
    import shutil
    for name, script, arg in ((BIG, "scripts/make_large_fixture.py", "500"),
                              (DENSE, "scripts/make_dense_fixture.py", "300")):
        dst = Path("projects") / name
        shutil.rmtree(dst, ignore_errors=True)
        r = subprocess.run([sys.executable, script, name, arg], capture_output=True,
                           text=True, timeout=600)
        assert r.returncode == 0, r.stderr[-2000:]
        print(r.stdout.strip(), flush=True)

    # ---- data integrity: before ----
    refdir = Path("projects") / REF
    hash_files = ["veo_prompts.json", "scene_plan.json", "visual_bible.json",
                  "image_prompts.json", "timestamps.json", "script.txt",
                  "audio.wav", "settings.json", "state.db"]
    integrity_before = {f: file_hash(refdir / f) for f in hash_files}

    # ---- server ----
    import socket
    srv, started = None, False
    if socket.socket().connect_ex(("127.0.0.1", 7860)) != 0:
        srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "studio.app:app",
                                "--host", "127.0.0.1", "--port", "7860"],
                               cwd=str(Path(__file__).resolve().parents[1]),
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(40):
            time.sleep(1)
            if socket.socket().connect_ex(("127.0.0.1", 7860)) == 0:
                break
        started = True

    chrome = subprocess.Popen([CHROME, f"--remote-debugging-port={CDP_PORT}",
                               f"--user-data-dir={PROFILE.resolve()}",
                               "--no-first-run", "--no-default-browser-check",
                               "--window-size=1440,900", "about:blank"],
                              stderr=subprocess.DEVNULL)
    all_runs = []
    render_metrics = {}
    dense_functional = {}
    palette = {}
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
        PAGE_WS = pt["webSocketDebuggerUrl"]
        cdp = CDP(PAGE_WS)
        cdpWheel = CDP(PAGE_WS)
        cdpTrace = CDP(PAGE_WS)
        cdp.call("Page.enable"); cdp.call("Runtime.enable")
        cdp.call("Log.enable"); cdp.call("Network.enable")
        ua = cdp.evaluate("navigator.userAgent")
        bver = json.loads(urllib.request.urlopen(
            f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=5).read())
        # browser-level GPU evidence
        bcdp = CDP(bver["webSocketDebuggerUrl"])
        sysinfo = bcdp.call("SystemInfo.getInfo", timeout=20).get("gpu", {})
        bcdp.ws.close()
        env = {
            "headed": True,
            "no_headless_flag": True,
            "no_disable_gpu_flag": True,
            "chrome": bver.get("Browser", ""),
            "userAgent": ua,
            "os": "Microsoft Windows 11 Home Single Language, 10.0.26200",
            "gpu_compositing": (sysinfo.get("featureStatus", {}) or {}).get("gpu_compositing"),
            "rasterization": (sysinfo.get("featureStatus", {}) or {}).get("rasterization"),
            "devices": [(d.get("vendorString"), d.get("deviceString"))
                        for d in sysinfo.get("devices", [])][:3],
            "viewport": [1440, 900],
            "devicePixelRatio": cdp.evaluate("window.devicePixelRatio"),
            "generated_at": generated_at,
        }
        print("GPU:", env["gpu_compositing"], env["devices"], flush=True)

        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E = cdp.evaluate

        conditions = [
            ("large-virtualized", BIG, 200),
            ("large-direct", BIG, 1000000),
            ("dense-300", DENSE, 200),
        ]
        for cond, proj, thr in conditions:
            E(f"window.loadPreviewAudio('{proj}',665.64,false)")
            assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
            E("""(() => { const b = Array.from(document.querySelectorAll('button'))
              .find(x => (x.innerText||'').includes('Khám phá sau')); if (b) b.click(); })()""")
            time.sleep(0.8)
            E("window.switchWorkspace('scenes')")
            assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
            time.sleep(1.0)
            E("""(() => { const a = document.getElementById('audio-player');
              if (a) { try { a.pause(); } catch (e) {} a.removeAttribute('src'); a.load(); } })()""")
            time.sleep(1.0)
            # preselect first available shot (stable ID, fixture-agnostic)
            pre = E("(() => { const b = document.querySelector('[data-action=select-shot]');"
                    " return b ? [b.dataset.shotId, b.dataset.sceneId] : null; })()")
            assert pre, f"no shot button in {proj}"
            E(f"window.selectVisualShot('{pre[0]}','{pre[1]}')")
            time.sleep(1.0)
            E(f"window.UQVirtualList.THRESHOLD_GROUPS = {thr}")
            E("window.renderVisualSceneNavigator()")
            time.sleep(1.0)
            if cond == "dense-300":
                # expand scene_900 so all 300 shot buttons mount (matches
                # previous closure methodology: 383 rows / 80 groups scale)
                E("window.selectVisualShot('shot_d001','scene_900')")
                time.sleep(1.0)
            # render cost + DOM boundedness (per condition)
            samples = []
            for _ in range(11):
                samples.append(E("(() => { const t0 = performance.now();"
                                 " window.renderVisualSceneNavigator();"
                                 " return performance.now() - t0; })()"))
            samples.sort()
            render_metrics[cond] = {
                "render_p50_ms": round(statistics.median(samples), 2),
                "render_p95_ms": round(samples[min(len(samples) - 1, int(len(samples) * 0.95))], 2),
                "groups": E("document.querySelectorAll('#sp-rows-container .visual-scene-group').length"),
                "dom_nodes": E("document.getElementById('sp-rows-container').querySelectorAll('*').length"),
                "buttons": E("document.querySelectorAll('#sp-rows-container button').length"),
                "fixture": proj, "threshold": thr,
            }
            print(cond, render_metrics[cond], flush=True)
            for run in range(n_runs):
                E("document.getElementById('sp-rows-container').scrollTop = 0")
                time.sleep(0.5)
                start_trace(cdpTrace)
                wall0 = time.time()
                box = cdpWheel.evaluate("(() => { const r = document.getElementById('sp-rows-container').getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()")
                dropped_inputs = 0

                def wheel(dy):
                    nonlocal dropped_inputs
                    try:
                        cdpWheel.call("Input.dispatchMouseEvent", {
                            "type": "mouseWheel", "x": box[0], "y": box[1],
                            "deltaX": 0, "deltaY": dy, "pointerType": "mouse"}, timeout=12)
                    except Exception:
                        dropped_inputs += 1

                for _ in range(10):
                    wheel(-700)
                    time.sleep(0.25)
                for _ in range(6):
                    wheel(700)
                    time.sleep(0.25)
                wall1 = time.time()
                events = stop_trace_events(cdpTrace)
                print(f"  [{cond} run{run + 1}: trace events={len(events)}]", flush=True)
                fe = parse_frame_evidence(events)
                wheel_ts = sorted(e["ts"] for e in events
                                  if e.get("name") == "InputLatency::MouseWheel"
                                  and isinstance(e.get("ts"), (int, float)))
                wall_s = round(wall1 - wall0, 2)
                pres_ts = fe.pop("presented_ts_us")
                fps_window, n_win, _ = fps_in_window(pres_ts, -1, 10 ** 18)
                # active fast-scroll window in trace clock
                if wheel_ts:
                    a0, a1 = wheel_ts[0], wheel_ts[-1] + 400_000
                    fps_active, n_act, act_s = fps_in_window(pres_ts, a0, a1)
                else:
                    fps_active, n_act, act_s = 0.0, 0, 0.0
                rec = {"condition": cond, "run": run + 1, "wall_s": wall_s,
                       "trace_events": len(events),
                       "dropped_wheel_inputs": dropped_inputs,
                       "presented_fps_window": round(n_win / wall_s, 1) if wall_s else 0.0,
                       "presented_count_window": n_win,
                       "presented_fps_active": fps_active,
                       "presented_count_active": n_act,
                       "active_s": act_s,
                       "has_wheel_trace": bool(wheel_ts),
                       "presented_ts_us": pres_ts,
                       "wheel_ts_us": wheel_ts,
                       **fe}
                all_runs.append(rec)
                print(f"  {cond} run{run + 1}: presented={rec['presented_count_window']}"
                      f" fps_win={rec['presented_fps_window']} fps_act={fps_active}"
                      f" peak1s={fe['presented_peak_1s']} dropped={fe['dropped_total']}"
                      f" partial={fe['partial_high_latency_or_missing']}", flush=True)
                (PERF / "frame_runs.json").write_text(
                    json.dumps({"generated_at": generated_at, "runs": all_runs}, indent=1),
                    encoding="utf-8")
                time.sleep(1.0)
            # in-page EventTiming: input-to-paint durations for this condition's
            # flings (supporting input-latency metric; trace MouseWheel events
            # carry no dur, reported NOT AVAILABLE there).
            evt = E("""(() => {
              if (!performance.getEntriesByType) return [];
              return performance.getEntriesByType('event')
                .filter(e => e.name === 'wheel' || e.name === 'scroll')
                .map(e => Math.round(e.duration * 10) / 10).slice(-16);
            })()""")
            render_metrics[cond]["event_timing_wheel_ms"] = evt
            data = cdp.call("Page.captureScreenshot", {"format": "png"})["data"]
            import base64 as _b64
            (SHOT / f"frame-{cond}.png").write_bytes(_b64.b64decode(data))

        E("window.UQVirtualList.THRESHOLD_GROUPS = 200")

        # ---- dense functional (§15) on dense fixture ----
        E(f"window.loadPreviewAudio('{DENSE}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.0)
        E("window.selectVisualShot('shot_d001','scene_900')")
        time.sleep(1.0)
        E("(() => { const b = document.querySelector('[data-action=select-shot][data-shot-id=shot_d001]'); if (b) b.focus(); })()")

        def press(vk, name, code):
            cdpWheel.call("Input.dispatchKeyEvent",
                          {"type": "rawKeyDown", "key": name, "code": code,
                           "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk}, timeout=12)
            cdpWheel.call("Input.dispatchKeyEvent",
                          {"type": "keyUp", "key": name, "code": code,
                           "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk}, timeout=12)
            time.sleep(0.3)

        seq_down = []
        for _ in range(6):
            press(40, "ArrowDown", "ArrowDown")
            seq_down.append(E("(() => document.activeElement?.dataset?.shotId || '?')()"))
        E("(() => { const b = document.querySelector('[data-action=select-shot][data-shot-id=shot_d001]'); if (b) b.focus(); })()")
        time.sleep(0.3)
        press(36, "Home", "Home")  # Home
        home_id = E("(() => document.activeElement?.dataset?.shotId || '?')()")
        press(35, "End", "End")  # End
        end_id = E("(() => document.activeElement?.dataset?.shotId || '?')()")
        press(38, "ArrowUp", "ArrowUp")  # ArrowUp once from End
        up_id = E("(() => document.activeElement?.dataset?.shotId || '?')()")
        press(13, "Enter", "Enter")  # Enter
        time.sleep(1.2)
        enter_card = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,80) || '')()")
        E("window.selectVisualShot('shot_d250','scene_900')")
        time.sleep(0.8)
        sel250 = E("(() => document.querySelector('[data-action=select-shot][data-shot-id=shot_d250]')?.getAttribute('aria-pressed'))()")
        E("document.getElementById('sp-rows-container').scrollTop = 0")
        time.sleep(1.0)
        survives = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.includes('shot_d250'))()")
        E("window.selectVisualShot('shot_d250','scene_900')")
        time.sleep(1.0)
        remount = E("(() => document.querySelector('[data-action=select-shot][data-shot-id=shot_d250]')?.getAttribute('aria-pressed'))()")
        focus_ok = E("(() => { const b = document.querySelector('[data-action=select-shot][data-shot-id=shot_d250]'); if (b) b.focus(); return (document.activeElement === b); })()")
        dense_functional = {"arrow_down_seq": seq_down, "home_id": home_id,
                            "end_id": end_id, "arrow_up_from_end": up_id,
                            "enter_card": enter_card, "sel250_nav": sel250,
                            "sel250_survives": survives, "sel250_remount": remount,
                            "focus_valid": focus_ok}
        (PERF / "dense_functional.json").write_text(
            json.dumps(dense_functional, indent=1, ensure_ascii=False), encoding="utf-8")
        print("DENSE-FUNC:", json.dumps(dense_functional, ensure_ascii=False)[:500], flush=True)

        # ---- palette re-check (reference + dense shot) ----
        # Fresh CDP connection: long trace sessions can leave the main
        # connection socket unusable (WinError 10038 observed); palette
        # checks run on their own socket. Console/network aggregates both.
        cdpP = CDP(PAGE_WS)
        cdpP.call("Page.enable"); cdpP.call("Runtime.enable")
        cdpP.call("Log.enable"); cdpP.call("Network.enable")
        E = cdpP.evaluate

        def safe_drain(c):
            try:
                c.drain()
            except OSError:
                pass
        def ctrl_k():
            for t in ("rawKeyDown", "keyUp"):
                cdpP.call("Input.dispatchKeyEvent", {"type": t, "key": "k", "code": "KeyK",
                                                     "windowsVirtualKeyCode": 75,
                                                     "nativeVirtualKeyCode": 75, "modifiers": 2})
            time.sleep(0.8)

        def key(k, code, vk):
            cdpP.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": k, "code": code,
                                                 "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk})
            cdpP.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": k, "code": code,
                                                 "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk})
            time.sleep(0.4)

        def pal_search(q):
            E(f"(() => {{ const i = document.getElementById('uq-cmd-input'); i.value = '{q}';"
             " i.dispatchEvent(new Event('input', {bubbles:true})); })()")
            time.sleep(0.6)

        E(f"window.loadPreviewAudio('{REF}',665.64,false)")
        assert wait_for(cdpP, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.0)
        checks = {}

        def chk(n, c, x=""):
            checks[n] = {"pass": bool(c), "extra": str(x)[:120]}
            print(("PASS " if c else "FAIL ") + n, str(x)[:100], flush=True)

        ctrl_k()
        chk("palette opens", E("window.UQPalette.isOpen()") is True)
        chk("input focused", E("document.activeElement && document.activeElement.id") == "uq-cmd-input")
        pal_search("shot_001")
        r1 = E("(() => Array.from(document.querySelectorAll('.uq-cmd-item')).map(b=>b.querySelector('.uq-cmd-sub').innerText.split(' ')[0]))()")
        pal_search("shot_00")
        pal_search("shot_001")
        r2 = E("(() => Array.from(document.querySelectorAll('.uq-cmd-item')).map(b=>b.querySelector('.uq-cmd-sub').innerText.split(' ')[0]))()")
        chk("shot search deterministic", r1 == r2 and any("shot_001" in x for x in r1), str((r1 or [])[:2]))
        safe_drain(cdpP)
        before = len([e for e in cdpP.events if e.get("method") == "Network.requestWillBeSent"])
        for ch in ["s", "c", "e", "n", "e"]:
            E(f"(() => {{ const i = document.getElementById('uq-cmd-input'); i.value = i.value + '{ch}';"
             " i.dispatchEvent(new Event('input', {bubbles:true})); })()")
            time.sleep(0.25)
        safe_drain(cdpP)
        after = len([e for e in cdpP.events if e.get("method") == "Network.requestWillBeSent"])
        chk("no network per keystroke", after == before, f"{before}->{after}")
        pal_search("shot_001")
        a0 = E("(() => document.querySelector('.uq-cmd-item.is-active')?.id || '')()")
        key("ArrowDown", "ArrowDown", 40)
        a1 = E("(() => document.querySelector('.uq-cmd-item.is-active')?.id || '')()")
        chk("arrows move active", a0 == "uq-cmd-opt-0" and a1 == "uq-cmd-opt-1", f"{a0}->{a1}")
        key("Enter", "Enter", 13)
        time.sleep(1.5)
        card = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,120) || '')()")
        chk("enter stable-ID shot", "shot_001" in card, card[:60])
        # dense/off-window shot search
        E(f"window.loadPreviewAudio('{DENSE}',665.64,false)")
        assert wait_for(cdpP, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.0)
        ctrl_k()
        pal_search("shot_d250")
        items = E("(() => Array.from(document.querySelectorAll('.uq-cmd-item')).map(b=>b.querySelector('.uq-cmd-sub').innerText.split(' ')[0]))()")
        chk("dense shot searchable", any("shot_d250" in x for x in (items or [])), str((items or [])[:2]))
        key("Enter", "Enter", 13)
        time.sleep(1.5)
        card2 = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,120) || '')()")
        chk("dense enter reveals off-window shot", "shot_d250" in card2, card2[:60])
        E("(() => { const b = document.querySelector('#sp-rows-container button'); if (b) b.focus(); })()")
        time.sleep(0.3)
        inv = E("(() => document.activeElement?.dataset?.sceneId || document.activeElement?.dataset?.shotId || '?')()")
        ctrl_k()
        key("Escape", "Escape", 27)
        time.sleep(0.5)
        back = E("(() => document.activeElement?.dataset?.sceneId || document.activeElement?.dataset?.shotId || '?')()")
        chk("escape + focus return", E("window.UQPalette.isOpen()") is False and back == inv, f"{inv}->{back}")
        palette = checks
        (PERF / "palette_recheck.json").write_text(
            json.dumps(palette, indent=1, ensure_ascii=False), encoding="utf-8")

        # ---- console / network aggregate (both connections) ----
        safe_drain(cdpP)
        safe_drain(cdp)
        allevents = list(cdp.events) + list(cdpP.events)
        cerrs = [e for e in allevents if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in allevents if e.get("method") == "Runtime.exceptionThrown"]
        fails, f5xx = [], []
        for ev in allevents:
            if ev.get("method") == "Network.loadingFailed" and \
                    (ev.get("params", {}) or {}).get("type") not in ("Media",):
                fails.append((ev.get("params", {}) or {}).get("errorText", ""))
            if ev.get("method") == "Network.responseReceived":
                r = (ev.get("params", {}) or {}).get("response", {})
                if str(r.get("url", "")).startswith(APP) and r.get("status", 0) >= 500:
                    f5xx.append(r.get("url", ""))
        (OUT / "console_network.json").write_text(json.dumps(
            {"console_errors": len(cerrs), "unhandled": len(unh),
             "failed_non_media": len(fails), "server_5xx": len(f5xx)}, indent=1))
        print(f"console={len(cerrs)} unhandled={len(unh)} failed={len(fails)} 5xx={len(f5xx)}", flush=True)
        (PERF / "render.json").write_text(json.dumps(render_metrics, indent=1), encoding="utf-8")
        (PERF / "environment.json").write_text(json.dumps(env, indent=1), encoding="utf-8")
        if all_runs:
            with open(PERF / "frame_runs.csv", "w", newline="") as f:
                keys = [k for k in all_runs[0].keys()
                        if k not in ("presented_ts_us", "wheel_ts_us")]
                w = csv.DictWriter(f, fieldnames=keys)
                w.writeheader()
                for r in all_runs:
                    w.writerow({k: v for k, v in r.items()
                                if k not in ("presented_ts_us", "wheel_ts_us")})
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()

    # ---- integrity: after + summary ----
    integrity_after = {f: file_hash(refdir / f) for f in hash_files}
    (OUT / "integrity.json").write_text(json.dumps(
        {"generated_at": generated_at, "before": integrity_before,
         "after": integrity_after,
         "unchanged": integrity_before == integrity_after}, indent=1), encoding="utf-8")
    print("integrity unchanged:", integrity_before == integrity_after, flush=True)

    # ---- summary medians ----
    summary = {"generated_at": generated_at, "runs_per_condition": n_runs, "conditions": {}}
    for cond in ("large-virtualized", "large-direct", "dense-300"):
        rs = [r for r in all_runs if r["condition"] == cond]
        if not rs:
            continue
        med = lambda k: statistics.median([r[k] for r in rs if isinstance(r[k], (int, float))])
        summary["conditions"][cond] = {
            "n": len(rs),
            "presented_fps_window_median": med("presented_fps_window"),
            "presented_fps_window_min": min(r["presented_fps_window"] for r in rs),
            "presented_fps_active_median": med("presented_fps_active"),
            "presented_fps_active_min": min(r["presented_fps_active"] for r in rs),
            "presented_peak_1s_median": med("presented_peak_1s"),
            "dropped_total": sum(r["dropped_total"] for r in rs),
            "partial_total": sum(r["partial_high_latency_or_missing"] for r in rs),
            "skipped_no_damage_total": sum(r["skipped_no_damage"] for r in rs),
            "vsync_hz": rs[0].get("vsync_hz"),
            "presented_signal": rs[0].get("presented_signal"),
        }
    (PERF / "frame_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps(summary, indent=1), flush=True)

    # ---- cleanup temp fixtures ----
    import shutil as _sh
    for name in (BIG, DENSE):
        _sh.rmtree(Path("projects") / name, ignore_errors=True)
    leftover = [p.name for p in Path("projects").glob("_p5e*")]
    print("fixture leftover:", leftover, flush=True)
    (OUT / "cleanup.json").write_text(json.dumps({"leftover": leftover}, indent=1))


if __name__ == "__main__":
    main()
