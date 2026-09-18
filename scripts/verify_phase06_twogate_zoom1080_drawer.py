"""Two-gate closure GATE B supplement: drawer battery at real 200% (~961 CSS).

Same genuine setup (maximized --force-device-scale-factor=1 + OS Ctrl+=),
then deterministic drawer test: blur-from-top Tab search with stall refocus,
Enter-open, Tab-trap, Escape, focus-return. Honest SKIP if drawer won't open.
Evidence: temp/phase06_twogate_closure/zoom1080/drawer supplement keys.
Usage: python scripts/verify_phase06_twogate_zoom1080_drawer.py
"""
import base64
import ctypes
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for
from verify_phase06_closure_keyboard import OSKeyboard, find_window

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP = "http://127.0.0.1:7860"
REF = "2026-09-12_210003_youtube-narration-01"
OUT = Path("temp/phase06_twogate_closure/zoom1080")
CDP_PORT = 9405

user32 = ctypes.windll.user32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

SW_MAXIMIZE = 3
VK_CTRL, VK_PLUS = 0x11, 0xBB
VK_TAB, VK_RETURN, VK_ESC, VK_SHIFT = 0x09, 0x0D, 0x1B, 0x10


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    import socket
    srv, started = None, False
    if socket.socket().connect_ex(("127.0.0.1", 7860)) != 0:
        srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "studio.app:app",
                                "--host", "127.0.0.1", "--port", "7860"],
                               cwd=str(Path(__file__).resolve().parents[1]),
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            time.sleep(1)
            if socket.socket().connect_ex(("127.0.0.1", 7860)) == 0:
                break
        started = True
        time.sleep(10)
    import datetime
    prof = Path(f"temp/p6tg_zd_{datetime.datetime.now().strftime('%H%M%S')}")
    prof.mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen([CHROME, f"--remote-debugging-port={CDP_PORT}",
                               f"--user-data-dir={prof.resolve()}",
                               "--no-first-run", "--no-default-browser-check",
                               "--disable-session-crashed-bubble",
                               "--force-device-scale-factor=1",
                               "--window-size=1900,1000", "--window-position=0,0",
                               "about:blank"], stderr=subprocess.DEVNULL)
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
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        cdp.call("Log.enable")
        cdp.call("Network.enable")
        E = cdp.evaluate
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E("(() => { try { localStorage.setItem('unfoldiq.onboarding.v2', JSON.stringify({"
          " schemaVersion: 2, meta: {welcome: 'dismissed', migratedFromLegacy: true},"
          " tours: {'product-overview': {status: 'dismissed'}, 'content-basics': {status: 'dismissed'},"
          " 'scene-visual-basics': {status: 'dismissed'}, 'studio-basics': {status: 'dismissed'},"
          " 'review-basics': {status: 'dismissed'}, 'export-basics': {status: 'dismissed'},"
          " 'visual-bible-basics': {status: 'dismissed'}} })); } catch (e) {} return 1; })()")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        assert wait_for(cdp, "typeof window.loadPreviewAudio==='function'", 60)
        loaded = False
        for _ in range(3):
            E(f"window.loadPreviewAudio('{REF}',665.64,false)")
            if wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 60):
                loaded = True
                break
            time.sleep(5)
        assert loaded
        time.sleep(2)
        wins = []
        for _ in range(20):
            wins = find_window(chrome.pid)
            if wins:
                break
            time.sleep(1)
        assert wins
        hwnd = wins[0]
        kb = OSKeyboard(hwnd)
        user32.ShowWindow(hwnd, SW_MAXIMIZE)
        time.sleep(1.5)
        kb.foreground()
        cdp.call("Page.bringToFront")
        E("window.focus();")
        time.sleep(1)

        rec = {}
        rec["startMetrics"] = E("({innerW: window.innerWidth, dpr: window.devicePixelRatio})")
        user32.keybd_event(VK_CTRL, user32.MapVirtualKeyW(VK_CTRL, 0), 0, 0)
        time.sleep(0.2)
        for _ in range(12):
            user32.keybd_event(VK_PLUS, user32.MapVirtualKeyW(VK_PLUS, 0), 0, 0)
            time.sleep(0.15)
            user32.keybd_event(VK_PLUS, user32.MapVirtualKeyW(VK_PLUS, 0), 2, 0)
            time.sleep(1.4)
            s = E("({dpr: window.devicePixelRatio, innerW: window.innerWidth})")
            if s["dpr"] and s["dpr"] >= 1.99:
                break
        user32.keybd_event(VK_CTRL, user32.MapVirtualKeyW(VK_CTRL, 0), 2, 0)
        time.sleep(1.0)
        rec["zoomedMetrics"] = E("({innerW: window.innerWidth, innerH: window.innerHeight,"
                                 " dpr: window.devicePixelRatio,"
                                 " mode: window.UQShellMode(),"
                                 " mm: matchMedia('(min-width: 960px) and (max-width: 1279px)').matches})")
        print("zoomed:", json.dumps(rec["zoomedMetrics"]), flush=True)
        assert rec["zoomedMetrics"]["dpr"] >= 1.99, "zoom failed"

        E("window.switchWorkspace('scenes')")
        time.sleep(1.5)
        # deterministic search: blur first, then Tab from top
        E("if (document.activeElement) document.activeElement.blur();")
        E("window.__al=[]; document.addEventListener('keydown', e=>window.__al.push(e.key), true);")
        found, n, stalls = False, 0, 0
        seen = {}
        for _ in range(700):
            if E("document.activeElement === document.querySelector('#btn-toggle-inspector')"):
                found = True
                break
            b = E("window.__al.length")
            kb.press(VK_TAB, settle=0.30)
            a = E("window.__al.length")
            if not (isinstance(a, int) and isinstance(b, int) and a > b):
                stalls += 1
                if stalls % 5 == 0:
                    try:
                        kb.foreground()
                        cdp.call("Page.bringToFront")
                        E("window.focus();")
                    except Exception:
                        pass
                if stalls > 40:
                    break
                continue
            sig = E("(() => { const a = document.activeElement; if (!a) return 'none';"
                    " return (a.tagName + '#' + (a.id || '') + ':' + ((a.dataset && a.dataset.workspace) || (a.dataset && a.dataset.shotId) || (a.dataset && a.dataset.sceneId) || '')"
                    " + ':' + ((a.getAttribute('aria-label') || a.innerText || '').trim().replace(/\\s+/g,' ').slice(0,30))); })()")
            if not sig.startswith("BODY"):
                seen[sig] = seen.get(sig, 0) + 1
                if seen[sig] >= 3 and n > 60:
                    break
            n += 1
        rec["reach"] = {"found": found, "tabs": n, "stalls": stalls,
                        "focused": E("(document.activeElement.tagName+'#'+document.activeElement.id)")}
        print("reach:", json.dumps(rec["reach"], ensure_ascii=False), flush=True)
        E("window.__al=[];")
        dk = kb.press_expect(E, VK_RETURN, "Enter")
        time.sleep(0.9)
        rec["open"] = {"keyArrived": dk, "keysSeen": E("window.__al.join('+') || 'NONE'"),
                       "open": bool(E("document.getElementById('workspace-inspector').classList.contains('open')")),
                       "role": E("document.getElementById('workspace-inspector').getAttribute('role')")}
        print("open:", json.dumps(rec["open"]), flush=True)
        E("window.__al=[];")
        inside = []
        if rec["open"]["open"]:
            for _ in range(4):
                kb.press(VK_TAB)
                inside.append(bool(E("document.getElementById('workspace-inspector').contains(document.activeElement)")))
            kb.chord(VK_SHIFT, VK_TAB)
            inside.append(bool(E("document.getElementById('workspace-inspector').contains(document.activeElement)")))
        rec["trap"] = {"keptInside": inside, "pass": bool(inside and all(inside)),
                       "skipped": not rec["open"]["open"],
                       "keysSeen": E("window.__al.join('+') || 'NONE'")}
        try:
            shot = cdp.call("Page.captureScreenshot", {"format": "png"}, timeout=45)["data"]
            (OUT / "zoom1080_drawer.png").write_bytes(base64.b64decode(shot))
        except Exception as ex:
            print("shot failed", str(ex)[:100], flush=True)
        E("window.__al=[];")
        kb.press(VK_ESC)
        time.sleep(0.7)
        rec["escape"] = {"keysSeen": E("window.__al.join('+') || 'NONE'"),
                         "closed": bool(E("!document.getElementById('workspace-inspector').classList.contains('open')")),
                         "focusReturn": bool(E("document.activeElement === document.querySelector('#btn-toggle-inspector')"))}
        print("trap:", rec["trap"]["pass"], "esc:", json.dumps(rec["escape"]), flush=True)
        cdp.drain()
        cerrs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        rec["console"] = {"errors": len(cerrs), "unhandled": len(unh)}
        (OUT / "zoom1080_drawer.json").write_text(
            json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
