"""Probe: Input.synthesizeScrollGesture on headed Chrome (method availability,
scroll continuity, trace markers, presented frames during gesture).
Usage: python scripts/probe_synth_gesture.py
"""
import json
import subprocess
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP = "http://127.0.0.1:7860"
REF = "2026-09-12_210003_youtube-narration-01"
PROFILE = Path("temp/probe_gesture_profile")
CDP_PORT = 9364
TRACE_CATS = ("devtools.timeline,cc,viz,benchmark,gpu,"
              "disabled-by-default-devtools.timeline.frame")


def main():
    import shutil
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
    # big fixture for real scroll distance
    dst = Path("projects") / "_p5s_probe"
    shutil.rmtree(dst, ignore_errors=True)
    r = subprocess.run([sys.executable, "scripts/make_large_fixture.py", "_p5s_probe", "500"],
                       capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, r.stderr[-2000:]
    print(r.stdout.strip(), flush=True)
    PROFILE.mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen([CHROME, f"--remote-debugging-port={CDP_PORT}",
                               f"--user-data-dir={PROFILE.resolve()}",
                               "--no-first-run", "--no-default-browser-check",
                               "--window-size=1440,900", "about:blank"],
                              stderr=subprocess.DEVNULL)
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
        cdpIn = CDP(pt["webSocketDebuggerUrl"])
        cdpTrace = CDP(pt["webSocketDebuggerUrl"])
        cdp.call("Page.enable"); cdp.call("Runtime.enable")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E = cdp.evaluate
        E("window.loadPreviewAudio('_p5s_probe',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        E("""(() => { const b = Array.from(document.querySelectorAll('button'))
          .find(x => (x.innerText||'').includes('Khám phá sau')); if (b) b.click(); })()""")
        time.sleep(0.8)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        E("""(() => { const a = document.getElementById('audio-player');
          if (a) { try { a.pause(); } catch (e) {} a.removeAttribute('src'); a.load(); } })()""")
        time.sleep(1.0)
        info = E("(() => { const c = document.getElementById('sp-rows-container');"
                 " const r = c.getBoundingClientRect();"
                 " return {scrollH: c.scrollHeight, clientH: c.clientHeight,"
                 " top: c.scrollTop, x: r.x + r.width/2, y: r.y + r.height/2}; })()")
        print("container:", info, flush=True)
        E("document.getElementById('sp-rows-container').scrollTop = 0")
        time.sleep(0.5)
        cdpTrace.call("Tracing.start", {"categories": TRACE_CATS,
                                        "transferMode": "ReturnAsStream",
                                        "streamCompression": "none"})
        time.sleep(0.3)
        import threading
        samples = []
        stop = threading.Event()

        def sampler():
            while not stop.is_set():
                try:
                    samples.append((round(time.time(), 3),
                                    E("document.getElementById('sp-rows-container').scrollTop")))
                except Exception:
                    pass
                time.sleep(0.1)

        th = threading.Thread(target=sampler, daemon=True)
        th.start()
        t0 = time.time()
        try:
            res = cdpIn.call("Input.synthesizeScrollGesture", {
                "x": info["x"], "y": info["y"],
                "yDistance": -6000, "speed": 2500,
                "gestureSourceType": "touch",
                "preventFling": True}, timeout=60)
            print("gesture call returned:", res, flush=True)
        except Exception as ex:
            print("GESTURE ERROR:", str(ex)[:300], flush=True)
        wall = round(time.time() - t0, 2)
        time.sleep(0.5)
        stop.set(); th.join(timeout=5)
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
        parts = []
        if stream:
            while True:
                rr = cdpTrace.call("IO.read", {"handle": stream}, timeout=60)
                if rr.get("data"):
                    parts.append(rr["data"])
                if rr.get("eof"):
                    break
            cdpTrace.call("IO.close", {"handle": stream})
        events = json.loads("".join(parts)).get("traceEvents", [])
        print(f"gesture wall={wall}s samples={len(samples)} total_events={len(events)}", flush=True)
        print("scrollTop first5:", samples[:5], flush=True)
        print("scrollTop last5:", samples[-5:], flush=True)
        moving = sum(1 for a, b in zip(samples, samples[1:]) if b[1] != a[1])
        print(f"samples_with_movement={moving}/{len(samples)}", flush=True)
        c = Counter(e.get("name") for e in events
                    if str(e.get("name", "")).startswith(("InputLatency", "Gesture")))
        for k, v in c.most_common(12):
            print(f"{v:6d}  {k}", flush=True)
        nfd = sum(1 for e in events if e.get("name") == "Display::FrameDisplayed")
        print(f"FrameDisplayed={nfd}", flush=True)
        gts = sorted(e["ts"] for e in events
                     if str(e.get("name", "")).startswith("InputLatency::Gesture")
                     and isinstance(e.get("ts"), (int, float)))
        if gts:
            print(f"gesture trace span={(gts[-1]-gts[0])/1e6:.2f}s over {len(gts)} events", flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()
    shutil.rmtree(dst, ignore_errors=True)


if __name__ == "__main__":
    main()
