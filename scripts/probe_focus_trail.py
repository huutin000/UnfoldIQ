"""Probe: focus trail around drawer Escape-close.
Usage: python scripts/probe_focus_trail.py
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
PROFILE = Path("temp/probe_trail_profile")
CDP_PORT = 9379


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
        E("window.__flog = []; window.__t0 = performance.now();"
          "document.addEventListener('focusin', e => {"
          " const a = e.target;"
          " window.__flog.push(Math.round(performance.now() - window.__t0) + 'ms:'"
          "  + (a.id || a.tagName) + ':' + (a.className.baseVal !== undefined ? a.className.baseVal : a.className).toString().slice(0,30));"
          " }, true);"
          "window.__klog = [];"
          "document.addEventListener('keydown', e => {"
          " window.__klog.push(Math.round(performance.now() - window.__t0) + 'ms:' + e.key);"
          " }, true);"
          "window.__alive = []; document.addEventListener('keydown',"
          " e => window.__alive.push(e.key), true);")
        # input-alive gate
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "F1", "code": "F1",
                                            "windowsVirtualKeyCode": 112,
                                            "nativeVirtualKeyCode": 112, "modifiers": 0}, timeout=15)
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "F1", "code": "F1",
                                            "windowsVirtualKeyCode": 112,
                                            "nativeVirtualKeyCode": 112, "modifiers": 0}, timeout=15)
        time.sleep(0.4)
        alive = E("window.__alive.join(',')")
        print("input_alive:", alive, flush=True)
        if alive != "F1":
            print("INPUT DEAD - aborting probe", flush=True)
            return
        E("(() => { const b = document.querySelector('#btn-toggle-sidebar'); b.focus(); b.click(); })()")
        time.sleep(1.0)
        print("trail-open:", E("window.__flog.join(' | ')"), flush=True)
        print("keys-open:", E("window.__klog.join(' | ') || 'none'"), flush=True)
        E("window.__flog = []; window.__t0 = performance.now(); window.__klog = [];")
        for t in ("rawKeyDown", "keyUp"):
            cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "Escape", "code": "Escape",
                                                "windowsVirtualKeyCode": 27,
                                                "nativeVirtualKeyCode": 27, "modifiers": 0}, timeout=15)
        time.sleep(0.8)
        print("trail-esc:", E("window.__flog.join(' | ') || 'NOFOCUSCHANGE'"), flush=True)
        print("keys-esc:", E("window.__klog.join(' | ') || 'NOKEYS'"), flush=True)
        print("overlays:", E("(() => { const vis = s => { const el = document.querySelector(s);"
                             " return el ? (getComputedStyle(el).display !== 'none' && el.style.display !== 'none') : 'missing'; };"
                             " return JSON.stringify({vb: vis('#visual-bible-modal'), help: vis('#contextual-help-modal'),"
                             " lightbox: !!document.querySelector('#ui-lightbox.open'),"
                             " palette: !!document.querySelector('.uq-cmd-backdrop'),"
                             " tourSkip: (() => { const s = document.getElementById('tour-btn-skip');"
                             "  return s ? (s.offsetParent !== null) : 'missing'; })()}); })()"), flush=True)
        print("state:", E("(() => { const p = document.getElementById('pipeline-sidebar');"
                          " return JSON.stringify({closed: !p.classList.contains('open'),"
                          " role: p.getAttribute('role'), lock: document.body.style.overflow,"
                          " active: ((a => a.id || a.tagName)(document.activeElement))}); })()"), flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
