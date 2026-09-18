"""Phase 6 FINAL closure - GAP D: exact breakpoint edges 1279/1280/959/960.

Method: CDP Emulation.setDeviceMetricsOverride with deviceScaleFactor=1,
mobile=false and EXACT layout widths. Observed width asserted via
window.innerWidth + documentElement.clientWidth + matchMedia. Layout mode
asserted via grid columns / inspector+sidebar display / UQShellMode.
Evidence: temp/phase06_final_closure/breakpoints/.
Usage: python scripts/verify_phase06_closure_breakpoints.py
"""
import base64
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
OUT = Path("temp/phase06_final_closure/breakpoints")
CDP_PORT = 9398
WIDTHS = [1280, 1279, 960, 959]
EXPECTED = {
    1280: "3-pane (Nav|Work|Inspector in-flow)",
    1279: "2-col (Nav|Work + Inspector Drawer)",
    960: "2-col (Nav|Work + Inspector Drawer)",
    959: "single (Workspace + 2 Sheets)",
}


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
    prof = Path(f"temp/p6close_bp_{datetime.datetime.now().strftime('%H%M%S')}")
    prof.mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen([CHROME, f"--remote-debugging-port={CDP_PORT}",
                               f"--user-data-dir={prof.resolve()}",
                               "--no-first-run", "--no-default-browser-check",
                               "--disable-session-crashed-bubble",
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

        results = {"method": "CDP Emulation.setDeviceMetricsOverride dsf=1 mobile=false, exact CSS widths",
                   "widths": {}}
        for w in WIDTHS:
            cdp.call("Emulation.setDeviceMetricsOverride",
                     {"width": w, "height": 800, "deviceScaleFactor": 1, "mobile": False})
            time.sleep(1.5)
            rec = E("(() => { const de = document.documentElement;"
                    " const shell = document.querySelector('.workstation-body');"
                    " const grid = shell ? getComputedStyle(shell).gridTemplateColumns : 'n/a';"
                    " const insp = document.getElementById('workspace-inspector');"
                    " const side = document.getElementById('pipeline-sidebar');"
                    " return {"
                    "  innerWidth: window.innerWidth,"
                    "  clientWidth: de.clientWidth,"
                    "  mm1280: matchMedia('(min-width: 1280px)').matches,"
                    "  mm960_1279: matchMedia('(min-width: 960px) and (max-width: 1279px)').matches,"
                    "  mm959: matchMedia('(max-width: 959px)').matches,"
                    "  mode: (window.UQShellMode ? window.UQShellMode() : 'n/a'),"
                    "  grid: grid,"
                    "  inspectorDisplay: insp ? getComputedStyle(insp).display : 'n/a',"
                    "  inspectorOpen: insp ? insp.classList.contains('open') : false,"
                    "  sidebarDisplay: side ? getComputedStyle(side).display : 'n/a',"
                    "  hscroll: de.scrollWidth > de.clientWidth + 1"
                    " }; })()")
            rec["requested"] = w
            rec["exact"] = (rec["innerWidth"] == w and rec["clientWidth"] == w)
            rec["expected"] = EXPECTED[w]
            # drawer/sheet trigger exists and toggles (open+close to restore state)
            trig = E("(() => { const b = document.querySelector('#btn-toggle-inspector');"
                     " if (!b || getComputedStyle(b).display === 'none') return 'hidden';"
                     " b.click(); const opened = document.getElementById('workspace-inspector').classList.contains('open');"
                     " b.click(); const closed = !document.getElementById('workspace-inspector').classList.contains('open');"
                     " return opened && closed ? 'toggle-ok' : 'toggle-FAIL'; })()")
            rec["inspectorTrigger"] = trig
            results["widths"][str(w)] = rec
            print(w, json.dumps(rec, ensure_ascii=False), flush=True)
            try:
                shot = cdp.call("Page.captureScreenshot", {"format": "png"}, timeout=45)["data"]
                (OUT / f"edge-{w}.png").write_bytes(base64.b64decode(shot))
            except Exception as ex:
                print("shot failed", w, str(ex)[:100], flush=True)
        cdp.call("Emulation.clearDeviceMetricsOverride")
        cdp.drain()
        cerrs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        results["console"] = {"errors": len(cerrs), "unhandled": len(unh)}
        (OUT / "exact_breakpoints.json").write_text(
            json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
        print("console", results["console"], flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
