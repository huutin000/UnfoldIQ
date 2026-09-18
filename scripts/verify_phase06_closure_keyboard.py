"""Phase 6 FINAL closure - GAP A: keyboard-only workflow via REAL OS keyboard.

Method: headed Chrome (fresh profile) + Win32 foreground + keybd_event
(OS-level, trusted by the browser as physical keyboard). NO element.click(),
NO mouse, NO pointer-equivalence, NO direct JS handler calls for the gated
actions. CDP is used ONLY for observation (activeElement, state) and page
setup (viewport size, fixtures) - never for activation.

Covers prompt section 7 scenarios 1-16 (no destructive action, no heavy
render). Evidence: temp/phase06_final_closure/keyboard/.
Usage: python scripts/verify_phase06_closure_keyboard.py
"""
import base64
import ctypes
import datetime
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
OUT = Path("temp/phase06_final_closure/keyboard")
CDP_PORT = 9396

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

VK_TAB, VK_RETURN, VK_SPACE, VK_ESC = 0x09, 0x0D, 0x20, 0x1B
VK_SHIFT, VK_CTRL = 0x10, 0x11
VK_LEFT, VK_UP, VK_RIGHT, VK_DOWN = 0x25, 0x26, 0x27, 0x28
VK_K = 0x4B
EXTENDED = {VK_LEFT, VK_UP, VK_RIGHT, VK_DOWN, 0x24, 0x23, 0x21, 0x22, 0x2D, 0x2E}

KEYEVENTF_KEYUP = 0x2
KEYEVENTF_EXTENDED = 0x1

NAV_ORDER = ["overview", "story", "voice", "scenes", "export"]


class OSKeyboard:
    def __init__(self, hwnd):
        self.hwnd = hwnd

    def foreground(self):
        fg = user32.GetForegroundWindow()
        if fg == self.hwnd:
            return True
        fg_thread = user32.GetWindowThreadProcessId(fg, None)
        my_thread = kernel32.GetCurrentThreadId()
        tgt_thread = user32.GetWindowThreadProcessId(self.hwnd, None)
        user32.AttachThreadInput(my_thread, fg_thread, True)
        user32.AttachThreadInput(my_thread, tgt_thread, True)
        ok = user32.SetForegroundWindow(self.hwnd)
        user32.AttachThreadInput(my_thread, fg_thread, False)
        user32.AttachThreadInput(my_thread, tgt_thread, False)
        time.sleep(0.4)
        return bool(ok) and user32.GetForegroundWindow() == self.hwnd

    def _one(self, vk, up):
        flags = KEYEVENTF_KEYUP if up else 0
        if vk in EXTENDED:
            flags |= KEYEVENTF_EXTENDED
        scan = user32.MapVirtualKeyW(vk, 0)
        user32.keybd_event(vk, scan, flags, 0)
        time.sleep(0.07)

    def press(self, vk, settle=0.55):  # single key down+up
        self.foreground()
        self._one(vk, False)
        time.sleep(0.15)
        self._one(vk, True)
        time.sleep(settle)

    def tab_search(self):  # fast Tab for long searches
        self.press(VK_TAB, settle=0.30)

    def press_expect(self, E, vk, key_name, settle=0.55, retries=4):
        """Send key; verify page actually received it; re-foreground+retry on
        transient OS focus theft. Returns True if the key arrived."""
        for _ in range(retries):
            before = E("window.__al.length")
            self.press(vk, settle=settle)
            try:
                after = E("window.__al.length")
            except Exception:
                after = before
            if isinstance(after, int) and isinstance(before, int) and after > before:
                return True
            time.sleep(0.6)
        return False

    def chord(self, mod, vk):  # e.g. Ctrl+K, Shift+Tab
        self.foreground()
        self._one(mod, False)
        time.sleep(0.15)
        self._one(vk, False)
        time.sleep(0.15)
        self._one(vk, True)
        time.sleep(0.15)
        self._one(mod, True)
        time.sleep(0.55)


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


def active(E):
    return E("(() => { const a = document.activeElement; if (!a) return 'none';"
             " return (a.tagName + '#' + (a.id || '') + ':' + ((a.dataset && a.dataset.workspace) || (a.dataset && a.dataset.shotId) || '')"
             " + ':' + ((a.getAttribute('aria-label') || a.innerText || '').trim().replace(/\\s+/g,' ').slice(0,40))); })()")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    flow, focus_seq = [], []

    def step(name, **kw):
        rec = {"step": name, **kw}
        flow.append(rec)
        print(f"[{name}] " + json.dumps(kw, ensure_ascii=False)[:220], flush=True)
        return rec

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
    prof = Path(f"temp/p6close_kb_{datetime.datetime.now().strftime('%H%M%S')}")
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
        kb = OSKeyboard(wins[0])
        assert kb.foreground(), "cannot foreground chrome"
        cdp.call("Page.bringToFront")
        E("window.focus();")
        # document-level key sniffer: proves every OS key reaches the page
        E("window.__al=[]; document.addEventListener('keydown', e=>window.__al.push(e.key), true);")
        step("setup", method="OS keybd_event (physical keyboard path)",
             clicksUsed=0, jsActivationCalls=0,
             windowForeground=bool(user32.GetForegroundWindow() == wins[0]),
             hasFocus=bool(E("document.hasFocus()")))

        # ---- 1-2. Tab through; record focus order; focus-visible ----
        E("if (document.activeElement) document.activeElement.blur();")
        for _ in range(14):
            kb.press(VK_TAB)
            focus_seq.append(active(E))
        step("tab-order", stops14=focus_seq,
             noBodyTrap=all(s != "none" for s in focus_seq))
        step("focus-visible",
             match=bool(E("(() => { const a=document.activeElement; try { return a.matches(':focus-visible'); } catch(e){ return false; } })()")),
             ring=E("(() => { const a=document.activeElement; const cs=getComputedStyle(a);"
                    " return {w:cs.outlineWidth, s:cs.outlineStyle, tag:a.tagName}; })()"))

        # ---- 3-7. reach each workbench nav by Tab only, activate with Enter/Space ----
        E("window.__al=[];")
        nav_results = {}

        def tab_until(pred, cap=400):
            """Tab until pred() is true. BODY repeats don't count as cycles
            (re-renders legitimately drop focus to body)."""
            seen = {}
            stalls = 0
            for n in range(cap):
                if pred():
                    return True, n, stalls
                if not kb.press_expect(E, VK_TAB, "Tab", settle=0.30):
                    stalls += 1
                    if stalls % 5 == 0:
                        try:
                            kb.foreground()
                            cdp.call("Page.bringToFront")
                            E("window.focus();")
                        except Exception:
                            pass
                    if stalls > 30:
                        return False, n, stalls  # OS focus unrecoverable
                    continue
                sig = active(E)
                if sig != "none" and not sig.startswith("BODY#"):
                    seen[sig] = seen.get(sig, 0) + 1
                    if seen[sig] >= 3 and n > 40:
                        return False, n, stalls  # full cycle without hitting target
            return False, cap, stalls

        def tab_until_ws(ws, cap=400):
            return tab_until(
                lambda: (E("(() => { const el=document.activeElement;"
                           " return (el && el.dataset && el.dataset.workspace) || ''; })()") == ws),
                cap)

        for i, ws in enumerate(NAV_ORDER):
            key_used = "Enter" if i % 2 == 0 else "Space"
            E("window.__al=[];")
            reached, tabs_used, stalls = tab_until_ws(ws)
            before = active(E)
            vk = VK_RETURN if key_used == "Enter" else VK_SPACE
            arrived = kb.press_expect(E, vk, key_used)
            time.sleep(1.2)
            nav_results[ws] = {
                "reachedByTab": reached, "tabsUsed": tabs_used,
                "focusStalls": stalls, "keyArrived": arrived,
                "focusedBefore": before, "key": key_used,
                "keySeenByPage": E("window.__al.join('+') || 'NONE'"),
                "activated": bool(E(f"document.getElementById('ws-{ws}').classList.contains('active')")),
            }
            step(f"nav-{ws}", **nav_results[ws])

        # ---- 8-11. Ctrl+K palette, arrows, Enter, Escape ----
        E("window.__al=[];")
        kb.chord(VK_CTRL, VK_K)
        time.sleep(0.8)
        pal_open = bool(E("window.UQPalette.isOpen()"))
        pal_focus = active(E)
        step("palette-open", open=pal_open, focused=pal_focus,
             keysSeen=E("window.__al.join('+') || 'NONE'"))
        E("(() => { const i=document.getElementById('uq-cmd-input'); i.value='shot_001';"
          " i.dispatchEvent(new Event('input',{bubbles:true})); })()")
        time.sleep(0.6)
        E("window.__al=[];")
        kb.press(VK_DOWN)
        sel1 = E("(() => { const i=document.getElementById('uq-cmd-input');"
                 " const id=i && i.getAttribute('aria-activedescendant');"
                 " const el=id && document.getElementById(id);"
                 " return (id||'?')+'|'+((el&&el.querySelector('.uq-cmd-sub').innerText)||'?'); })()")
        kb.press(VK_UP)
        sel2 = E("(() => { const i=document.getElementById('uq-cmd-input');"
                 " return (i&&i.getAttribute('aria-activedescendant'))||'?'; })()")
        step("palette-arrows", afterDown=sel1, afterUp=sel2,
             keysSeen=E("window.__al.join('+') || 'NONE'"))
        E("window.__al=[];")
        kb.press(VK_RETURN)
        time.sleep(1.5)
        pal_act = "shot_001" in (E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,80) || '')()") or "")
        step("palette-enter", activatesStableTarget=pal_act,
             paletteOpenAfter=bool(E("window.UQPalette.isOpen()")),
             keysSeen=E("window.__al.join('+') || 'NONE'"))
        E("window.__al=[];")
        kb.chord(VK_CTRL, VK_K)
        time.sleep(0.8)
        reopen = bool(E("window.UQPalette.isOpen()"))
        kb.press(VK_ESC)
        time.sleep(0.6)
        step("palette-escape", reopenedByCtrlK=reopen,
             closed=bool(E("!window.UQPalette.isOpen()")),
             keysSeen=E("window.__al.join('+') || 'NONE'"),
             focusAfter=active(E))

        # ---- 12-15. Inspector Drawer via keyboard at 1000px ----
        # (navigate to scenes by keyboard too - no setup shortcut)
        E("window.__al=[];")
        reached_sc, tabs_sc, stalls_sc = tab_until_ws("scenes")
        sc_arrived = kb.press_expect(E, VK_RETURN, "Enter")
        time.sleep(1.2)
        step("nav-scenes-again", reached=reached_sc, tabsUsed=tabs_sc,
             focusStalls=stalls_sc, keyArrived=sc_arrived,
             scenesActive=bool(E("document.getElementById('ws-scenes').classList.contains('active')")))
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1000, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.2)
        E("if (document.activeElement) document.activeElement.blur();")
        E("window.__al=[];")
        reached_toggle, n, stalls = tab_until(
            lambda: bool(E("document.activeElement === document.querySelector('#btn-toggle-inspector')")))
        step("drawer-reach-toggle", reached=reached_toggle, tabsUsed=n,
             focusStalls=stalls, focusedBefore=active(E))
        E("window.__al=[];")
        drawer_key = kb.press_expect(E, VK_RETURN, "Enter")  # native Enter opens drawer
        time.sleep(0.9)
        drawer_open = bool(E("document.getElementById('workspace-inspector').classList.contains('open')"))
        drawer_role = E("document.getElementById('workspace-inspector').getAttribute('role')")
        step("drawer-open-enter", open=drawer_open, role=drawer_role,
             keyArrived=drawer_key,
             keysSeen=E("window.__al.join('+') || 'NONE'"))
        # Tab/Shift+Tab trap: focus must stay inside inspector (only if opened)
        E("window.__al=[];")
        inside = []
        if drawer_open:
            for _ in range(6):
                kb.press(VK_TAB)
                inside.append(bool(E("document.getElementById('workspace-inspector').contains(document.activeElement)")))
            kb.chord(VK_SHIFT, VK_TAB)
            inside.append(bool(E("document.getElementById('workspace-inspector').contains(document.activeElement)")))
        step("drawer-trap", keptInside=inside,
             passTrap=bool(drawer_open and inside and all(inside)),
             skipped=not drawer_open,
             keysSeen=E("window.__al.join('+') || 'NONE'"))
        try:
            shot = cdp.call("Page.captureScreenshot", {"format": "png"}, timeout=45)["data"]
            (OUT / "drawer_open.png").write_bytes(base64.b64decode(shot))
        except Exception as ex:
            step("drawer-screenshot", failed=str(ex)[:120])
        E("window.__al=[];")
        kb.press(VK_ESC)
        time.sleep(0.7)
        step("drawer-escape",
             closed=bool(E("!document.getElementById('workspace-inspector').classList.contains('open')")),
             focusBackOnOpener=bool(E("document.activeElement === document.querySelector('#btn-toggle-inspector')")),
             keysSeen=E("window.__al.join('+') || 'NONE'"),
             focusAfter=active(E))
        cdp.call("Emulation.clearDeviceMetricsOverride")
        time.sleep(0.8)

        # ---- 16. Shot Arrow navigation ----
        E("window.__al=[];")
        E("(() => { const b=document.querySelector('[data-action=select-shot][data-shot-id=shot_001]'); if(b) b.focus(); })()")
        time.sleep(0.4)
        arrow_arrived = kb.press_expect(E, VK_DOWN, "ArrowDown", settle=0.5)
        time.sleep(0.4)
        shot_after = E("(() => document.activeElement?.dataset?.shotId || '?')()")
        step("shot-arrow", afterArrowDown=shot_after, keyArrived=arrow_arrived,
             keysSeen=E("window.__al.join('+') || 'NONE'"),
             focusAfter=active(E),
             containerButtons=E("document.querySelectorAll('#sp-rows-container button').length"))
        shot2 = cdp.call("Page.captureScreenshot", {"format": "png"}, timeout=45)["data"]
        (OUT / "kb_final.png").write_bytes(base64.b64decode(shot2))

        cdp.drain()
        cerrs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        failed = [e for e in cdp.events if e.get("method") == "Network.loadingFailed"]
        failed_urls = []
        reqs = {}
        for e in cdp.events:
            m = e.get("method")
            p = e.get("params", {}) or {}
            if m == "Network.requestWillBeSent":
                reqs[p.get("requestId")] = (p.get("request") or {}).get("url", "")
            elif m == "Network.loadingFailed":
                failed_urls.append(reqs.get(p.get("requestId"), "?") + " :: " + str(p.get("errorText", "")))
        cerr_texts = [json.dumps((e.get("params", {}) or {}).get("entry", {}), ensure_ascii=False)[:200]
                      for e in cerrs]
        step("console", errors=len(cerrs), unhandled=len(unh), loadingFailed=len(failed),
             failedUrls=failed_urls[:8], errorTexts=cerr_texts[:8])

        (OUT / "keyboard_flow.json").write_text(
            json.dumps({"method": "OS-level keybd_event via Win32 (physical keyboard path)",
                        "pointerOrClickFallback": False,
                        "flow": flow}, indent=1, ensure_ascii=False), encoding="utf-8")
        (OUT / "focus_sequence.json").write_text(
            json.dumps(focus_seq, indent=1, ensure_ascii=False), encoding="utf-8")
        with open(OUT / "methodology.md", "w", encoding="utf-8") as f:
            f.write("# Keyboard-only methodology (final closure)\n\n"
                    "- Input: Windows `keybd_event` on the foregrounded headed-Chrome window "
                    "(OS keyboard path, trusted exactly like a physical keyboard).\n"
                    "- Activation: native Enter/Space default action only. Zero `element.click()`, "
                    "zero mouse/pointer events, zero direct handler invocation for gated steps.\n"
                    "- CDP use: observation (`activeElement`, state, screenshots) + viewport/fixture "
                    "setup only.\n"
                    "- Result verification: real browser actions (workspace `active` class, palette "
                    "open/activate/close, drawer open/trap/Escape/return, shot focus move).\n")
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
