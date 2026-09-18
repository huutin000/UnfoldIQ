"""Two-gate closure - GATE B: canonical 1080p-class + ACTUAL 200% page zoom.

Setup: headed Chrome --force-device-scale-factor=1 (CSS px == device px,
bypassing host 125% scaling) MAXIMIZED on the 1920x1080 physical panel ->
~1904 CSS px starting viewport at 100% page zoom. Real OS Ctrl+= x5 ->
200% -> ~952 CSS px (960 band, Si + Inspector Drawer). No emulation, no
CSS transform, no pinch, no resize-only.
Verifies: metrics battery, 2-pane+Drawer, toggle, open/close, Tab trap,
Escape, focus return, no h-scroll, focused control visible, palette fits,
4 workbenches usable.
Evidence: temp/phase06_twogate_closure/zoom1080/.
Usage: python scripts/verify_phase06_twogate_zoom1080.py
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
CDP_PORT = 9404

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
VK_TAB, VK_RETURN, VK_ESC, VK_K, VK_SHIFT = 0x09, 0x0D, 0x1B, 0x4B, 0x10


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


def os_shot(hwnd, path):
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    w, h = r.right - r.left, r.bottom - r.top
    ps = ("Add-Type -AssemblyName System.Drawing; "
          f"$b = New-Object Drawing.Bitmap({w},{h}); "
          "$g = [Drawing.Graphics]::FromImage($b); "
          f"$g.CopyFromScreen({r.left},{r.top},0,0,$b.Size); "
          f"$b.Save('{path}'); $g.Dispose(); $b.Dispose()")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                   capture_output=True, timeout=60)
    return Path(path).exists()


METRICS = """(() => { const de = document.documentElement;
  const shell = document.querySelector('.workstation-body');
  const insp = document.getElementById('workspace-inspector');
  const side = document.getElementById('pipeline-sidebar');
  return { innerW: window.innerWidth, innerH: window.innerHeight,
    dpr: window.devicePixelRatio, clientW: de.clientWidth,
    vvScale: window.visualViewport ? window.visualViewport.scale : null,
    mode: (window.UQShellMode ? window.UQShellMode() : 'n/a'),
    mm960_1279: matchMedia('(min-width: 960px) and (max-width: 1279px)').matches,
    mm1280: matchMedia('(min-width: 1280px)').matches,
    grid: shell ? getComputedStyle(shell).gridTemplateColumns : 'n/a',
    inspDisplay: insp ? getComputedStyle(insp).display : 'n/a',
    sideDisplay: side ? getComputedStyle(side).display : 'n/a',
    scrollW: de.scrollWidth, hscroll: de.scrollWidth > de.clientWidth + 1 }; })()"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rec = {}
    rec["displayPhysical"] = [user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)]
    try:
        ps = ("Get-CimInstance Win32_VideoController | Select-Object -First 1 "
              "CurrentHorizontalResolution, CurrentVerticalResolution | ConvertTo-Json")
        rec["videoController"] = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True, text=True, timeout=60).stdout.strip()[:200]
    except Exception as ex:
        rec["videoController"] = str(ex)[:150]
    try:
        ps2 = ("Get-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name LogPixels "
               "| Select-Object LogPixels | ConvertTo-Json")
        rec["logPixels"] = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps2],
            capture_output=True, text=True, timeout=60).stdout.strip()[:200]
    except Exception as ex:
        rec["logPixels"] = str(ex)[:150]

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
    prof = Path(f"temp/p6tg_z1080_{datetime.datetime.now().strftime('%H%M%S')}")
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
                ver = json.loads(urllib.request.urlopen(
                    f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=5).read())
                rec["chromeVersion"] = ver.get("Browser", "?")
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
        r = RECT()
        user32.GetClientRect(hwnd, ctypes.byref(r))
        rec["clientDevicePx"] = [r.right - r.left, r.bottom - r.top]
        kb.foreground()
        cdp.call("Page.bringToFront")
        E("window.focus();")
        time.sleep(1)

        rec["method"] = ("maximized headed Chrome --force-device-scale-factor=1 "
                         "(CSS px == device px) + REAL OS Ctrl+= page zoom; no emulation")
        rec["before"] = E(METRICS)
        rec["pageZoomBefore"] = "100% (fresh profile)"
        print("before:", json.dumps(rec["before"]), flush=True)
        assert rec["before"]["dpr"] == 1, "DPR must be 1 at 100% with force-dsf=1"
        assert rec["before"]["innerW"] >= 1850, "starting viewport must be 1080p-class"

        E("window.__al=[]; document.addEventListener('keydown', e=>window.__al.push(e.key), true);")
        kb.press(VK_ESC)
        base_dpr = E(METRICS)["dpr"]
        user32.keybd_event(VK_CTRL, user32.MapVirtualKeyW(VK_CTRL, 0), 0, 0)
        time.sleep(0.2)
        steps = 0
        for _ in range(12):
            user32.keybd_event(VK_PLUS, user32.MapVirtualKeyW(VK_PLUS, 0), 0, 0)
            time.sleep(0.15)
            user32.keybd_event(VK_PLUS, user32.MapVirtualKeyW(VK_PLUS, 0), 2, 0)
            time.sleep(1.4)
            steps += 1
            s = E(METRICS)
            print(f"step {steps}: dpr={s['dpr']} inner={s['innerW']}x{s['innerH']}", flush=True)
            if s["dpr"] and base_dpr and s["dpr"] / base_dpr >= 1.99:
                break
        user32.keybd_event(VK_CTRL, user32.MapVirtualKeyW(VK_CTRL, 0), 2, 0)
        time.sleep(1.0)
        rec["zoomSteps"] = steps
        rec["keysSeen"] = E("window.__al.join('+') || 'NONE'")
        rec["after"] = E(METRICS)
        rec["zoomFactor"] = rec["after"]["dpr"] / base_dpr
        rec["pageZoomAfter"] = "200% (5x Ctrl+=: 110/125/150/175/200)"
        rec["realZoom200"] = bool(abs(rec["zoomFactor"] - 2.0) < 0.02)
        rec["nearCanonical960"] = bool(abs(rec["after"]["innerW"] - 960) <= 12)
        print("after:", json.dumps(rec["after"]), flush=True)
        assert rec["realZoom200"], f"no 200% (factor={rec['zoomFactor']})"
        rec["osShot"] = os_shot(hwnd, str(OUT / "zoom1080_indicator.png"))

        # workbench smoke: story/voice/visual(scenes)/export (+overview)
        rec["workbenches"] = {}
        for ws in ("story", "voice", "scenes", "export", "overview"):
            E(f"window.switchWorkspace('{ws}')")
            time.sleep(1.4)
            st = E("(() => { const v = document.querySelector('.workspace-view.active');"
                   " const de = document.documentElement;"
                   " return { usable: !!v && v.innerText.length > 500,"
                   "  hscroll: de.scrollWidth > de.clientWidth + 1,"
                   "  mode: (window.UQShellMode ? window.UQShellMode() : 'n/a') }; })()")
            rec["workbenches"][ws] = st
            print(ws, json.dumps(st), flush=True)

        # drawer battery via OS keys at ~960 effective
        E("window.switchWorkspace('scenes')")
        time.sleep(1.2)
        E("if (document.activeElement) document.activeElement.blur();")
        E("window.__al=[];")
        from verify_phase06_closure_keyboard import VK_TAB as _T
        found, n, stalls = False, 0, 0
        seen = {}
        for _ in range(400):
            if E("document.activeElement === document.querySelector('#btn-toggle-inspector')"):
                found = True
                break
            b = E("window.__al.length")
            kb.press(_T, settle=0.30)
            a = E("window.__al.length")
            if not (isinstance(a, int) and isinstance(b, int) and a > b):
                stalls += 1
                if stalls > 30:
                    break
                continue
            sig = E("(document.activeElement.tagName+'#'+document.activeElement.id)")
            if not sig.startswith("BODY"):
                seen[sig] = seen.get(sig, 0) + 1
                if seen[sig] >= 3 and n > 40:
                    break
            n += 1
        rec["toggleVisible"] = bool(E("(() => { const b=document.querySelector('#btn-toggle-inspector');"
                                      " return b && getComputedStyle(b).display !== 'none'; })()"))
        rec["toggleReached"] = found
        E("window.__al=[];")
        dk = kb.press_expect(E, VK_RETURN, "Enter")
        time.sleep(0.9)
        rec["drawer"] = {
            "keyArrived": dk, "keysSeen": E("window.__al.join('+') || 'NONE'"),
            "open": bool(E("document.getElementById('workspace-inspector').classList.contains('open')")),
            "role": E("document.getElementById('workspace-inspector').getAttribute('role')"),
        }
        E("window.__al=[];")
        inside = []
        for _ in range(4):
            kb.press(_T)
            inside.append(bool(E("document.getElementById('workspace-inspector').contains(document.activeElement)")))
        kb.chord(VK_SHIFT, _T)
        inside.append(bool(E("document.getElementById('workspace-inspector').contains(document.activeElement)")))
        rec["trap"] = {"keptInside": inside, "pass": bool(all(inside)),
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
        print("drawer:", json.dumps(rec["drawer"]), "trap:", rec["trap"]["pass"],
              "esc:", json.dumps(rec["escape"]), flush=True)

        # focused control visible + palette fits
        E("window.__al=[];")
        kb.press(_T)
        rec["focusVisible"] = {
            "keysSeen": E("window.__al.join('+') || 'NONE'"),
            "inView": E("(() => { const a=document.activeElement; if(!a||!a.getBoundingClientRect) return false;"
                        " const r=a.getBoundingClientRect();"
                        " return r.bottom>0 && r.top<window.innerHeight && r.right>0 && r.left<window.innerWidth; })()")}
        kb.chord(VK_CTRL, VK_K)
        time.sleep(0.9)
        rec["palette"] = E("(() => { const d = document.querySelector('.uq-cmd-dialog');"
                           " if (!d) return {open:false};"
                           " const r = d.getBoundingClientRect();"
                           " return {open:true, fits: r.width <= window.innerWidth + 1}; })()")
        kb.press(VK_ESC)
        time.sleep(0.6)
        rec["paletteClosed"] = bool(E("!window.UQPalette.isOpen()"))

        cdp.drain()
        cerrs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        failed = [e for e in cdp.events if e.get("method") == "Network.loadingFailed"]
        reqs, bad = {}, []
        for e in cdp.events:
            m = e.get("method")
            p = e.get("params", {}) or {}
            if m == "Network.requestWillBeSent":
                reqs[p.get("requestId")] = (p.get("request") or {}).get("url", "")
            elif m == "Network.loadingFailed":
                bad.append(reqs.get(p.get("requestId"), "?") + " :: " + str(p.get("errorText", "")))
        rec["console"] = {"errors": len(cerrs), "unhandled": len(unh),
                          "loadingFailed": len(failed), "failedUrls": bad[:8]}
        (OUT / "zoom1080.json").write_text(json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
        print("console", json.dumps(rec["console"])[:300], flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
