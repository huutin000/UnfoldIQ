"""Phase 5 FINAL performance-gate closure — sustained-scroll headed harness.

Methodology fix vs previous closure: discrete 16x250ms wheel flings are
replaced by SUSTAINED scroll gestures
(Input.synthesizeScrollGesture, gestureSourceType=mouse, preventFling=True)
so the compositor sees continuous visual damage. Active interval is
predefined as [first_input_event, last_input_event + 200ms tail] in trace
clock; FPS denominator is the ACTIVE interval only (idle/warmup/cooldown
excluded). Primary metric stays compositor frame evidence
(Display::FrameDisplayed canonical; rAF NOT used).

Validity (input-mechanics only, never outcome-based):
  travel_px >= 0.8 * requested_px AND >= 10 input-latency events in trace.
Boundary-hit/short runs are recorded INVALID with reason and excluded from
medians; invalid count reported separately (no cherry-picking).

Conditions x5 valid runs each: large-virtualized / large-direct (579/1641),
dense-300 (scene_900 x 300, own runs).
Usage: python scripts/verify_phase05_sustained.py [--quick]
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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for  # noqa: E402
from verify_phase05_frame_evidence import (  # noqa: E402
    parse_frame_evidence, start_trace, stop_trace_events)

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP = "http://127.0.0.1:7860"
REF = "2026-09-12_210003_youtube-narration-01"
OUT = Path("temp/phase05_performance_gate_closure")
PERF = OUT / "performance"
SHOT = PERF / "screenshots"
PROFILE = Path("temp/headed_profile_p5s")
CDP_PORT = 9353
TAIL_US = 200_000

BIG = "_p5s_big1500"
DENSE = "_p5s_dense300"

INPUT_EVENT_NAMES = {"InputLatency::GestureScrollBegin",
                     "InputLatency::GestureScrollUpdate",
                     "InputLatency::GestureScrollEnd",
                     "InputLatency::MouseWheel"}


# ------------------------------------------------------------------ pure fns
def input_event_ts(events):
    return sorted(e["ts"] for e in events
                  if e.get("name") in INPUT_EVENT_NAMES
                  and isinstance(e.get("ts"), (int, float)))


def active_window(input_ts, tail_us=TAIL_US):
    """Predefined active sustained-scroll interval in trace clock."""
    if len(input_ts) < 2:
        return None
    return (input_ts[0], input_ts[-1] + tail_us)


def active_fps(presented_ts, window):
    if not window:
        return 0.0, 0, 0.0
    a0, a1 = window
    n = sum(1 for t in presented_ts if a0 <= t <= a1)
    dur = max((a1 - a0) / 1_000_000, 1e-6)
    return round(n / dur, 1), n, round(dur, 2)


def run_valid(travel_px, requested_px, n_input_events):
    if n_input_events < 10:
        return False, "too few input-latency events"
    if travel_px < 0.8 * requested_px:
        return False, "boundary hit early / short travel"
    return True, ""


# ------------------------------------------------------------------ harness
def file_hash(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()[:16]


def main():
    quick = "--quick" in sys.argv
    n_valid_target = 2 if quick else 5
    PERF.mkdir(parents=True, exist_ok=True)
    SHOT.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.datetime.now().astimezone().isoformat()

    import shutil
    for name, script, arg in ((BIG, "scripts/make_large_fixture.py", "500"),
                              (DENSE, "scripts/make_dense_fixture.py", "300")):
        dst = Path("projects") / name
        shutil.rmtree(dst, ignore_errors=True)
        r = subprocess.run([sys.executable, script, name, arg], capture_output=True,
                           text=True, timeout=600)
        assert r.returncode == 0, r.stderr[-2000:]
        print(r.stdout.strip(), flush=True)

    refdir = Path("projects") / REF
    hash_files = ["veo_prompts.json", "scene_plan.json", "visual_bible.json",
                  "image_prompts.json", "timestamps.json", "script.txt",
                  "audio.wav", "settings.json", "state.db"]
    integrity_before = {f: file_hash(refdir / f) for f in hash_files}

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
    all_runs, invalid_runs = [], []
    render_metrics, dense_func, palette = {}, {}, {}
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
        cdpIn = CDP(PAGE_WS)
        cdpTrace = CDP(PAGE_WS)
        cdp.call("Page.enable"); cdp.call("Runtime.enable")
        cdp.call("Log.enable"); cdp.call("Network.enable")
        ua = cdp.evaluate("navigator.userAgent")
        bver = json.loads(urllib.request.urlopen(
            f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=5).read())
        bcdp = CDP(bver["webSocketDebuggerUrl"])
        sysinfo = bcdp.call("SystemInfo.getInfo", timeout=20).get("gpu", {})
        bcdp.ws.close()
        env = {"headed": True, "no_headless_flag": True, "no_disable_gpu_flag": True,
               "chrome": bver.get("Browser", ""), "userAgent": ua,
               "os": "Microsoft Windows 11 Home Single Language, 10.0.26200",
               "gpu_compositing": (sysinfo.get("featureStatus", {}) or {}).get("gpu_compositing"),
               "rasterization": (sysinfo.get("featureStatus", {}) or {}).get("rasterization"),
               "devices": [(d.get("vendorString"), d.get("deviceString"))
                           for d in sysinfo.get("devices", [])][:3],
               "viewport": [1440, 900],
               "devicePixelRatio": cdp.evaluate("window.devicePixelRatio"),
               "generated_at": generated_at}
        print("GPU:", env["gpu_compositing"], env["devices"], flush=True)
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E = cdp.evaluate

        conditions = [("large-virtualized", BIG, 200),
                      ("large-direct", BIG, 1000000),
                      ("dense-300", DENSE, 200)]
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
            E(f"window.UQVirtualList.THRESHOLD_GROUPS = {thr}")
            E("window.renderVisualSceneNavigator()")
            time.sleep(1.0)
            if cond == "dense-300":
                E("window.selectVisualShot('shot_d001','scene_900')")
                time.sleep(1.0)
                E("window.renderVisualSceneNavigator()")
                time.sleep(1.0)
            else:
                pre = E("(() => { const b = document.querySelector('[data-action=select-shot]');"
                        " return b ? [b.dataset.shotId, b.dataset.sceneId] : null; })()")
                if pre:
                    E(f"window.selectVisualShot('{pre[0]}','{pre[1]}')")
                    time.sleep(1.0)
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
                "fixture": proj, "threshold": thr}
            print(cond, render_metrics[cond], flush=True)

            valid, attempt = 0, 0
            while valid < n_valid_target and attempt < n_valid_target + 4:
                attempt += 1
                E("document.getElementById('sp-rows-container').scrollTop = 0")
                time.sleep(0.6)
                geo = E("(() => { const c = document.getElementById('sp-rows-container');"
                        " const r = c.getBoundingClientRect();"
                        " return {scrollH: c.scrollHeight, clientH: c.clientHeight,"
                        " x: r.x + r.width/2, y: r.y + r.height/2}; })()")
                headroom = geo["scrollH"] - geo["clientH"]
                # 4s sustained gesture if headroom allows, else longest fitting
                dist = min(12000, max(2000, headroom - 500))
                speed = round(dist / 4)
                start_trace(cdpTrace)
                g0 = time.time()
                gesture_ok, gesture_err = True, ""
                try:
                    cdpIn.call("Input.synthesizeScrollGesture", {
                        "x": geo["x"], "y": geo["y"], "yDistance": -dist,
                        "speed": speed, "gestureSourceType": "mouse",
                        "preventFling": True}, timeout=90)
                except Exception as ex:
                    gesture_ok, gesture_err = False, str(ex)[:150]
                gwall = round(time.time() - g0, 2)
                top_end = E("document.getElementById('sp-rows-container').scrollTop")
                events = stop_trace_events(cdpTrace)
                fe = parse_frame_evidence(events)
                pres_ts = fe.pop("presented_ts_us")
                in_ts = input_event_ts(events)
                win = active_window(in_ts)
                afps, n_act, act_s = active_fps(pres_ts, win)
                gaps = sorted((b - a) / 1000 for a, b in
                              zip(pres_ts, pres_ts[1:]) if b > a) if len(pres_ts) >= 2 else []
                # active-window gaps only
                agaps = []
                if win:
                    aw = [t for t in pres_ts if win[0] <= t <= win[1]]
                    agaps = sorted((b - a) / 1000 for a, b in zip(aw, aw[1:]) if b > a)
                ok, reason = run_valid(top_end, dist, len(in_ts))
                if not gesture_ok:
                    ok, reason = False, f"gesture error: {gesture_err}"
                rec = {"condition": cond, "attempt": attempt, "valid": ok,
                       "invalid_reason": reason, "requested_px": dist,
                       "speed_px_s": speed, "travel_px": top_end,
                       "gesture_wall_s": gwall, "trace_events": len(events),
                       "n_input_events": len(in_ts), "active_s": act_s,
                       "active_fps": afps, "presented_active": n_act,
                       "presented_total": len(pres_ts),
                       "presented_peak_1s": fe["presented_peak_1s"],
                       "gap_p50_ms": round(statistics.median(gaps), 2) if gaps else None,
                       "gap_p95_ms": (gaps[min(len(gaps) - 1, int(len(gaps) * 0.95))]
                                      if gaps else None),
                       "gap_max_ms": round(max(gaps), 2) if gaps else None,
                       "active_gap_p50_ms": (round(statistics.median(agaps), 2) if agaps else None),
                       "active_gap_p95_ms": (agaps[min(len(agaps) - 1, int(len(agaps) * 0.95))]
                                             if agaps else None),
                       "active_gap_max_ms": round(max(agaps), 2) if agaps else None,
                       "long_over_25ms": sum(1 for g in agaps if g > 25),
                       "long_over_50ms": sum(1 for g in agaps if g > 50),
                       **fe}
                if ok:
                    valid += 1
                    all_runs.append(rec)
                    print(f"  {cond} valid{valid}: travel={top_end}/{dist}px"
                          f" active={act_s}s fps={afps} n={n_act} peak={fe['presented_peak_1s']}"
                          f" dropped={fe['dropped_total']} partial={fe['partial_high_latency_or_missing']}", flush=True)
                else:
                    invalid_runs.append(rec)
                    print(f"  {cond} INVALID(attempt{attempt}): {reason}"
                          f" travel={top_end}/{dist} inputs={len(in_ts)}", flush=True)
                (PERF / "sustained_runs.json").write_text(
                    json.dumps({"generated_at": generated_at, "runs": all_runs,
                                "invalid_runs": invalid_runs}, indent=1), encoding="utf-8")
                time.sleep(1.0)
            # FPS-meter overlay cross-check: one representative sustained scroll
            try:
                cdp.call("Overlay.setShowFPSCounter", {"show": True})
                E("document.getElementById('sp-rows-container').scrollTop = 0")
                time.sleep(0.4)
                cdpIn.call("Input.synthesizeScrollGesture", {
                    "x": geo["x"], "y": geo["y"], "yDistance": -min(6000, max(2000, headroom - 500)),
                    "speed": 2500, "gestureSourceType": "mouse",
                    "preventFling": True}, timeout=90)
                data = cdp.call("Page.captureScreenshot", {"format": "png"})["data"]
                import base64 as _b64
                (SHOT / f"fps-meter-{cond}.png").write_bytes(_b64.b64decode(data))
                print(f"  [{cond} fps-meter screenshot saved]", flush=True)
            except Exception as ex:
                print(f"  [{cond} fps-meter skipped: {str(ex)[:120]}]", flush=True)
            finally:
                try:
                    cdp.call("Overlay.setShowFPSCounter", {"show": False})
                except Exception:
                    pass
            data = cdp.call("Page.captureScreenshot", {"format": "png"})["data"]
            import base64 as _b64b
            (SHOT / f"sustained-{cond}.png").write_bytes(_b64b.b64decode(data))
        E("window.UQVirtualList.THRESHOLD_GROUPS = 200")

        # ---- dense functional recheck (compact) ----
        E(f"window.loadPreviewAudio('{DENSE}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.0)
        E("window.selectVisualShot('shot_d001','scene_900')")
        time.sleep(1.0)
        E("window.renderVisualSceneNavigator()")
        time.sleep(1.0)
        E("(() => { const b = document.querySelector('[data-action=select-shot][data-shot-id=shot_d001]'); if (b) b.focus(); })()")

        def press(vk, name, code):
            cdpIn.call("Input.dispatchKeyEvent",
                       {"type": "rawKeyDown", "key": name, "code": code,
                        "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk}, timeout=12)
            cdpIn.call("Input.dispatchKeyEvent",
                       {"type": "keyUp", "key": name, "code": code,
                        "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk}, timeout=12)
            time.sleep(0.3)

        seq = []
        for _ in range(6):
            press(40, "ArrowDown", "ArrowDown")
            seq.append(E("(() => document.activeElement?.dataset?.shotId || '?')()"))
        press(36, "Home", "Home")
        home_ok = E("(() => { const a = document.activeElement; const f = document.querySelector('#sp-rows-container button'); return a === f; })()")
        press(35, "End", "End")
        end_id = E("(() => document.activeElement?.dataset?.shotId || '?')()")
        press(13, "Enter", "Enter")
        time.sleep(1.2)
        E("window.selectVisualShot('shot_d250','scene_900')")
        time.sleep(0.8)
        sel = E("(() => document.querySelector('[data-action=select-shot][data-shot-id=shot_d250]')?.getAttribute('aria-pressed'))()")
        E("document.getElementById('sp-rows-container').scrollTop = 0")
        time.sleep(1.0)
        surv = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.includes('shot_d250'))()")
        foc = E("(() => { const b = document.querySelector('[data-action=select-shot][data-shot-id=shot_d250]'); if (b) b.focus(); return (document.activeElement === b); })()")
        dense_func = {"arrow_down_seq": seq, "home_first": home_ok, "end_id": end_id,
                      "sel250_nav": sel, "sel250_survives": surv, "focus_valid": foc}
        (PERF / "dense_functional.json").write_text(json.dumps(dense_func, indent=1, ensure_ascii=False), encoding="utf-8")
        print("DENSE-FUNC:", json.dumps(dense_func, ensure_ascii=False)[:300], flush=True)

        # ---- palette smoke (fresh conn) ----
        cdpP = CDP(PAGE_WS)
        cdpP.call("Page.enable"); cdpP.call("Runtime.enable")
        cdpP.call("Log.enable"); cdpP.call("Network.enable")
        E2 = cdpP.evaluate

        def ctrl_k():
            for t in ("rawKeyDown", "keyUp"):
                cdpP.call("Input.dispatchKeyEvent", {"type": t, "key": "k", "code": "KeyK",
                                                     "windowsVirtualKeyCode": 75,
                                                     "nativeVirtualKeyCode": 75, "modifiers": 2}, timeout=12)
            time.sleep(0.8)

        def key2(k, code, vk):
            for t in ("rawKeyDown", "keyUp"):
                cdpP.call("Input.dispatchKeyEvent", {"type": t, "key": k, "code": code,
                                                     "windowsVirtualKeyCode": vk,
                                                     "nativeVirtualKeyCode": vk}, timeout=12)
            time.sleep(0.4)

        E2(f"window.loadPreviewAudio('{REF}',665.64,false)")
        assert wait_for(cdpP, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.0)
        chk = {}

        def record(n, c, x=""):
            chk[n] = {"pass": bool(c), "extra": str(x)[:100]}
            print(("PASS " if c else "FAIL ") + n, str(x)[:80], flush=True)

        ctrl_k()
        record("opens", E2("window.UQPalette.isOpen()") is True)
        E2("(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'shot_001';"
           " i.dispatchEvent(new Event('input', {bubbles:true})); })()")
        time.sleep(0.6)
        key2("ArrowDown", "ArrowDown", 40)
        key2("ArrowUp", "ArrowUp", 38)
        key2("Enter", "Enter", 13)
        time.sleep(1.5)
        record("shot stable-ID", "shot_001" in E2("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,100) || '')()"))
        try:
            cdpP.drain()
        except OSError:
            pass
        net0 = len([e for e in cdpP.events if e.get("method") == "Network.requestWillBeSent"])
        ctrl_k()
        E2("(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'habilis';"
           " i.dispatchEvent(new Event('input', {bubbles:true})); })()")
        time.sleep(0.6)
        record("character search", "Nhân vật" in str(E2("(() => Array.from(document.querySelectorAll('.uq-cmd-kind')).map(b=>b.innerText))()")))
        try:
            cdpP.drain()
        except OSError:
            pass
        net1 = len([e for e in cdpP.events if e.get("method") == "Network.requestWillBeSent"])
        record("no network/keystroke", net1 == net0, f"{net0}->{net1}")
        E2(f"window.loadPreviewAudio('{DENSE}',665.64,false)")
        assert wait_for(cdpP, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.0)
        ctrl_k()
        E2("(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'shot_d250';"
           " i.dispatchEvent(new Event('input', {bubbles:true})); })()")
        time.sleep(0.6)
        key2("Enter", "Enter", 13)
        time.sleep(1.5)
        record("dense off-window reveal", "shot_d250" in E2("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,100) || '')()"))
        key2("Escape", "Escape", 27)
        time.sleep(0.4)
        record("escape closes", E2("window.UQPalette.isOpen()") is False)
        palette = chk
        (PERF / "palette_smoke.json").write_text(json.dumps(palette, indent=1, ensure_ascii=False), encoding="utf-8")

        # ---- console/network aggregate ----
        for c in (cdp, cdpP):
            try:
                c.drain()
            except OSError:
                pass
        evs = list(cdp.events) + list(cdpP.events)
        cerrs = [e for e in evs if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in evs if e.get("method") == "Runtime.exceptionThrown"]
        fails, f5xx = [], []
        for ev in evs:
            if ev.get("method") == "Network.loadingFailed" and \
                    (ev.get("params", {}) or {}).get("type") not in ("Media",):
                fails.append((ev.get("params", {}) or {}).get("errorText", ""))
            if ev.get("method") == "Network.responseReceived":
                rr = (ev.get("params", {}) or {}).get("response", {})
                if str(rr.get("url", "")).startswith(APP) and rr.get("status", 0) >= 500:
                    f5xx.append(rr.get("url", ""))
        (OUT / "console_network.json").write_text(json.dumps(
            {"console_errors": len(cerrs), "unhandled": len(unh),
             "failed_non_media": len(fails), "server_5xx": len(f5xx)}, indent=1))
        print(f"console={len(cerrs)} unhandled={len(unh)} failed={len(fails)} 5xx={len(f5xx)}", flush=True)
        (PERF / "render.json").write_text(json.dumps(render_metrics, indent=1), encoding="utf-8")
        (PERF / "environment.json").write_text(json.dumps(env, indent=1), encoding="utf-8")
        if all_runs:
            with open(PERF / "sustained_runs.csv", "w", newline="") as f:
                keys = [k for k in all_runs[0].keys()]
                w = csv.DictWriter(f, fieldnames=keys)
                w.writeheader()
                w.writerows(all_runs)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()

    integrity_after = {f: file_hash(refdir / f) for f in hash_files}
    (OUT / "integrity.json").write_text(json.dumps(
        {"generated_at": generated_at, "before": integrity_before,
         "after": integrity_after,
         "unchanged": integrity_before == integrity_after}, indent=1), encoding="utf-8")
    print("integrity unchanged:", integrity_before == integrity_after, flush=True)

    summary = {"generated_at": generated_at, "conditions": {},
               "invalid_runs": len(invalid_runs)}
    for cond in ("large-virtualized", "large-direct", "dense-300"):
        rs = [r for r in all_runs if r["condition"] == cond and r["valid"]]
        if not rs:
            continue
        med = lambda k: statistics.median([r[k] for r in rs if isinstance(r[k], (int, float))])
        summary["conditions"][cond] = {
            "n_valid": len(rs),
            "active_fps_median": med("active_fps"),
            "active_fps_min": min(r["active_fps"] for r in rs),
            "active_s_median": med("active_s"),
            "presented_active_median": med("presented_active"),
            "peak_1s_median": med("presented_peak_1s"),
            "active_gap_p50_median": med("active_gap_p50_ms"),
            "active_gap_p95_median": med("active_gap_p95_ms"),
            "dropped_total": sum(r["dropped_total"] for r in rs),
            "partial_total": sum(r["partial_high_latency_or_missing"] for r in rs),
            "skipped_no_damage_total": sum(r["skipped_no_damage"] for r in rs),
            "long_over_50_total": sum(r["long_over_50ms"] for r in rs),
            "vsync_hz": rs[0].get("vsync_hz"),
            "presented_signal": rs[0].get("presented_signal"),
            "travel_px_median": med("travel_px"),
        }
    (PERF / "sustained_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps(summary, indent=1), flush=True)

    import shutil as _sh
    for name in (BIG, DENSE):
        _sh.rmtree(Path("projects") / name, ignore_errors=True)
    leftover = [p.name for p in Path("projects").glob("_p5s*")]
    print("leftover:", leftover, flush=True)
    (OUT / "cleanup.json").write_text(json.dumps({"leftover": leftover}, indent=1))


if __name__ == "__main__":
    main()
