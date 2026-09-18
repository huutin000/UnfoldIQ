"""Probe: zero-height focusable listbox container."""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for

PORT = 9386


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
    Path("temp/probe_listbox_profile").mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen(
        [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
         f"--remote-debugging-port={PORT}",
         "--user-data-dir=" + str(Path("temp/probe_listbox_profile").resolve()),
         "--no-first-run", "--no-default-browser-check",
         "--window-size=1440,900", "about:blank"], stderr=subprocess.DEVNULL)
    try:
        for _ in range(30):
            time.sleep(1)
            try:
                json.loads(urllib.request.urlopen(
                    f"http://127.0.0.1:{PORT}/json/version", timeout=5).read())
                break
            except Exception:
                continue
        tg = json.loads(urllib.request.urlopen(
            f"http://127.0.0.1:{PORT}/json/list", timeout=10).read())
        pt = next(t for t in tg if t.get("type") == "page")
        cdp = CDP(pt["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        E = cdp.evaluate
        cdp.call("Page.navigate", {"url": "http://127.0.0.1:7860"})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E("(() => { try { localStorage.setItem('unfoldiq.onboarding.v2', JSON.stringify({"
          " schemaVersion: 2, meta: {welcome: 'dismissed', migratedFromLegacy: true},"
          " tours: {'product-overview': {status: 'dismissed'}, 'content-basics': {status: 'dismissed'},"
          " 'scene-visual-basics': {status: 'dismissed'}, 'studio-basics': {status: 'dismissed'},"
          " 'review-basics': {status: 'dismissed'}, 'export-basics': {status: 'dismissed'},"
          " 'visual-bible-basics': {status: 'dismissed'}} })); } catch (e) {} return 1; })()")
        cdp.call("Page.navigate", {"url": "http://127.0.0.1:7860"})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E("window.loadPreviewAudio('2026-09-12_210003_youtube-narration-01',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.5)
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})
        cdp.call("Emulation.setTouchEmulationEnabled", {"enabled": True})
        time.sleep(1.5)
        E("window.switchWorkspace('scenes')")
        time.sleep(2.0)
        for ww in (1440, 390):
            cdp.call("Emulation.setDeviceMetricsOverride",
                     {"width": ww, "height": 844, "deviceScaleFactor": 1, "mobile": False})
            time.sleep(1.5)
            E("window.switchWorkspace('scenes')")
            time.sleep(1.5)
            print("W=" + str(ww), E("(function(){ const c = document.getElementById('sp-rows-container');"
                " const chain = []; let el = c;"
                " for (let i = 0; i < 6 && el && el !== document.body; i++) {"
                "  const cs = getComputedStyle(el); const b = el.getBoundingClientRect();"
                "  chain.push(((el.id && '#' + el.id) || el.tagName) + '.' + (el.className.baseVal !== undefined ? el.className.baseVal : el.className).toString().split(' ')[0]"
                "   + ' d=' + cs.display + ' h=' + Math.round(b.height) + ' mh=' + cs.minHeight + ' flex=' + cs.flex.slice(0,14));"
                "  el = el.parentElement; }"
                " return JSON.stringify({contH: Math.round(c.getBoundingClientRect().height), chain: chain}); })()"), flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
