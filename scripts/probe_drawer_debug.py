"""Debug probe: drawer trap/return/lock/resize step by step at 1000px.
Usage: python scripts/probe_drawer_debug.py
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
PROFILE = Path("temp/probe_drawer_profile")
CDP_PORT = 9371

TRAP_SEL = ('button:not([disabled]), [href], input:not([disabled]), '
            'select:not([disabled]), textarea:not([disabled]), '
            '[tabindex]:not([tabindex="-1"])')


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
        E("""(() => { const b = Array.from(document.querySelectorAll('button'))
          .find(x => (x.innerText||'').includes('Khám phá sau')); if (b) b.click(); })()""")
        time.sleep(0.8)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        E("""(() => { const a = document.getElementById('audio-player');
          if (a) { try { a.pause(); } catch (e) {} a.removeAttribute('src'); a.load(); } })()""")
        time.sleep(0.5)
        print("UQDrawer exposed:", E("typeof window.UQDrawer"), flush=True)
        print("app.js v6:", E("(() => { const s = [...document.scripts].map(x=>x.src).join('|');"
                              " return s.includes('app.js?v=6.0'); })()"), flush=True)
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1000, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.2)
        print("innerWidth:", E("window.innerWidth"), flush=True)
        # resize listener check
        E("window.__resizeCount = 0; window.addEventListener('resize', () => window.__resizeCount++)")
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1200, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.0)
        print("resize events on emulate:", E("window.__resizeCount"), flush=True)
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1000, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.2)
        # open drawer via API with explicit trigger
        print("open:", E("(() => { const t = document.querySelector('#btn-toggle-inspector');"
                         " window.UQDrawer.open(document.getElementById('workspace-inspector'), t);"
                         " return 'ok'; })()"), flush=True)
        time.sleep(0.6)
        print("state:", E("(() => { const p = document.getElementById('workspace-inspector');"
                          " return JSON.stringify({open: p.classList.contains('open'),"
                          " role: p.getAttribute('role'), modal: p.getAttribute('aria-modal'),"
                          " lock: document.body.style.overflow,"
                          " focusIn: p.contains(document.activeElement),"
                          " active: (document.activeElement||{}).id || document.activeElement.tagName}); })()"), flush=True)
        n = E(f"(() => document.querySelectorAll('#workspace-inspector {TRAP_SEL}').length)()")
        print("trap-selector focusables in drawer:", n, flush=True)
        # focus last-per-trap, Tab, observe
        print("focusLast:", E(f"(() => {{ const f = [...document.querySelectorAll('#workspace-inspector {TRAP_SEL}')]"
                              " .filter(el => el.offsetParent !== null);"
                              " f[f.length-1].focus(); return document.activeElement === f[f.length-1]; })()"), flush=True)
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Tab", "code": "Tab",
                                            "windowsVirtualKeyCode": 9, "nativeVirtualKeyCode": 9}, timeout=15)
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Tab", "code": "Tab",
                                            "windowsVirtualKeyCode": 9, "nativeVirtualKeyCode": 9}, timeout=15)
        time.sleep(0.4)
        print("afterTab:", E("(() => { const p = document.getElementById('workspace-inspector');"
                             " const f = [...p.querySelectorAll('" + TRAP_SEL + "')]"
                             " .filter(el => el.offsetParent !== null);"
                             " return JSON.stringify({inDrawer: p.contains(document.activeElement),"
                             " isFirst: document.activeElement === f[0],"
                             " active: (document.activeElement.id||document.activeElement.tagName)}); })()"), flush=True)
        # Escape
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Escape", "code": "Escape",
                                            "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27}, timeout=15)
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape", "code": "Escape",
                                            "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27}, timeout=15)
        time.sleep(0.5)
        print("afterEsc:", E("(() => { const p = document.getElementById('workspace-inspector');"
                             " const t = document.querySelector('#btn-toggle-inspector');"
                             " return JSON.stringify({closed: !p.classList.contains('open'),"
                             " onOpener: document.activeElement === t,"
                             " active: (document.activeElement.id||document.activeElement.tagName),"
                             " lock: document.body.style.overflow}); })()"), flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
