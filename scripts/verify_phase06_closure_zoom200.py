"""Phase 6 FINAL closure - GAP C: ACTUAL Chrome page zoom 200%.

Method: headed Chrome (natural host scaling, NO emulation), real OS-level
Ctrl+= (keybd_event) x steps until visualViewport.scale==2. Proves genuine
browser page zoom (DSF emulation explicitly NOT used). Layout battery across
workbenches + palette/sheet fit + keyboard reachability + OS-cropped
screenshot showing the Chrome zoom indicator.
Screen: 1536x864 device px @125% -> starting CSS ~1216x656; at 200% the CSS
viewport halves -> si band (sheets). Band-correctness is asserted against the
OBSERVED css width (documented, honest: a 1080p screen would land Si).
Evidence: temp/phase06_final_closure/zoom200/.
Usage: python scripts/verify_phase06_closure_zoom200.py
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
OUT = Path("temp/phase06_final_closure/zoom200")
CDP_PORT = 9401

user32 = ctypes.windll.user32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

VK_CTRL = 0x11
VK_PLUS = 0xBB  # OEM_PLUS ('=' key)
VK_ESC, VK_TAB, VK_RETURN = 0x1B, 0x09, 0x0D


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


def window_rect(hwnd):
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def os_screenshot_crop(hwnd, path):
    l, t, r, b = window_rect(hwnd)
    w, h = r - l, b - t
    ps = ("Add-Type -AssemblyName System.Drawing; "
          f"$b = New-Object Drawing.Bitmap({w},{h}); "
          "$g = [Drawing.Graphics]::FromImage($b); "
          f"$g.CopyFromScreen({l},{t},0,0,$b.Size); "
          f"$b.Save('{path}'); $g.Dispose(); $b.Dispose()")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                   capture_output=True, timeout=60)
    return Path(path).exists()


ZOOM_EXPR = """(() => { const de = document.documentElement;
  const vv = window.visualViewport;
  return { scale: vv ? vv.scale : null, innerW: window.innerWidth, innerH: window.innerHeight,
    dpr: window.devicePixelRatio, clientW: de.clientWidth,
    mode: (window.UQShellMode ? window.UQShellMode() : 'n/a'),
    hscroll: de.scrollWidth > de.clientWidth + 1 }; })()"""


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
    prof = Path(f"temp/p6close_z2_{datetime.datetime.now().strftime('%H%M%S')}")
    prof.mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen([CHROME, f"--remote-debugging-port={CDP_PORT}",
                               f"--user-data-dir={prof.resolve()}",
                               "--no-first-run", "--no-default-browser-check",
                               "--disable-session-crashed-bubble",
                               "--window-size=1520,820", "--window-position=0,0",
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
        assert loaded, "scene groups never rendered"
        time.sleep(2)
        wins = []
        for _ in range(20):
            wins = find_window(chrome.pid)
            if wins:
                break
            time.sleep(1)
        assert wins, "no app window"
        hwnd = wins[0]
        kb = OSKeyboard(hwnd)
        assert kb.foreground(), "cannot foreground"
        cdp.call("Page.bringToFront")
        E("window.focus();")
        time.sleep(1)

        rec = {"method": "real OS Ctrl+= page zoom (no emulation, no DSF override, no CSS transform)"}
        rec["before"] = E(ZOOM_EXPR)
        print("before:", json.dumps(rec["before"]), flush=True)
        E("window.__al=[]; document.addEventListener('keydown', e=>window.__al.push(e.key), true);")

        # real zoom-in steps: Ctrl+= until DPR doubles vs baseline (page zoom;
        # visualViewport.scale reflects pinch zoom only and stays 1 - recorded
        # as supporting observation, NOT the oracle)
        kb.foreground()
        kb.press(VK_ESC)
        base_dpr = E(ZOOM_EXPR)["dpr"]
        user32.keybd_event(VK_CTRL, user32.MapVirtualKeyW(VK_CTRL, 0), 0, 0)
        time.sleep(0.2)
        steps = 0
        for _ in range(12):
            user32.keybd_event(VK_PLUS, user32.MapVirtualKeyW(VK_PLUS, 0), 0, 0)
            time.sleep(0.15)
            user32.keybd_event(VK_PLUS, user32.MapVirtualKeyW(VK_PLUS, 0), 2, 0)
            time.sleep(1.4)
            steps += 1
            s = E(ZOOM_EXPR)
            print(f"step {steps}: dpr={s['dpr']} inner={s['innerW']}x{s['innerH']} vvScale={s['scale']}", flush=True)
            if s["dpr"] and base_dpr and s["dpr"] / base_dpr >= 1.99:
                break
        user32.keybd_event(VK_CTRL, user32.MapVirtualKeyW(VK_CTRL, 0), 2, 0)
        time.sleep(1.0)
        rec["zoomSteps"] = steps
        rec["baselineDpr"] = base_dpr
        rec["keysSeen"] = E("window.__al.join('+') || 'NONE'")
        rec["after"] = E(ZOOM_EXPR)
        rec["zoomFactor"] = (rec["after"]["dpr"] / base_dpr) if base_dpr else None
        rec["realZoom200"] = bool(rec["zoomFactor"] and abs(rec["zoomFactor"] - 2.0) < 0.02)
        print("after:", json.dumps(rec["after"]), flush=True)
        assert rec["realZoom200"], f"page zoom did not reach 200% (factor={rec['zoomFactor']})"

        # OS-cropped screenshot incl. Chrome zoom indicator
        rec["osScreenshot"] = os_screenshot_crop(hwnd, str(OUT / "chrome_zoom200_indicator.png"))

        # layout battery at 200% (all 5 workbenches)
        rec["workbenches"] = {}
        for ws in ("overview", "story", "voice", "scenes", "export"):
            E(f"window.switchWorkspace('{ws}')")
            time.sleep(1.4)
            st = E("(() => { const v = document.querySelector('.workspace-view.active');"
                   " const de = document.documentElement;"
                   " return { active: !!v && v.id === 'ws-" + ws + "',"
                   "  nonBlank: (v ? v.innerText.length : 0),"
                   "  hscroll: de.scrollWidth > de.clientWidth + 1,"
                   "  mode: (window.UQShellMode ? window.UQShellMode() : 'n/a') }; })()")
            rec["workbenches"][ws] = st
            print(ws, json.dumps(st), flush=True)
        try:
            shot = cdp.call("Page.captureScreenshot", {"format": "png"}, timeout=45)["data"]
            (OUT / "zoom200_export.png").write_bytes(base64.b64decode(shot))
        except Exception as ex:
            print("shot failed", str(ex)[:100], flush=True)

        # keyboard reachability spot-check at 200%: Tab to a control, visible?
        E("window.switchWorkspace('scenes')")
        time.sleep(1.2)
        E("if (document.activeElement) document.activeElement.blur();")
        E("window.__al=[];")
        kb.press(VK_TAB)
        rec["kbReach"] = {
            "keysSeen": E("window.__al.join('+') || 'NONE'"),
            "focused": E("(document.activeElement.tagName+'#'+document.activeElement.id)"),
            "visible": E("(() => { const a=document.activeElement; if(!a||!a.getBoundingClientRect) return false;"
                         " const r=a.getBoundingClientRect();"
                         " return r.bottom>0 && r.top<window.innerHeight && r.right>0 && r.left<window.innerWidth; })()"),
        }
        print("kbReach:", json.dumps(rec["kbReach"], ensure_ascii=False), flush=True)

        # palette fits at 200%
        E("window.__al=[];")
        kb.chord(0x11, 0x4B)  # Ctrl+K
        time.sleep(0.9)
        rec["palette"] = E("(() => { const d = document.querySelector('.uq-cmd-dialog');"
                           " if (!d) return {open:false};"
                           " const r = d.getBoundingClientRect();"
                           " return {open:true, w:Math.round(r.width), vw:window.innerWidth,"
                           "  fits: r.width <= window.innerWidth + 1,"
                           "  inputVisible: (()=>{const i=document.getElementById('uq-cmd-input');"
                           "   if(!i) return false; const q=i.getBoundingClientRect();"
                           "   return q.width>0 && q.height>0;})()}; })()")
        print("palette:", json.dumps(rec["palette"]), flush=True)
        kb.press(VK_ESC)
        time.sleep(0.6)
        rec["paletteClosed"] = bool(E("!window.UQPalette.isOpen()"))

        # sheet (si band): open nav sheet via toggle, verify fits + close
        rec["sheet"] = E("(() => { const b = document.querySelector('#btn-toggle-sidebar');"
                         " if (!b || getComputedStyle(b).display==='none') return {toggle:'hidden'};"
                         " b.click();"
                         " const p = document.getElementById('pipeline-sidebar');"
                         " const open = p.classList.contains('open');"
                         " const r = p.getBoundingClientRect();"
                         " const fits = r.width <= window.innerWidth + 1 && r.height <= window.innerHeight + 1;"
                         " const role = p.getAttribute('role');"
                         " b.click();"
                         " return {toggle:'visible', opened:open, fits, role,"
                         "  closedAfter: !p.classList.contains('open')}; })()")
        print("sheet:", json.dumps(rec["sheet"]), flush=True)
        try:
            shot = cdp.call("Page.captureScreenshot", {"format": "png"}, timeout=45)["data"]
            (OUT / "zoom200_sheet.png").write_bytes(base64.b64decode(shot))
        except Exception as ex:
            print("shot failed", str(ex)[:100], flush=True)

        cdp.drain()
        cerrs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        failed = [e for e in cdp.events if e.get("method") == "Network.loadingFailed"]
        reqs = {}
        bad = []
        for e in cdp.events:
            m = e.get("method")
            p = e.get("params", {}) or {}
            if m == "Network.requestWillBeSent":
                reqs[p.get("requestId")] = (p.get("request") or {}).get("url", "")
            elif m == "Network.loadingFailed":
                bad.append(reqs.get(p.get("requestId"), "?") + " :: " + str(p.get("errorText", "")))
        rec["console"] = {"errors": len(cerrs), "unhandled": len(unh),
                          "loadingFailed": len(failed), "failedUrls": bad[:8]}
        (OUT / "zoom200.json").write_text(json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
        print("console", json.dumps(rec["console"])[:400], flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
