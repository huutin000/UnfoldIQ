"""Probe 3: dump raw samples of Graphics.Pipeline '?' events, full
PipelineReporter frame_reporter args, and search ANY present/swap/display/
vsync-like event names. One headed run on reference fixture.
Usage: python scripts/probe_frame_raw.py
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
PROJ = "2026-09-12_210003_youtube-narration-01"
PROFILE = Path("temp/probe_frame_profile")
CDP_PORT = 9363
TRACE_CATS = ("devtools.timeline,cc,viz,benchmark,gpu,"
              "disabled-by-default-devtools.timeline.frame")


def main():
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
        cdpWheel = CDP(pt["webSocketDebuggerUrl"])
        cdpTrace = CDP(pt["webSocketDebuggerUrl"])
        cdp.call("Page.enable"); cdp.call("Runtime.enable")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E = cdp.evaluate
        E(f"window.loadPreviewAudio('{PROJ}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.0)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        E("""(() => { const a = document.getElementById('audio-player');
          if (a) { try { a.pause(); } catch (e) {} a.removeAttribute('src'); a.load(); } })()""")
        time.sleep(1.0)
        cdpTrace.call("Tracing.start", {"categories": TRACE_CATS,
                                        "transferMode": "ReturnAsStream",
                                        "streamCompression": "none"})
        time.sleep(0.5)
        box = cdpWheel.evaluate("(() => { const r = document.getElementById('sp-rows-container').getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()")
        for _ in range(6):
            try:
                cdpWheel.call("Input.dispatchMouseEvent", {
                    "type": "mouseWheel", "x": box[0], "y": box[1],
                    "deltaX": 0, "deltaY": -700, "pointerType": "mouse"}, timeout=12)
            except Exception as e:
                print("wheel err", str(e)[:100])
            time.sleep(0.3)
        time.sleep(1.0)
        cdpTrace.call("Tracing.end")
        stream = None
        cdpTrace.ws.socket.settimeout(15)
        try:
            while True:
                try:
                    raw = cdpTrace.ws.recv(timeout=10)
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
                r = cdpTrace.call("IO.read", {"handle": stream}, timeout=60)
                if r.get("data"):
                    parts.append(r["data"])
                if r.get("eof"):
                    break
            cdpTrace.call("IO.close", {"handle": stream})
        events = json.loads("".join(parts)).get("traceEvents", [])
        print(f"TOTAL: {len(events)}")
        out = Path("temp/probe_frame_raw.json")
        # 1. samples of Graphics.Pipeline with NO chrome_graphics_pipeline.step
        n = 0
        for e in events:
            if e.get("name") == "Graphics.Pipeline" and \
                    not (e.get("args", {}) or {}).get("chrome_graphics_pipeline", {}).get("step"):
                print("GP-? :", json.dumps(e)[:600])
                n += 1
                if n >= 3:
                    break
        # 2. full PipelineReporter frame_reporter sample
        for e in events:
            a = (e.get("args", {}) or {}).get("frame_reporter")
            if a:
                print("PR-FULL:", json.dumps(a)[:800])
                break
        # 3. any present/swap/display/vsync-ish names
        subs = ("present", "swap", "display", "vsync", "framepresented",
                "compositorframe", "didpresent", "bufferpresented")
        hit = Counter()
        for e in events:
            nm = str(e.get("name", ""))
            low = nm.lower().replace(":", "").replace(".", "").replace(" ", "")
            if any(s in low for s in subs):
                hit[nm] += 1
        print("== present/swap/display hits ==")
        for k, c in hit.most_common(40):
            print(f"{c:6d}  {k}")
        # 4. ts range + duration of trace (996 = trace clock MHz? print min/max ts)
        ts = [e["ts"] for e in events if isinstance(e.get("ts"), (int, float))]
        if ts:
            print(f"ts range: {min(ts)} .. {max(ts)}  span_s={(max(ts)-min(ts))/1e6:.2f}")
        out.write_text(json.dumps({"total": len(events),
                                   "present_swap_hits": hit.most_common(40)}, indent=1),
                       encoding="utf-8")
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
