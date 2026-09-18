"""Probe: dump headed-trace event-name histogram to discover real
frame-presentation events (presented vs dropped vs partial).

Temp-only probe for corrective closure methodology design.
Usage: python scripts/probe_frame_events.py
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
CDP_PORT = 9361
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
                ver = json.loads(urllib.request.urlopen(
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
        blob_parts = []
        if stream:
            while True:
                r = cdpTrace.call("IO.read", {"handle": stream}, timeout=60)
                if r.get("data"):
                    blob_parts.append(r["data"])
                if r.get("eof"):
                    break
            cdpTrace.call("IO.close", {"handle": stream})
        events = json.loads("".join(blob_parts)).get("traceEvents", [])
        print(f"TOTAL EVENTS: {len(events)}")
        c = Counter(e.get("name", "?") for e in events)
        for name, n in c.most_common(80):
            print(f"{n:6d}  {name}")
        # show samples of frame-ish events
        keys = ["Frame", "Present", "Swap", "Buffer", "Draw", "Begin", "Drop", "Skip",
                "Pipeline", "Compositor", "Activate", "Display", "Viz", "Image"]
        seen = set()
        for e in events:
            n = str(e.get("name", ""))
            if any(k.lower() in n.lower() for k in keys) and n not in seen:
                seen.add(n)
                print("---", n, "ph=", e.get("ph"), "cat=", str(e.get("cat"))[:80])
                print("    args:", json.dumps(e.get("args", {}))[:300])
                if len(seen) > 40:
                    break
        Path("temp/probe_frame_events.json").write_text(
            json.dumps({"total": len(events),
                        "hist": c.most_common(120)}, indent=1), encoding="utf-8")
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
