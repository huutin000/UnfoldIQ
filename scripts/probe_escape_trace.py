"""Probe: Escape-close timeline + last-element identity + window bounds.
Usage: python scripts/probe_escape_trace.py
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
PROFILE = Path("temp/probe_esc_profile")
CDP_PORT = 9375


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
        F = ('button:not([disabled]), [href], input:not([disabled]), '
             'select:not([disabled]), textarea:not([disabled]), '
             '[tabindex]:not([tabindex="-1"])')
        # last-5 identity by test predicate vs product predicate
        print(E("(() => { const p = document.getElementById('workspace-inspector');"
                " const F = '" + F + "';"
                " const byOff = [...p.querySelectorAll(F)].filter(el => el.offsetParent !== null);"
                " const byRect = [...p.querySelectorAll(F)].filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');"
                " const id = el => (el.tagName + '.' + (el.className.baseVal !== undefined ? el.className.baseVal : el.className)).slice(0,44)"
                "  + '|r=' + el.getBoundingClientRect().width.toFixed(0) + 'x' + el.getBoundingClientRect().height.toFixed(0);"
                " return JSON.stringify({nOff: byOff.length, nRect: byRect.length,"
                " lastOff: byOff.slice(-3).map(id), lastRect: byRect.slice(-3).map(id)}); })()"), flush=True)
        # open via click path (like verification)
        E("(() => { const b = document.querySelector('#btn-toggle-inspector'); b.focus(); b.click(); })()")
        time.sleep(0.8)
        print("openFocus:", E("(() => { const p = document.getElementById('workspace-inspector');"
                              " const a = document.activeElement;"
                              " return p.contains(a) + '|' + (a.id || a.tagName); })()"), flush=True)
        print("visibleModals:", E("(() => [...document.querySelectorAll('.modal-overlay')]"
                                  " .filter(m => m.style.display !== 'none' && getComputedStyle(m).display !== 'none')"
                                  " .map(m => m.id).join(',') || 'none')()"), flush=True)
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Escape", "code": "Escape",
                                            "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27}, timeout=15)
        for i, dt in enumerate((0.15, 0.5, 1.0)):
            time.sleep(dt if i == 0 else dt - (0.15 if i == 1 else 0.5))
            print(f"t+{dt}:", E("(() => { const p = document.getElementById('workspace-inspector');"
                                " const a = document.activeElement;"
                                " return JSON.stringify({closed: !p.classList.contains('open'),"
                                " role: p.getAttribute('role'), lock: document.body.style.overflow,"
                                " active: (a.id || a.tagName)}); })()"), flush=True)
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape", "code": "Escape",
                                            "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27}, timeout=15)
        # window bounds round-trip
        bcdp = CDP(ver["webSocketDebuggerUrl"])
        page_id = next(t.get("id") for t in tg if t.get("type") == "page")
        win = bcdp.call("Browser.getWindowForTarget", {"targetId": page_id}).get("windowId")
        print("winBounds0:", bcdp.call("Browser.getWindowBounds", {"windowId": win}).get("bounds"), flush=True)
        for outer in (1100, 1300):
            try:
                bcdp.call("Browser.setWindowBounds", {"windowId": win, "bounds": {"width": outer, "height": 800}})
                time.sleep(1.5)
                print(f"after set {outer}:", bcdp.call("Browser.getWindowBounds", {"windowId": win}).get("bounds"),
                      "inner:", E("window.innerWidth"), flush=True)
            except Exception as ex:
                print(f"set {outer} err:", str(ex)[:120], flush=True)
        bcdp.ws.close()
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
