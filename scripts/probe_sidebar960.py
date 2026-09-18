"""Probe: what is 250px wide at ~960 + trap-item visibility.
Usage: python scripts/probe_sidebar960.py
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
PROFILE = Path("temp/probe_sb960_profile")
CDP_PORT = 9374


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
        time.sleep(1.5)
        for w in (1024, 960, 959):
            cdp.call("Emulation.setDeviceMetricsOverride",
                     {"width": w, "height": 768, "deviceScaleFactor": 1, "mobile": False})
            time.sleep(1.2)
            print(E("(() => { const sb = document.getElementById('pipeline-sidebar');"
                    " const r = sb.getBoundingClientRect();"
                    " const cs = getComputedStyle(sb);"
                    " return JSON.stringify({req: " + str(w) + ", innerW: window.innerWidth,"
                    " sbW: Math.round(r.width), sbX: Math.round(r.x),"
                    " pos: cs.position, transform: cs.transform,"
                    " grid: getComputedStyle(document.querySelector('.workstation-body')).gridTemplateColumns,"
                    " kids: [...sb.children].map(c => c.className + ':' + Math.round(c.getBoundingClientRect().width)).join('|').slice(0,220)}); })()"), flush=True)
        # trap items visibility in inspector drawer at 800
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 800, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.0)
        E("window.UQDrawer.open(document.getElementById('workspace-inspector'), document.querySelector('#btn-toggle-inspector'))")
        time.sleep(0.6)
        print(E("(() => { const F = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])';"
                " const f = [...document.querySelectorAll('#workspace-inspector ' + F)];"
                " return JSON.stringify({n: f.length,"
                " hidden: f.filter(el => el.offsetParent === null).length,"
                " visHidden: f.filter(el => el.offsetParent !== null && getComputedStyle(el).visibility === 'hidden').length,"
                " first3: f.slice(0,3).map(el => (el.tagName + '.' + el.className).slice(0,40) + '|vis=' + getComputedStyle(el).visibility + '|op=' + (el.offsetParent!==null)),"
                " last3: f.slice(-3).map(el => (el.tagName + '.' + el.className).slice(0,40) + '|vis=' + getComputedStyle(el).visibility + '|op=' + (el.offsetParent!==null))}); })()"), flush=True)
        print("tourEls:", E("(() => [...document.querySelectorAll('[id^=tour],[class*=tour]')].map(e=>e.id||e.className).join(',').slice(0,200))()"), flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
