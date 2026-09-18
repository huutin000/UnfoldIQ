"""Phase 6 FINAL closure - GAP D (part 2): exact breakpoints via REAL integral
viewports. Headed Chrome with --force-device-scale-factor=1 (CSS px == device
px, bypassing host 125% scaling); Win32 MoveWindow sizes the window until the
CLIENT width is exactly 1279/1280/959/960. No CDP emulation. Verifies
innerWidth/clientWidth/fractional truth/matchMedia/mode/grid/panels/toggles.
Evidence: temp/phase06_final_closure/breakpoints/.
Usage: python scripts/verify_phase06_closure_breakpoints_real.py
"""
import base64
import ctypes
import json
import subprocess
import sys
import time
import urllib.request
from ctypes import wintypes
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP = "http://127.0.0.1:7860"
REF = "2026-09-12_210003_youtube-narration-01"
OUT = Path("temp/phase06_final_closure/breakpoints")
CDP_PORT = 9399
WIDTHS = [1280, 1279, 960, 959]

user32 = ctypes.windll.user32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # per-monitor aware: Win32 px == device px
except Exception:
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass


def find_window(pid):
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def cb(hwnd, _):
        wpid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
        if wpid.value == pid and user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if buf.value and "UnfoldIQ" in buf.value:
                found.append(hwnd)
        return True

    user32.EnumWindows(cb, 0)
    return found


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


def client_width(hwnd):
    r = RECT()
    user32.GetClientRect(hwnd, ctypes.byref(r))
    return r.right - r.left


def set_client_width(hwnd, target):
    for _ in range(8):
        wr = RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(wr))
        win_w = wr.right - wr.left
        cw = client_width(hwnd)
        chrome = win_w - cw  # frames/borders (constant for a window)
        want_win = target + chrome
        user32.MoveWindow(hwnd, wr.left, wr.top, want_win, wr.bottom - wr.top, True)
        time.sleep(0.7)
        if client_width(hwnd) == target:
            return True
    return client_width(hwnd) == target


EXPR = """(() => { const de = document.documentElement;
  const shell = document.querySelector('.workstation-body');
  const insp = document.getElementById('workspace-inspector');
  const side = document.getElementById('pipeline-sidebar');
  const ir = insp ? insp.getBoundingClientRect() : {width:0,height:0};
  return {
    innerWidth: window.innerWidth,
    clientWidth: de.clientWidth,
    fracWidth: de.getBoundingClientRect().width,
    dpr: window.devicePixelRatio,
    mm1280: matchMedia('(min-width: 1280px)').matches,
    mm960_1279: matchMedia('(min-width: 960px) and (max-width: 1279px)').matches,
    mm959: matchMedia('(max-width: 959px)').matches,
    mode: (window.UQShellMode ? window.UQShellMode() : 'n/a'),
    grid: shell ? getComputedStyle(shell).gridTemplateColumns : 'n/a',
    inspectorDisplay: insp ? getComputedStyle(insp).display : 'n/a',
    inspectorRect: [Math.round(ir.width), Math.round(ir.height)],
    inspectorOpen: insp ? insp.classList.contains('open') : false,
    sidebarDisplay: side ? getComputedStyle(side).display : 'n/a',
    hscroll: de.scrollWidth > de.clientWidth + 1
  }; })()"""


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
    prof = Path(f"temp/p6close_bpr_{datetime.datetime.now().strftime('%H%M%S')}")
    prof.mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen([CHROME, f"--remote-debugging-port={CDP_PORT}",
                               f"--user-data-dir={prof.resolve()}",
                               "--no-first-run", "--no-default-browser-check",
                               "--disable-session-crashed-bubble",
                               "--force-device-scale-factor=1",
                               "--window-size=1300,800", "--window-position=0,0",
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
        E("window.switchWorkspace('scenes')")
        time.sleep(1.5)
        wins = []
        for _ in range(20):
            wins = find_window(chrome.pid)
            if wins:
                break
            time.sleep(1)
        assert wins, "no app window"
        hwnd = wins[0]

        results = {"method": "real integral viewport: --force-device-scale-factor=1 + Win32 MoveWindow to exact client width, no emulation",
                   "widths": {}}
        for w in WIDTHS:
            ok = set_client_width(hwnd, w)
            time.sleep(1.5)
            rec = E(EXPR)
            rec["requested"] = w
            rec["clientWidthOs"] = client_width(hwnd)
            rec["windowSized"] = ok
            rec["exact"] = (rec["innerWidth"] == w and rec["clientWidth"] == w)
            # toggle behavior oracle depends on band: drawer bands toggle open-class;
            # 3-pane band has no drawer (button may collapse in-flow panel instead)
            tg = E("(() => { const b = document.querySelector('#btn-toggle-inspector');"
                   " if (!b || getComputedStyle(b).display === 'none') return {vis:'hidden'};"
                   " const before = document.body.className;"
                   " b.click();"
                   " const opened = document.getElementById('workspace-inspector').classList.contains('open');"
                   " const collapsed = document.body.classList.contains('inspector-collapsed');"
                   " b.click();"
                   " const closed = !document.getElementById('workspace-inspector').classList.contains('open');"
                   " return {vis:'visible', opened, collapsed, closed, bodyBefore:before, bodyAfter:document.body.className}; })()")
            rec["inspectorTrigger"] = tg
            results["widths"][str(w)] = rec
            print(w, json.dumps(rec, ensure_ascii=False), flush=True)
            try:
                shot = cdp.call("Page.captureScreenshot", {"format": "png"}, timeout=45)["data"]
                (OUT / f"real-{w}.png").write_bytes(base64.b64decode(shot))
            except Exception as ex:
                print("shot failed", w, str(ex)[:100], flush=True)
        cdp.drain()
        cerrs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        results["console"] = {"errors": len(cerrs), "unhandled": len(unh)}
        (OUT / "exact_breakpoints_real.json").write_text(
            json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
        print("console", results["console"], flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
