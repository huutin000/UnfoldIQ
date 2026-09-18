"""Probe: nav datasets, Enter receipt, :focus-visible match, toggle-close."""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for

PORT = 9388


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
    Path("temp/probe_kb_profile").mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen(
        [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
         f"--remote-debugging-port={PORT}",
         "--user-data-dir=" + str(Path("temp/probe_kb_profile").resolve()),
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
            f"http://127.0.0.1:{PORT}/json/list",
            timeout=10).read())
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
        time.sleep(2.0)

        def key(name, code, vk, mod=0):
            for t in ("rawKeyDown", "keyUp"):
                cdp.call("Input.dispatchKeyEvent", {"type": t, "key": name, "code": code,
                                                    "windowsVirtualKeyCode": vk,
                                                    "nativeVirtualKeyCode": vk, "modifiers": mod}, timeout=15)
            time.sleep(0.4)

        print("navDatasets:", E("(function(){ return JSON.stringify("
                                " [...document.querySelectorAll('.pipeline-nav .nav-item')]"
                                " .map(b => b.tagName + ':' + b.dataset.workspace + ':'"
                                " + (b.disabled ? 'dis' : 'en'))); })()"), flush=True)
        # click-receipt listener to separate focus-fail vs enter-fail
        E("window.__clicked = []; document.addEventListener('click',"
          " e => window.__clicked.push((e.target.id || e.target.tagName) + ':' + (e.target.dataset && e.target.dataset.workspace || '')), true);")
        E("(function(){ const b = [...document.querySelectorAll('.pipeline-nav .nav-item')]"
          ".find(x => x.dataset.workspace === 'voice'); if (b) b.focus();"
          " return (document.activeElement === b) + ''; })()")
        time.sleep(0.3)
        print("focusedVoice:", E("(function(){ const a = document.activeElement;"
                                 " return (a.tagName + ':' + (a.dataset && a.dataset.workspace)); })()"), flush=True)
        key("Enter", "Enter", 13)
        print("clicked:", E("window.__clicked.join('>') || 'NONE'"), flush=True)
        print("voiceActive:", E("document.getElementById('ws-voice').classList.contains('active')"), flush=True)
        # focus-visible match on real Tab focus
        E("(function(){ if (document.activeElement) document.activeElement.blur(); })()")
        key("Tab", "Tab", 9)
        print("tabFV:", E("(function(){ const a = document.activeElement; if (!a) return 'none';"
                          " let m = false; try { m = a.matches(':focus-visible'); } catch (e) {}"
                          " const cs = getComputedStyle(a);"
                          " return JSON.stringify({tag: a.tagName, fv: m,"
                          "  outline: cs.outlineWidth + '/' + cs.outlineStyle,"
                          "  shadow: (cs.boxShadow || 'none').slice(0,60)}); })()"), flush=True)
        # toggle-close via click while open (narrow)
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 800, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.2)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        E("document.querySelector('#btn-toggle-inspector').click()")
        time.sleep(0.6)
        print("opened:", E("document.getElementById('workspace-inspector').classList.contains('open')"), flush=True)
        E("document.querySelector('#btn-toggle-inspector').click()")
        time.sleep(0.6)
        print("toggleClosed:", E("(function(){ const p = document.getElementById('workspace-inspector');"
                                 " return JSON.stringify({closed: !p.classList.contains('open'),"
                                 " roleGone: !p.getAttribute('role'),"
                                 " lock: document.body.style.overflow,"
                                 " active: ((a => a.id || a.tagName)(document.activeElement))}); })()"), flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
