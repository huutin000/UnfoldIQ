"""Two-gate closure GATE A: HUMAN-observed Narrator scenario.

Same genuine setup as screenreader2 (setup BEFORE launch, Win+Ctrl+Enter),
but with generous spacing (~6s) between the 4 milestone announcements so a
human observer can comfortably hear each one, plus slow Tab narration over
workbench controls and a drawer open/close. The observer's report is
collected separately (question tool) and recorded into sr_human.json by the
agent afterwards - this script records everything EXCEPT the human answers.
Evidence: temp/phase06_twogate_closure/screenreader/.
Usage: python scripts/verify_phase06_twogate_sr_human.py
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
OUT = Path("temp/phase06_twogate_closure/screenreader")
CDP_PORT = 9407

user32 = ctypes.windll.user32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass

VK_TAB, VK_RETURN, VK_ESC = 0x09, 0x0D, 0x1B
VK_LWIN, VK_CTRL = 0x5B, 0x11
HOTKEY = [VK_LWIN, VK_CTRL, VK_RETURN]
SPACING = 6.0


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


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rec = {"assistiveTechnology": "Windows Narrator (built-in)",
           "observer": "HUMAN (answers recorded separately into sr_human.json)",
           "announcementSpacingSec": SPACING}
    assert not narrator_running(), "Narrator already running at start"
    try:
        ps = ("(Get-Item 'C:\\Windows\\System32\\Narrator.exe').VersionInfo | "
              "Select-Object FileVersion | ConvertTo-Json")
        rec["narratorVersion"] = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True, text=True, timeout=60).stdout.strip()[:200]
    except Exception as ex:
        rec["narratorVersion"] = str(ex)[:150]

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
    prof = Path(f"temp/p6tg_srh_{datetime.datetime.now().strftime('%H%M%S')}")
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

        print("HUMAN: Narrator will speak in ~15s. Listen for 25/50/75/completion + control names.", flush=True)
        hotkey()
        time.sleep(6)
        if not narrator_running():
            hotkey()
            time.sleep(6)
        rec["narratorRunningAfterLaunch"] = narrator_running()
        assert rec["narratorRunningAfterLaunch"], "Narrator failed to start"
        kb.foreground()
        cdp.call("Page.bringToFront")
        E("window.focus();")
        t0 = time.time()

        # slow narrated Tab tour (Narrator echoes each focused control name)
        E("window.switchWorkspace('export')")
        time.sleep(1.0)
        E("if (document.activeElement) document.activeElement.blur();")
        E("window.__al=[]; document.addEventListener('keydown', e=>window.__al.push(e.key), true);")
        names = []
        for _ in range(6):
            kb.press(VK_TAB, settle=1.2)
            names.append(E("(() => { const a=document.activeElement; if(!a) return 'none';"
                           " return (a.tagName+'#'+(a.id||'')+':'+((a.getAttribute('aria-label')||a.innerText||'').trim().replace(/\\s+/g,' ').slice(0,60))); })()"))
            time.sleep(1.5)  # let Narrator finish speaking the name
        rec["tabNames"] = names
        rec["narratorDuringNav"] = narrator_running()

        # drawer open (Narrator announces dialog + focused control)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.2)
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1000, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.2)
        E("(() => { const b=document.querySelector('#btn-toggle-inspector'); if (b) b.focus(); })()")
        time.sleep(2.0)
        E("window.__al=[];")
        kb.press(VK_RETURN, settle=1.0)
        time.sleep(2.0)
        rec["drawer"] = {
            "open": bool(E("document.getElementById('workspace-inspector').classList.contains('open')")),
            "title": E("(() => { const p=document.getElementById('workspace-inspector');"
                       " return ((p.getAttribute('aria-label')||'')+'|'+((p.querySelector('[role=heading],h1,h2,h3')||{}).innerText||'')).slice(0,120); })()"),
        }
        rec["narratorDuringDrawer"] = narrator_running()
        kb.press(VK_ESC, settle=1.0)
        time.sleep(1.5)
        cdp.call("Emulation.clearDeviceMetricsOverride")
        time.sleep(0.8)

        # milestones with comfortable spacing
        E("window.switchWorkspace('export')")
        time.sleep(1.5)
        rec["milestones"] = []
        for m in ["Kiểm định giọng đọc: 25%", "Kiểm định giọng đọc: 50%",
                  "Kiểm định giọng đọc: 75%", "Hoàn tất kiểm định giọng đọc"]:
            E(f"window.uqAnnounce && window.uqAnnounce({json.dumps(m)}, 'srh')")
            print(f"ANNOUNCED NOW: {m}", flush=True)
            time.sleep(SPACING)
            rec["milestones"].append({
                "triggered": m,
                "liveText": E("document.getElementById('uq-live-polite')?.innerText || ''"),
                "narratorRunning": narrator_running()})
        rec["scenarioSeconds"] = round(time.time() - t0, 1)
        print("HUMAN: scenario done. Narrator stopping.", flush=True)
        cdp.drain()
        cerrs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        rec["console"] = {"errors": len(cerrs), "unhandled": len(unh)}
        (OUT / "sr_scenario.json").write_text(
            json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
    finally:
        try:
            if narrator_running():
                hotkey()
                time.sleep(5)
            still = narrator_running()
            if still:
                hotkey()
                time.sleep(5)
                still = narrator_running()
        except Exception:
            still = "unknown"
        print("narrator still running:", still, flush=True)
        try:
            p = OUT / "sr_scenario.json"
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                d["narratorStoppedAfterRun"] = (not still) if isinstance(still, bool) else still
                p.write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
        except Exception as ex:
            print("finalize:", str(ex)[:120], flush=True)
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
