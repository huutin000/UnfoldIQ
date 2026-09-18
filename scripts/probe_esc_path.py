"""Probe: trace Escape keydown propagation for drawer-close.
Usage: python scripts/probe_esc_path.py
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
PROFILE = Path("temp/probe_escp_profile")
CDP_PORT = 9376


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
        time.sleep(1.0)
        E("window.__escLog = [];"
          "document.addEventListener('keydown', e => {"
          " window.__escLog.push('doc:' + e.key + ':' + (e.target.id || e.target.tagName));"
          " }, true);"
          "document.getElementById('workspace-inspector').addEventListener('keydown', e => {"
          " window.__escLog.push('drawer:' + e.key); });")
        print("dispatchResult:", cdp.call(
            "Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "F1", "code": "F1",
                                       "windowsVirtualKeyCode": 112, "nativeVirtualKeyCode": 112},
            timeout=15), flush=True)
        time.sleep(0.4)
        print("f1log:", E("window.__escLog.join(' > ') || 'EMPTY'"), flush=True)
        # click into page (mouse still works?) then keyDown-type Escape
        print("click:", cdp.call(
            "Input.dispatchMouseEvent", {"type": "mousePressed", "x": 400, "y": 300,
                                         "button": "left", "clickCount": 1},
            timeout=15), flush=True)
        print("clickR:", cdp.call(
            "Input.dispatchMouseEvent", {"type": "mouseReleased", "x": 400, "y": 300,
                                         "button": "left", "clickCount": 1},
            timeout=15), flush=True)
        time.sleep(0.4)
        print("keyDownType:", cdp.call(
            "Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape", "code": "Escape",
                                       "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27},
            timeout=15), flush=True)
        time.sleep(0.4)
        print("kdLog:", E("window.__escLog.join(' > ') || 'EMPTY'"), flush=True)
        E("(() => { const b = document.querySelector('#btn-toggle-inspector'); b.focus(); b.click(); })()")
        time.sleep(0.8)
        print("focus:", E("(() => { const a = document.activeElement;"
                          " return document.getElementById('workspace-inspector').contains(a) + '|' + (a.id || a.tagName); })()"), flush=True)
        # (a) Tab should always log
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Tab", "code": "Tab",
                                            "windowsVirtualKeyCode": 9, "nativeVirtualKeyCode": 9}, timeout=15)
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Tab", "code": "Tab",
                                            "windowsVirtualKeyCode": 9, "nativeVirtualKeyCode": 9}, timeout=15)
        time.sleep(0.4)
        print("afterTab log:", E("window.__escLog.join(' > ')"), flush=True)
        # (b) Escape with focus inside
        E("window.__escLog = [];")
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Escape", "code": "Escape",
                                            "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27}, timeout=15)
        time.sleep(0.6)
        print("escIn log:", E("window.__escLog.join(' > ')"), flush=True)
        print("stateIn:", E("(() => { const p = document.getElementById('workspace-inspector');"
                            " return JSON.stringify({closed: !p.classList.contains('open'),"
                            " active: ((a => a.id || a.tagName)(document.activeElement))}); })()"), flush=True)
        # (c) move focus out, Escape again
        E("window.__escLog = []; document.querySelector('#btn-toggle-inspector').focus();")
        time.sleep(0.3)
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Escape", "code": "Escape",
                                            "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27}, timeout=15)
        time.sleep(0.6)
        print("escOut log:", E("window.__escLog.join(' > ')"), flush=True)
        print("stateOut:", E("(() => { const p = document.getElementById('workspace-inspector');"
                             " return JSON.stringify({closed: !p.classList.contains('open'),"
                             " role: p.getAttribute('role'), lock: document.body.style.overflow,"
                             " active: ((a => a.id || a.tagName)(document.activeElement))}); })()"), flush=True)
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape", "code": "Escape",
                                            "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27}, timeout=15)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
