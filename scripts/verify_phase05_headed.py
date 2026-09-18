"""Phase 5 headed-Chrome FPS + dense-shot verification (CDP, NO headless).

Headed Chrome (GPU compositor on), 1440x900 primary viewport.
Method: CDP tracing (devtools.timeline,cc,viz,benchmark) + in-page rAF
frame clock + REAL wheel input (Input.dispatchMouseEvent mouseWheel).
Primary metric: rAF frame rate cross-validated against trace Swap count
in the same window; frame-time distribution + long frames reported.
5+ runs per mode. Temp fixtures only.
"""
import base64
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for  # noqa: E402

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP = "http://127.0.0.1:7860"
OUT = Path("temp/phase05_final_closure")
SHOT = OUT / "performance" / "screenshots"
PROFILE = Path("temp/headed_profile_p5")
CDP_PORT = 9347
TRACE_CATS = "devtools.timeline,cc,viz,benchmark"

results = {"runs": []}


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name, extra)
    return bool(cond)


def start_trace(cdpTrace):
    cdpTrace.call("Tracing.start", {"categories": TRACE_CATS,
                                    "transferMode": "ReturnAsStream",
                                    "streamCompression": "none"})


def stop_trace(cdp):
    print("  [trace end requested]", flush=True)
    cdp.call("Tracing.end")
    stream = None
    saw = []
    cdp.ws.socket.settimeout(15)
    try:
        while True:
            try:
                raw = cdp.ws.recv(timeout=10)
            except Exception:
                break
            m = json.loads(raw)
            saw.append(m.get("method", m.get("id", "?")))
            if m.get("method") == "Tracing.tracingComplete":
                print(f"  [complete params: {str(m.get('params'))[:300]}]", flush=True)
                stream = m.get("params", {}).get("stream")
                break
    finally:
        cdp.ws.socket.settimeout(60)
    print(f"  [drain saw: {saw[:8]}]", flush=True)
    events = []
    if stream:
        # Accumulate ALL chunks first: IO.read returns arbitrary byte
        # fragments, never complete JSON documents.
        blob_parts = []
        while True:
            r = cdp.call("IO.read", {"handle": stream}, timeout=60)
            chunk = r.get("data", "")
            if chunk:
                blob_parts.append(chunk)
            if r.get("eof"):
                break
        cdp.call("IO.close", {"handle": stream})
        try:
            events = json.loads("".join(blob_parts)).get("traceEvents", [])
        except Exception as e:
            print(f"  [trace parse failed: {str(e)[:120]}]", flush=True)
    return events


def frame_stats_from_trace(events, t0_ms, t1_ms):
    """Count Swap (presentation) events. Trace ts uses a monotonic timebase
    unrelated to wall clock. Swaps cluster during scroll bursts with idle
    gaps, so headline rate uses median inter-arrival plus peak 1s window."""
    import statistics
    ts = sorted(e["ts"] for e in events
                if e.get("name") == "Swap" and isinstance(e.get("ts"), (int, float)))
    if len(ts) < 3:
        return {"swap_count": len(ts), "swap_fps_median_gap": 0.0,
                "note": "too few swaps"}
    gaps = [(b - a) / 1000 for a, b in zip(ts, ts[1:]) if 0 < (b - a) / 1000 < 1000]
    med = statistics.median(gaps) if gaps else 0
    lo, peak = 0, 0
    for hi in range(len(ts)):
        while ts[hi] - ts[lo] > 1_000_000:
            lo += 1
        peak = max(peak, hi - lo + 1)
    return {"swap_count": len(ts),
            "swap_median_gap_ms": round(med, 2),
            "swap_fps_median_gap": round(1000 / med, 1) if med > 0 else 0,
            "swap_peak_1s": peak}


def main():
    proj = sys.argv[1] if len(sys.argv) > 1 else "_p5_dense300"
    modes = sys.argv[2] if len(sys.argv) > 2 else "both"  # virtual|direct|both
    pre_shot = sys.argv[3] if len(sys.argv) > 3 else "shot_d001"
    pre_scene = sys.argv[4] if len(sys.argv) > 4 else "scene_900"
    (OUT / "performance").mkdir(parents=True, exist_ok=True)
    SHOT.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)

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
                               "--enable-logging=stderr", "--v=0",
                               "--window-size=1440,900", "about:blank"],
                              stderr=subprocess.DEVNULL)
    targets = None
    for _ in range(30):
        time.sleep(1)
        try:
            ver = json.loads(urllib.request.urlopen(
                f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=5).read())
            targets = ver
            break
        except Exception:
            continue
    assert targets, "headed devtools never came up"
    # GPU/compositor evidence (browser-level target)
    ws = targets.get("webSocketDebuggerUrl")
    bcdp = CDP(ws)
    sysinfo = bcdp.call("SystemInfo.getInfo", timeout=20).get("gpu", {})
    bcdp.ws.close()
    gpu_env = {
        "headed": True,
        "no_disable_gpu_flag": True,
        "gpu_compositing": sysinfo.get("featureStatus", {}).get("gpu_compositing"),
        "rasterization": sysinfo.get("featureStatus", {}).get("rasterization"),
        "devices": [(d.get("vendorString"), d.get("deviceString"))
                    for d in sysinfo.get("devices", [])][:3],
        "viewport": [1440, 900],
        "devicePixelRatio": 1,
    }
    (OUT / "performance" / "environment.json").write_text(
        json.dumps(gpu_env, indent=1), encoding="utf-8")
    print("GPU:", gpu_env["gpu_compositing"], gpu_env["devices"])

    tg = json.loads(urllib.request.urlopen(
        f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=10).read())
    pt = next(t for t in tg if t.get("type") == "page")
    cdp = CDP(pt["webSocketDebuggerUrl"])
    cdpWheel = CDP(pt["webSocketDebuggerUrl"])
    cdpTrace = CDP(pt["webSocketDebuggerUrl"])
    cdpClock = CDP(pt["webSocketDebuggerUrl"])
    try:
        cdp.call("Page.enable"); cdp.call("Runtime.enable")
        cdp.call("Log.enable"); cdp.call("Network.enable")
        ver = cdp.evaluate("navigator.userAgent")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        assert wait_for(cdp, "typeof window.loadPreviewAudio==='function'", 60)
        E = cdp.evaluate
        E(f"window.loadPreviewAudio('{proj}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        E("""(() => { const b = Array.from(document.querySelectorAll('button'))
          .find(x => (x.innerText||'').includes('Khám phá sau')); if (b) b.click(); })()""")
        time.sleep(0.8)
        E("window.switchWorkspace('scenes')")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.5)
        E("""(() => { const a = document.getElementById('audio-player');
          if (a) { try { a.pause(); } catch (e) {} a.removeAttribute('src'); a.load(); } })()""")
        time.sleep(2.0)
        E("fetch('/health').then(r=>r.json()).catch(()=>null)")
        time.sleep(1.0)

        # expand preselected scene for the scroll runs
        E(f"window.selectVisualShot('{pre_shot}','{pre_scene}')")
        assert wait_for(cdp, f"(document.querySelector('.visual-shot-identity-card')?.innerText||'').includes('{pre_shot}')", 60)
        time.sleep(1.0)
        do_dense = (pre_scene == "scene_900")

        run_modes = []
        if modes in ("virtual", "virtualized", "both"):
            run_modes.append("virtualized")
        if modes in ("direct", "forced-direct", "both"):
            run_modes.append("forced-direct")
        assert run_modes or modes == "skip", f"unknown modes arg: {modes}"
        for mode in run_modes:
            thr = 200 if mode == "virtualized" else 1000000
            E(f"window.UQVirtualList.THRESHOLD_GROUPS = {thr}")
            E("window.renderVisualSceneNavigator()")
            time.sleep(1.0)
            # re-expand dense scene (full re-render may collapse? no—expanded set persists)
            for run in range(5):
                import threading
                clock_out = {}
                E("document.getElementById('sp-rows-container').scrollTop = 0")
                time.sleep(0.5)
                clock_js = """(() => new Promise(res => {
                  const deltas = [];
                  let last = performance.now();
                  const t0 = last;
                  let done = false;
                  function finish() {
                    if (done) return; done = true;
                    res({deltas, wallMs: Math.round(performance.now() - t0)});
                  }
                  function tick(t) {
                    if (done) return;
                    deltas.push(t - last); last = t;
                    if (t - t0 < 5200) requestAnimationFrame(tick);
                    else finish();
                  }
                  // Wall-clock fallback: never pend forever if rAF stalls
                  // (occluded page / throttled frame production).
                  setTimeout(finish, 9000);
                  requestAnimationFrame(tick);
                }))()"""

                def run_clock():
                    try:
                        clock_out["deltas"] = cdpClock.evaluate(
                            clock_js, await_promise=True, timeout=60)
                    except Exception as e:
                        clock_out["error"] = str(e)[:200]

                start_trace(cdpTrace)
                t0 = time.time() * 1000
                th = threading.Thread(target=run_clock, daemon=True)
                th.start()
                time.sleep(0.3)
                # NOTE: cdp is busy in the clock thread; main thread uses cdpWheel only.
                box = cdpWheel.evaluate("(() => { const r = document.getElementById('sp-rows-container').getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()")
                dropped = 0

                def wheel(dx, dy):
                    nonlocal dropped
                    try:
                        cdpWheel.call("Input.dispatchMouseEvent", {
                            "type": "mouseWheel", "x": box[0], "y": box[1],
                            "deltaX": dx, "deltaY": dy, "pointerType": "mouse"},
                            timeout=12)
                    except Exception:
                        dropped += 1

                for _ in range(10):
                    wheel(0, -700)
                    time.sleep(0.25)
                for _ in range(6):
                    wheel(0, 700)
                    time.sleep(0.25)
                th.join(timeout=30)
                t1 = time.time() * 1000
                print(f"  [clock alive: {th.is_alive()}, "
                      f"err: {clock_out.get('error')}]", flush=True)
                clock_raw = clock_out.get("deltas") or {}
                clock = clock_raw.get("deltas", []) if isinstance(clock_raw, dict) else clock_raw
                wall_ms = clock_raw.get("wallMs") if isinstance(clock_raw, dict) else None
                print(f"  [clock samples: {len(clock) if isinstance(clock, list) else 'n/a'}, "
                      f"wallMs: {wall_ms}]", flush=True)
                events = stop_trace(cdpTrace)
                print(f"  [trace events: {len(events)}]", flush=True)
                frames = frame_stats_from_trace(events, t0, t1)
                import statistics
                clock = clock if isinstance(clock, list) else []
                deltas = [d for d in clock if isinstance(d, (int, float)) and 0 < d < 1000]
                valid = len(deltas) >= 100 and (wall_ms or 0) >= 4500
                if not valid:
                    print(f"  [run{run + 1} DEGRADED: {len(deltas)} samples, wallMs={wall_ms}]",
                          flush=True)
                deltas.sort()
                fps = round(1000 / (sum(deltas) / len(deltas)), 1) if deltas else 0
                long25 = sum(1 for d in deltas if d > 25)
                long50 = sum(1 for d in deltas if d > 50)
                rec = {"mode": mode, "run": run + 1, "raf_fps": fps,
                       "valid": bool(valid), "wall_ms": wall_ms,
                       "dropped_wheel_inputs": dropped,
                       "trace_swaps": frames["swap_count"],
                       "trace_swap_fps_median_gap": frames.get("swap_fps_median_gap"),
                       "trace_swap_peak_1s": frames.get("swap_peak_1s"),
                        "raf_median_ms": round(statistics.median(deltas), 2) if deltas else None,
                        "raf_p95_ms": round(deltas[min(len(deltas) - 1, int(len(deltas) * 0.95))], 2) if deltas else None,
                        "long_over_25ms": long25, "long_over_50ms": long50}
                results["runs"].append(rec)
                print(mode, f"run{run + 1}:", rec, flush=True)
                (OUT / "performance" / "headed_scroll_runs.json").write_text(
                    json.dumps({"runs": results["runs"]}, indent=1), encoding="utf-8")
                time.sleep(1.0)
        E("window.UQVirtualList.THRESHOLD_GROUPS = 200")
        # DevTools Frame Rendering Stats (FPS meter) per mode — read manually.
        for mode, thr in (("virtualized", 200), ("forced-direct", 1000000)):
            E(f"window.UQVirtualList.THRESHOLD_GROUPS = {thr}")
            E("window.renderVisualSceneNavigator()")
            time.sleep(1.0)
            E("document.getElementById('sp-rows-container').scrollTop = 0")
            time.sleep(0.5)
            for _ in range(6):
                try:
                    cdpWheel.call("Input.dispatchMouseEvent", {
                        "type": "mouseWheel", "x": 700, "y": 450,
                        "deltaX": 0, "deltaY": -900, "pointerType": "mouse"}, timeout=12)
                except Exception:
                    pass
                time.sleep(0.5)
            # EventTiming: input-to-paint durations actually observed.
            evt = E("""(() => {
              if (!performance.getEntriesByType) return [];
              return performance.getEntriesByType('event')
                .filter(e => e.name === 'wheel' || e.name === 'scroll')
                .map(e => Math.round(e.duration * 10) / 10).slice(-40);
            })()""")
            (OUT / "performance" / f"eventtiming-{mode}.json").write_text(
                json.dumps({"mode": mode, "wheel_event_durations_ms": evt}, indent=1))
            print(f"event timing {mode}:", evt)
            data = cdp.call("Page.captureScreenshot", {"format": "png"})["data"]
            import base64 as _b64
            (SHOT / f"headed-scroll-{mode}.png").write_bytes(_b64.b64decode(data))
        E("window.UQVirtualList.THRESHOLD_GROUPS = 200")
        # ---- Dense-shot behavior (§15): only on dense fixture ----
        dense = {"skipped": not do_dense}
        if do_dense:
            E("window.selectVisualShot('shot_d001','scene_900')")
            assert wait_for(cdp, "(document.querySelector('.visual-shot-identity-card')?.innerText||'').includes('shot_d001')", 60)
            time.sleep(1.0)
            print("DENSE pre: btn=", E("!!document.querySelector('[data-action=select-shot][data-shot-id=shot_d001]')"),
                  "groups=", E("document.querySelectorAll('#sp-rows-container .visual-scene-group').length"))
            # render cost with 300 mounted shot buttons
            samples = []
            for _ in range(11):
                v = E("(() => { const t0 = performance.now(); window.renderVisualSceneNavigator(); return performance.now() - t0; })()")
                samples.append(v)
            samples.sort()
            import statistics as _st
            dense["render_p50_ms"] = round(_st.median(samples), 2)
            dense["render_p95_ms"] = round(samples[min(len(samples) - 1, int(len(samples) * 0.95))], 2)
            dense["mounted_rows"] = E("document.querySelectorAll('#sp-rows-container button').length")
            dense["groups"] = E("document.querySelectorAll('#sp-rows-container .visual-scene-group').length")
            # Shot 1 -> arrows -> deep into list
            E("window.selectVisualShot('shot_d001','scene_900')")
            time.sleep(1.0)
            E("""(() => { const b = document.querySelector('[data-action=select-shot][data-shot-id=shot_d001]');
              if (b) b.focus(); })()""")
            seq = []
            for _ in range(6):
                cdpWheel.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "ArrowDown",
                                                         "code": "ArrowDown", "windowsVirtualKeyCode": 40,
                                                         "nativeVirtualKeyCode": 40, "pointerType": "mouse"},
                              timeout=12)
                cdpWheel.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "ArrowDown",
                                                         "code": "ArrowDown", "windowsVirtualKeyCode": 40,
                                                         "nativeVirtualKeyCode": 40, "pointerType": "mouse"},
                              timeout=12)
                time.sleep(0.3)
                seq.append(E("(() => document.activeElement?.dataset?.shotId || document.activeElement?.dataset?.sceneId || '?')()"))
            dense["arrow_seq"] = seq
            # Enter on focused shot selects it
            cdpWheel.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Enter",
                                                     "code": "Enter", "windowsVirtualKeyCode": 13,
                                                     "nativeVirtualKeyCode": 13}, timeout=12)
            cdpWheel.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Enter",
                                                     "code": "Enter", "windowsVirtualKeyCode": 13,
                                                     "nativeVirtualKeyCode": 13}, timeout=12)
            time.sleep(1.5)
            dense["enter_card"] = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,60) || '')()")
            # scroll away to bottom and back; selection must survive
            E("document.getElementById('sp-rows-container').scrollTop = 999999")
            time.sleep(1.0)
            E("window.selectVisualShot('shot_d250','scene_900')")
            assert wait_for(cdp, "(document.querySelector('.visual-shot-identity-card')?.innerText||'').includes('shot_d250')", 60)
            time.sleep(0.8)
            dense["sel250_nav"] = E("(() => document.querySelector('[data-action=select-shot][data-shot-id=shot_d250]')?.getAttribute('aria-pressed'))()")
            E("document.getElementById('sp-rows-container').scrollTop = 0")
            time.sleep(1.0)
            dense["sel250_survives"] = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.includes('shot_d250'))()")
            E("window.selectVisualShot('shot_d250','scene_900')")
            time.sleep(1.0)
            dense["sel250_remount"] = E("(() => document.querySelector('[data-action=select-shot][data-shot-id=shot_d250]')?.getAttribute('aria-pressed'))()")
            dense["focus_valid"] = E("(() => { const b = document.querySelector('[data-action=select-shot][data-shot-id=shot_d250]'); if (b) b.focus(); return (document.activeElement === b); })()")
            (OUT / "performance" / "dense_behavior.json").write_text(
                json.dumps(dense, indent=1, ensure_ascii=False), encoding="utf-8")
            print("DENSE:", json.dumps(dense, ensure_ascii=False)[:800])
        (OUT / "performance" / "headed_scroll_runs.json").write_text(
            json.dumps({"environment": gpu_env, "userAgent": ver,
                        "runs": results["runs"]}, indent=1), encoding="utf-8")
        if results["runs"]:
            import csv
            with open(OUT / "performance" / "headed_scroll_runs.csv", "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(results["runs"][0].keys()))
                w.writeheader()
                w.writerows(results["runs"])
        # screenshot of dense scene
        data = cdp.call("Page.captureScreenshot", {"format": "png"})["data"]
        import base64
        (SHOT / "headed-dense.png").write_bytes(base64.b64decode(data))
        print("screenshot saved")
        # console / network gates (§21)
        cdp.drain()
        cerrs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                 and e.get("params", {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        fails, f5xx = [], []
        for ev in cdp.events:
            if ev.get("method") == "Network.loadingFailed" and ev.get("params", {}).get("type") not in ("Media",):
                fails.append(ev.get("params", {}).get("errorText", ""))
            if ev.get("method") == "Network.responseReceived":
                r = ev.get("params", {}).get("response", {})
                if r.get("url", "").startswith(APP) and r.get("status", 0) >= 500:
                    f5xx.append(r.get("url", ""))
        (OUT / "console_network.json").write_text(json.dumps(
            {"console_errors": len(cerrs), "unhandled": len(unh),
             "failed_non_media": len(fails), "server_5xx": len(f5xx)}, indent=1))
        print(f"console={len(cerrs)} unhandled={len(unh)} failed={len(fails)} 5xx={len(f5xx)}")
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
