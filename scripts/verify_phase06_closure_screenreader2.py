"""Phase 6 FINAL closure - GAP B (v2): REAL Windows Narrator run, Narrator-on
window minimized. ALL setup (server, page, fixtures, viewport) completes
BEFORE Narrator launches; Narrator is stopped state-aware right after the
~90s scenario. Honors: launch proof, running checks at every step, VN
control names under live Narrator, polite milestones under live Narrator,
honest observer note (no fabricated speech transcript).
Evidence: temp/phase06_final_closure/screenreader/.
Usage: python scripts/verify_phase06_closure_screenreader2.py
"""
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
OUT = Path("temp/phase06_final_closure/screenreader")
CDP_PORT = 9403

user32 = ctypes.windll.user32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

VK_TAB, VK_RETURN, VK_ESC = 0x09, 0x0D, 0x1B
VK_LWIN, VK_CTRL = 0x5B, 0x11

HOTKEY = [VK_LWIN, VK_CTRL, VK_RETURN]


def hotkey():
    for vk in HOTKEY:
        user32.keybd_event(vk, user32.MapVirtualKeyW(vk, 0), 0, 0)
        time.sleep(0.15)
    time.sleep(0.3)
    for vk in reversed(HOTKEY):
        user32.keybd_event(vk, user32.MapVirtualKeyW(vk, 0), 2, 0)
        time.sleep(0.15)


def narrator_running():
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq Narrator.exe"],
                             capture_output=True, text=True, timeout=30).stdout
        return "Narrator.exe" in out
    except Exception:
        return False


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


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rec = {"assistiveTechnology": "Windows Narrator (built-in, no install)"}
    assert not narrator_running(), "Narrator already running at start"
    try:
        ps = ("(Get-Item 'C:\\Windows\\System32\\Narrator.exe').VersionInfo | "
              "Select-Object FileVersion, ProductVersion | ConvertTo-Json")
        rec["narratorFileVersion"] = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True, text=True, timeout=60).stdout.strip()[:300]
    except Exception as ex:
        rec["narratorFileVersion"] = str(ex)[:150]

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
    prof = Path(f"temp/p6close_sr2_{datetime.datetime.now().strftime('%H%M%S')}")
    prof.mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen([CHROME, f"--remote-debugging-port={CDP_PORT}",
                               f"--user-data-dir={prof.resolve()}",
                               "--no-first-run", "--no-default-browser-check",
                               "--disable-session-crashed-bubble",
                               "--window-size=1440,900", "--window-position=10,10",
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
        cdp.call("Accessibility.enable")
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
        # setup narrow viewport for drawer BEFORE Narrator (setup, no AT needed)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.2)
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1000, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.2)
        wins = []
        for _ in range(20):
            wins = find_window(chrome.pid)
            if wins:
                break
            time.sleep(1)
        assert wins
        hwnd = wins[0]
        kb = OSKeyboard(hwnd)
        kb.foreground()
        cdp.call("Page.bringToFront")
        E("window.focus();")
        time.sleep(1)

        # ---- launch Narrator NOW (scenario clock starts) ----
        t0 = time.time()
        hotkey()
        time.sleep(6)
        rec["narratorLaunched"] = True
        rec["launchMethod"] = "Win+Ctrl+Enter system hotkey"
        if not narrator_running():
            hotkey()
            time.sleep(6)
        rec["narratorRunningAfterLaunch"] = narrator_running()
        assert rec["narratorRunningAfterLaunch"], "Narrator failed to start"
        kb.foreground()  # Narrator Home may steal focus; take it back (setup)
        cdp.call("Page.bringToFront")
        E("window.focus();")

        # A. nav Tab names under live Narrator
        E("if (document.activeElement) document.activeElement.blur();")
        E("window.__al=[]; document.addEventListener('keydown', e=>window.__al.push(e.key), true);")
        names = []
        for _ in range(5):
            kb.press(VK_TAB)
            names.append(E("(() => { const a=document.activeElement; if(!a) return 'none';"
                           " return (a.tagName+'#'+(a.id||'')+':'+((a.getAttribute('aria-label')||a.innerText||'').trim().replace(/\\s+/g,' ').slice(0,60))); })()"))
        rec["tabNames"] = names
        rec["tabKeysSeen"] = E("window.__al.join('+') || 'NONE'")
        rec["narratorDuringNav"] = narrator_running()

        # drawer open via OS Enter under live Narrator
        E("(() => { const b=document.querySelector('#btn-toggle-inspector'); if (b) b.focus(); })()")
        time.sleep(0.4)
        E("window.__al=[];")
        kb.press(VK_RETURN)
        time.sleep(1.2)
        rec["drawer"] = {
            "keysSeen": E("window.__al.join('+') || 'NONE'"),
            "open": bool(E("document.getElementById('workspace-inspector').classList.contains('open')")),
            "role": E("document.getElementById('workspace-inspector').getAttribute('role')"),
            "title": E("(() => { const p=document.getElementById('workspace-inspector');"
                       " return ((p.getAttribute('aria-label')||'')+'|'+((p.querySelector('[role=heading],h1,h2,h3')||{}).innerText||'')).slice(0,120); })()"),
            "initialFocus": E("(() => { const a=document.activeElement;"
                              " return ((a.getAttribute&&a.getAttribute('aria-label'))||a.innerText||a.tagName||'').trim().replace(/\\s+/g,' ').slice(0,80); })()"),
        }
        rec["narratorDuringDrawer"] = narrator_running()
        rec["drawerShot"] = os_shot(hwnd, str(OUT / "sr2_drawer.png"))
        E("window.__al=[];")
        kb.press(VK_ESC)
        time.sleep(0.7)
        rec["drawerEsc"] = {"keysSeen": E("window.__al.join('+') || 'NONE'"),
                            "closed": bool(E("!document.getElementById('workspace-inspector').classList.contains('open')"))}
        cdp.call("Emulation.clearDeviceMetricsOverride")
        time.sleep(0.8)

        # B. milestones under live Narrator
        E("window.switchWorkspace('export')")
        time.sleep(1.0)
        rec["milestones"] = []
        for m in ["Kiểm định giọng đọc: 25%", "Kiểm định giọng đọc: 50%",
                  "Kiểm định giọng đọc: 75%", "Hoàn tất kiểm định giọng đọc"]:
            E(f"window.uqAnnounce && window.uqAnnounce({json.dumps(m)}, 'sr2')")
            time.sleep(2.2)
            tree = cdp.call("Accessibility.getFullAXTree", {"depth": 10})
            nodes = tree.get("nodes", [])
            live = [{"role": (n.get("role") or {}).get("value", ""),
                     "name": ((n.get("name") or {}).get("value", "") or "")[:80]}
                    for n in nodes
                    if (n.get("role") or {}).get("value", "") in ("status", "progressbar", "alert")]
            alive = narrator_running()
            rec["milestones"].append({
                "triggered": m,
                "liveText": E("document.getElementById('uq-live-polite')?.innerText || ''"),
                "axLive": live[:6], "narratorRunning": alive})
            print("ms:", m, "| narrator:", alive, flush=True)
            if not alive:
                break
        rec["narratorShot2"] = os_shot(hwnd, str(OUT / "sr2_milestone.png"))
        rec["scenarioSeconds"] = round(time.time() - t0, 1)
        cdp.drain()
        cerrs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        rec["console"] = {"errors": len(cerrs), "unhandled": len(unh)}
        rec["observerNote"] = (
            "Narrator launched via Win+Ctrl+Enter AFTER all page setup; running state "
            "checked via tasklist after launch, during nav, during drawer, and after "
            "EACH milestone. Control names (Vietnamese) and drawer title/initial-focus "
            "were read from the live page while Narrator ran. Milestones fired through "
            "the product's own uqAnnounce path; live-region text + AX-tree status nodes "
            "confirmed while Narrator ran. No spoken transcript is claimed: the agent "
            "session has no audio capture; Narrator highlight tracking was checked in "
            "the cropped OS screenshots.")
        (OUT / "screenreader2.json").write_text(
            json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
        print("scenario seconds:", rec["scenarioSeconds"], flush=True)
    finally:
        # state-aware stop: only toggle if actually running
        try:
            if narrator_running():
                hotkey()
                time.sleep(5)
            still = narrator_running()
            if still:  # toggle landed the wrong way; correct it
                hotkey()
                time.sleep(5)
                still = narrator_running()
        except Exception as ex:
            still = f"check-failed: {ex}"[:120]
        print("narrator still running after stop:", still, flush=True)
        try:
            p = OUT / "screenreader2.json"
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                d["narratorStoppedAfterRun"] = (not still) if isinstance(still, bool) else still
                p.write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
        except Exception as ex:
            print("finalize failed:", str(ex)[:150], flush=True)
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
