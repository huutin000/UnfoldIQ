"""Probe 2: distinct Graphics.Pipeline + PipelineReporter steps, AnimationFrame
kinds, BeginFrameDropped/DidNotProduce reasons. Prints exact step taxonomy
available in headed traces so the primary parser classifies honestly.
Usage: python scripts/probe_frame_steps.py
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
CDP_PORT = 9362
TRACE_CATS = ("devtools.timeline,cc,viz,benchmark,gpu,"
              "disabled-by-default-devtools.timeline.frame")


def collect(cdpTrace):
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
    return json.loads("".join(parts)).get("traceEvents", [])


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
        events = collect(cdpTrace)
        print(f"TOTAL: {len(events)}")
        gp = Counter()
        pr = Counter()
        for e in events:
            n = e.get("name", "")
            a = e.get("args", {}) or {}
            if n == "Graphics.Pipeline":
                gp[a.get("chrome_graphics_pipeline", {}).get("step", "?")] += 1
            elif n == "PipelineReporter":
                pr[json.dumps(a, sort_keys=True)[:160]] += 1
        print("== Graphics.Pipeline steps ==")
        for s, c in gp.most_common():
            print(f"{c:6d}  {s}")
        print("== PipelineReporter arg shapes ==")
        for s, c in pr.most_common(15):
            print(f"{c:6d}  {s}")
        print("== AnimationFrame::* ==")
        ca = Counter(e.get("name") for e in events
                     if str(e.get("name", "")).startswith("AnimationFrame"))
        for s, c in ca.most_common():
            print(f"{c:6d}  {s}")
        print("== Drop/skip/abort signals ==")
        for key in ("Scheduler::BeginFrameDropped", "Scheduler::BeginMainFrameAborted",
                    "MainFrameAborted", "EarlyOut_NoUpdates", "DidNotSubmitInLastFrame"):
            print(f"{sum(1 for e in events if e.get('name')==key):6d}  {key}")
        rs = Counter()
        for e in events:
            if e.get("name") == "LayerTreeHostImpl::DidNotProduceFrame":
                rs[str((e.get("args", {}) or {}).get("FrameSkippedReason"))] += 1
        print("== DidNotProduceFrame reasons ==", dict(rs))
        print("== InputLatency::* ==")
        ci = Counter(e.get("name") for e in events
                     if str(e.get("name", "")).startswith("InputLatency"))
        for s, c in ci.most_common():
            print(f"{c:6d}  {s}")
        # Performance domain Frames metric sanity
        cdp.call("Performance.enable")
        m1 = {m["name"]: m["value"] for m in
              cdp.call("Performance.getMetrics").get("metrics", [])}
        print("== Performance metrics sample ==",
              {k: m1.get(k) for k in ("Frames", "Timestamp") if k in m1})
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
