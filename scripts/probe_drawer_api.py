"""Minimal drawer API probe with error surfacing (tour preset dismissed).
Usage: python scripts/probe_drawer_api.py
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
PROFILE = Path("temp/probe_drawer_api_profile")
CDP_PORT = 9373

SAFE = ("(() => { try { return JSON.stringify({ok: true, v: (XXX)}); }"
        " catch (e) { return JSON.stringify({ok: false, err: String(e && e.message || e)}); } })()")


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
        E("(() => { try { localStorage.setItem('unfoldiq.onboarding.v2', JSON.stringify({"
          " schemaVersion: 2, meta: {welcome: 'dismissed', migratedFromLegacy: true},"
          " tours: {'product-overview': {status: 'dismissed'}, 'content-basics': {status: 'dismissed'},"
          " 'scene-visual-basics': {status: 'dismissed'}, 'studio-basics': {status: 'dismissed'},"
          " 'review-basics': {status: 'dismissed'}, 'export-basics': {status: 'dismissed'},"
          " 'visual-bible-basics': {status: 'dismissed'}} })); } catch (e) {} return 1; })()")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E(f"window.loadPreviewAudio('{REF}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.0)
        E("window.switchWorkspace('scenes')")
        time.sleep(2.0)
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 800, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.2)

        def S(expr):
            return E(SAFE.replace("XXX", expr))

        print("tour present:", S("!!document.getElementById('tour-btn-skip')"), flush=True)
        print("open:", S("window.UQDrawer.open(document.getElementById('pipeline-sidebar'),"
                         " document.querySelector('#btn-toggle-sidebar')) || 'opened'"), flush=True)
        time.sleep(0.8)
        print("state:", S("({open: document.getElementById('pipeline-sidebar').classList.contains('open'),"
                          " role: document.getElementById('pipeline-sidebar').getAttribute('role'),"
                          " lock: document.body.style.overflow,"
                          " active: (document.activeElement.id || document.activeElement.tagName),"
                          " inDrawer: document.getElementById('pipeline-sidebar').contains(document.activeElement)})"), flush=True)
        print("firstBtn:", S("(() => { const f = [...document.querySelectorAll('#pipeline-sidebar button:not([disabled])')]"
                             " .filter(el => el.offsetParent !== null);"
                             " return {n: f.length, first: (f[0] && (f[0].id || f[0].textContent.trim().slice(0,20)))}; })()"), flush=True)
        print("focusFirst:", S("(() => { const f = [...document.querySelectorAll('#pipeline-sidebar button:not([disabled])')]"
                               " .filter(el => el.offsetParent !== null);"
                               " f[0].focus(); return document.activeElement === f[0]; })()"), flush=True)
        print("close:", S("window.UQDrawer.close(document.getElementById('pipeline-sidebar')) || 'closed'"), flush=True)
        time.sleep(0.3)
        print("after:", S("({open: document.getElementById('pipeline-sidebar').classList.contains('open'),"
                          " role: document.getElementById('pipeline-sidebar').getAttribute('role'),"
                          " modal: document.getElementById('pipeline-sidebar').getAttribute('aria-modal'),"
                          " lock: document.body.style.overflow,"
                          " active: (document.activeElement.id || document.activeElement.tagName)})"), flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
