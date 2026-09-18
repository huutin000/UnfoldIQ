"""Probe: exact viewport/media state at odd widths (1279/959 anomalies).
Usage: python scripts/probe_media_state.py
"""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP = "http://127.0.0.1:7860"
REF = "2026-09-12_210003_youtube-narration-01"
PROFILE = Path("temp/probe_media_profile")
CDP_PORT = 9372


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
        cdp.call("Page.enable"); cdp.call("Runtime.enable")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E = cdp.evaluate
        E(f"window.loadPreviewAudio('{REF}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.0)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        for w in (1280, 1279, 1278, 1024, 961, 960, 959, 958, 768):
            cdp.call("Emulation.setDeviceMetricsOverride",
                     {"width": w, "height": 800, "deviceScaleFactor": 1, "mobile": False})
            time.sleep(1.2)
            print(E("(() => { const q = s => window.matchMedia(s).matches;"
                    " return JSON.stringify({req: " + str(w) + ", innerW: window.innerWidth,"
                    " m959: q('(max-width: 959px)'), m960_1279: q('(min-width: 960px) and (max-width: 1279px)'),"
                    " m1280_1439: q('(min-width: 1280px) and (max-width: 1439px)'),"
                    " body: document.body.className,"
                    " grid: getComputedStyle(document.querySelector('.workstation-body')).gridTemplateColumns,"
                    " sbW: Math.round(document.getElementById('pipeline-sidebar').getBoundingClientRect().width)}); })()"), flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
