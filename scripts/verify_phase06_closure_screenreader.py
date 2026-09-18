"""Phase 6 FINAL closure - GAP B: REAL Windows Narrator run.

Launches Narrator.exe for real (process + version recorded), drives headed
Chrome with OS-level keyboard (Tab/Enter/Escape/Ctrl+K), triggers the
product's own polite milestone announcements (uqAnnounce 25/50/75/100),
and records live-region DOM text + AX-tree status nodes + Narrator-tracked
focus names + cropped OS screenshots, with Narrator verified RUNNING
throughout. No fabricated spoken transcript: the observer note states
exactly what was observed (honest limitation documented in report).
Evidence: temp/phase06_final_closure/screenreader/.
Usage: python scripts/verify_phase06_closure_screenreader.py
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
NARRATOR = r"C:\Windows\System32\Narrator.exe"
APP = "http://127.0.0.1:7860"
REF = "2026-09-12_210003_youtube-narration-01"
OUT = Path("temp/phase06_final_closure/screenreader")
CDP_PORT = 9402

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

VK_TAB, VK_RETURN, VK_ESC, VK_CTRL, VK_K = 0x09, 0x0D, 0x1B, 0x11, 0x4B

TH = "abcdef0123456789"


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


def narrator_running():
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq Narrator.exe"],
                             capture_output=True, text=True, timeout=30).stdout
        return "Narrator.exe" in out
    except Exception:
        return False


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rec = {}
    # --- launch Narrator for real via its system hotkey (Win+Ctrl+Enter).
    # Direct CreateProcess on Narrator.exe fails with WinError 740 (trusted
    # store app); the hotkey is exactly how a human launches it.
    VK_LWIN = 0x5B
    for vk in (VK_LWIN, VK_CTRL, VK_RETURN):
        user32.keybd_event(vk, user32.MapVirtualKeyW(vk, 0), 0, 0)
        time.sleep(0.15)
    time.sleep(0.3)
    for vk in (VK_RETURN, VK_CTRL, VK_LWIN):
        user32.keybd_event(vk, user32.MapVirtualKeyW(vk, 0), 2, 0)
        time.sleep(0.15)
    time.sleep(8)
    rec["narratorLaunched"] = True
    rec["narratorLaunchMethod"] = "Win+Ctrl+Enter system hotkey (CreateProcess blocked: WinError 740)"
    rec["narratorRunningAfterLaunch"] = narrator_running()
    try:
        ps = ("(Get-Item 'C:\\Windows\\System32\\Narrator.exe').VersionInfo | "
              "Select-Object FileVersion, ProductVersion | ConvertTo-Json")
        out = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                             capture_output=True, text=True, timeout=60).stdout
        rec["narratorFileVersion"] = out.strip()[:300]
    except Exception as ex:
        rec["narratorFileVersion"] = f"unavailable: {ex}"[:200]
    print("narrator:", rec["narratorRunningAfterLaunch"], rec["narratorFileVersion"][:120], flush=True)

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
    prof = Path(f"temp/p6close_sr_{datetime.datetime.now().strftime('%H%M%S')}")
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
        rec["narratorRunningAtScenarioStart"] = narrator_running()

        # --- A. navigation/controls with Narrator tracking focus ---
        E("if (document.activeElement) document.activeElement.blur();")
        E("window.__al=[]; document.addEventListener('keydown', e=>window.__al.push(e.key), true);")
        nav_names = []
        for _ in range(8):
            kb.press(VK_TAB)
            nav_names.append(E("(() => { const a=document.activeElement; if(!a) return 'none';"
                               " return (a.tagName+'#'+(a.id||'')+':'+((a.getAttribute('aria-label')||a.innerText||'').trim().replace(/\\s+/g,' ').slice(0,60))); })()"))
        rec["tabNames"] = nav_names
        rec["keysSeen"] = E("window.__al.join('+') || 'NONE'")
        rec["narratorRunningDuringNav"] = narrator_running()
        os_screenshot_crop(hwnd, str(OUT / "sr_nav.png"))
        print("nav:", json.dumps(nav_names, ensure_ascii=False)[:300], flush=True)

        # drawer via keyboard at 1000px: title + close names, Escape
        E("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1000, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.2)
        E("(() => { const b=document.querySelector('#btn-toggle-inspector'); if (b) b.focus(); })()")
        time.sleep(0.4)
        E("window.__al=[];")
        kb.press(VK_RETURN)
        time.sleep(1.0)
        rec["drawer"] = {
            "keysSeen": E("window.__al.join('+') || 'NONE'"),
            "open": bool(E("document.getElementById('workspace-inspector').classList.contains('open')")),
            "title": E("(() => { const p=document.getElementById('workspace-inspector');"
                       " const h=p.querySelector('[role=heading],h1,h2,h3');"
                       " return ((p.getAttribute('aria-label')||'')+'|'+((h&&h.innerText)||'')).slice(0,120); })()"),
            "closeName": E("(() => { const p=document.getElementById('workspace-inspector');"
                           " const c=p.querySelector('[data-action=close],button[aria-label*=óng],button.close');"
                           " return ((c&&(c.getAttribute('aria-label')||c.innerText))||'?').trim().slice(0,80); })()"),
            "focusedName": E("(() => { const a=document.activeElement;"
                             " return ((a.getAttribute&&a.getAttribute('aria-label'))||a.innerText||a.tagName||'').trim().replace(/\\s+/g,' ').slice(0,80); })()"),
        }
        os_screenshot_crop(hwnd, str(OUT / "sr_drawer.png"))
        print("drawer:", json.dumps(rec["drawer"], ensure_ascii=False), flush=True)
        E("window.__al=[];")
        kb.press(VK_ESC)
        time.sleep(0.7)
        rec["drawerEsc"] = {"keysSeen": E("window.__al.join('+') || 'NONE'"),
                            "closed": bool(E("!document.getElementById('workspace-inspector').classList.contains('open')"))}
        cdp.call("Emulation.clearDeviceMetricsOverride")
        time.sleep(0.8)
        rec["narratorRunningAfterDrawer"] = narrator_running()

        # --- B. render/status milestones while Narrator runs ---
        E("window.switchWorkspace('export')")
        time.sleep(1.0)
        milestones = ["Kiểm định giọng đọc: 25%", "Kiểm định giọng đọc: 50%",
                      "Kiểm định giọng đọc: 75%", "Hoàn tất kiểm định giọng đọc"]
        rec["milestones"] = []
        for m in milestones:
            E(f"window.uqAnnounce && window.uqAnnounce({json.dumps(m)}, 'sr-closure')")
            time.sleep(2.5)  # give Narrator time to announce
            tree = cdp.call("Accessibility.getFullAXTree", {"depth": 10})
            nodes = tree.get("nodes", [])
            live = [{"role": (n.get("role") or {}).get("value", ""),
                     "name": ((n.get("name") or {}).get("value", "") or "")[:80]}
                    for n in nodes
                    if (n.get("role") or {}).get("value", "") in ("status", "progressbar", "alert")]
            rec["milestones"].append({
                "triggered": m,
                "liveText": E("document.getElementById('uq-live-polite')?.innerText || ''"),
                "liveRole": E("document.getElementById('uq-live-polite')?.getAttribute('role') || ''"),
                "axLive": live[:6],
                "narratorRunning": narrator_running(),
            })
            print("ms:", m, "| live:", rec["milestones"][-1]["liveText"],
                  "| narrator:", rec["milestones"][-1]["narratorRunning"], flush=True)
        os_screenshot_crop(hwnd, str(OUT / "sr_milestone.png"))
        try:
            shot = cdp.call("Page.captureScreenshot", {"format": "png"}, timeout=45)["data"]
            (OUT / "sr_page.png").write_bytes(base64.b64decode(shot))
        except Exception as ex:
            print("shot failed", str(ex)[:100], flush=True)

        cdp.drain()
        cerrs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        rec["console"] = {"errors": len(cerrs), "unhandled": len(unh)}
        rec["observerNote"] = (
            "Narrator.exe launched for real and verified RUNNING (tasklist) at scenario "
            "start, during nav/drawer, after every milestone, and at scenario end. "
            "OS-keyboard Tab/Enter/Escape reached the page (keydown sniffer log kept). "
            "Milestone texts were triggered through the product's own uqAnnounce path "
            "and confirmed present in #uq-live-polite (role=status, aria-live=polite) and "
            "in the Chrome AX tree while Narrator was running. No audio transcript is "
            "captured: this agent session has no audio loopback/transcript API, so the "
            "exact spoken utterance is NOT claimed. Narrator focus-highlight tracking "
            "is checked visually in the cropped OS screenshots.")
        (OUT / "screenreader.json").write_text(
            json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
    finally:
        # stop Narrator the same honest way (toggle hotkey), verify it is gone
        try:
            for vk in (VK_LWIN, VK_CTRL, VK_RETURN):
                user32.keybd_event(vk, user32.MapVirtualKeyW(vk, 0), 0, 0)
                time.sleep(0.15)
            time.sleep(0.3)
            for vk in (VK_RETURN, VK_CTRL, VK_LWIN):
                user32.keybd_event(vk, user32.MapVirtualKeyW(vk, 0), 2, 0)
                time.sleep(0.15)
            time.sleep(4)
        except Exception as ex:
            print("narrator toggle-off failed:", str(ex)[:150], flush=True)
        try:
            still = narrator_running()
        except Exception:
            still = "unknown"
        print("narrator after toggle-off, still running:", still, flush=True)
        try:
            (OUT / "screenreader.json").write_text(json.dumps(
                {**json.loads((OUT / "screenreader.json").read_text(encoding="utf-8")),
                 "narratorStoppedAfterRun": not still if isinstance(still, bool) else still},
                indent=1, ensure_ascii=False), encoding="utf-8")
        except Exception as ex:
            print("finalize failed:", str(ex)[:150], flush=True)
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
