"""Phase 6 browser verification (headed Chrome, CDP).

Covers: screenshot matrix (11 viewports), breakpoint edges (1280/1279,
959/960), horizontal/vertical overflow detectors, 1366x768 five-workbench
smoke, 320 reflow checks, laptop Drawer + narrow Sheet modal semantics
(role/trap/Escape/focus-return/body-lock), hidden tabbables, resize
transitions, palette at narrow modes, accessibility-tree dump.
Usage: python scripts/verify_phase06_browser.py
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
OUT = Path("temp/phase06_verification")
SHOT = OUT / "browser" / "screenshots"
PROFILE = None  # fresh timestamped profile per run (no cross-run cache doubt)
CDP_PORT = 9370

VIEWPORTS = [(1920, 1080), (1440, 900), (1366, 768), (1280, 800),
             (1278, 800), (1024, 768), (960, 768), (958, 900),
             (768, 1024), (390, 844), (320, 800)]
WORKBENCHES = ["overview", "story", "voice", "scenes", "export"]
TRAP_SEL = ('button:not([disabled]), a[href], input:not([disabled]), '
            'select:not([disabled]), textarea:not([disabled]), '
            '[tabindex]:not([tabindex="-1"])')
# Product predicate (mirrors trapVisibleEls): HTMLElement + rects + visible.
TRAP_VIS = ("(root) => Array.from(root.querySelectorAll('" + TRAP_SEL + "'))"
            " .filter(el => !el.disabled && (el instanceof HTMLElement)"
            " && el.getClientRects().length > 0"
            " && getComputedStyle(el).visibility !== 'hidden')")


def shot(cdp, name, tries=4):
    last = None
    for _ in range(tries):
        try:
            data = cdp.call("Page.captureScreenshot", {"format": "png"}, timeout=45)["data"]
            p = SHOT / f"{name}.png"
            p.write_bytes(base64.b64decode(data))
            return p.name
        except Exception as ex:
            last = ex
            time.sleep(1.5)
    raise last


def set_viewport(cdp, w, h):
    cdp.call("Emulation.setDeviceMetricsOverride",
             {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False})
    time.sleep(1.2)


def overflow_state(E):
    return E("(() => { const d = document.documentElement, b = document.body;"
             " return {docSW: d.scrollWidth, docCW: d.clientWidth,"
             " bodySW: b.scrollWidth, bodyCW: b.clientWidth,"
             " pageHScroll: d.scrollWidth > d.clientWidth + 1}; })()")


def shell_state(E):
    return E("(() => { const cs = s => getComputedStyle(document.querySelector(s));"
             " const sb = document.getElementById('pipeline-sidebar');"
             " const ins = document.getElementById('workspace-inspector');"
             " const grid = getComputedStyle(document.querySelector('.workstation-body')).gridTemplateColumns;"
             " const r = s => { const el = document.querySelector(s); if (!el) return null;"
             "  const b = el.getBoundingClientRect();"
             "  return {w: Math.round(b.width), sw: el.scrollWidth, cw: el.clientWidth}; };"
             " return {w: window.innerWidth,"
             " sidebarDisplay: sb ? cs('#pipeline-sidebar').display : 'missing',"
             " sidebarOpen: sb ? sb.classList.contains('open') : null,"
             " sidebarRole: sb ? sb.getAttribute('role') : null,"
             " sidebarRect: r('#pipeline-sidebar'),"
             " inspectorDisplay: ins ? cs('#workspace-inspector').display : 'missing',"
             " inspectorOpen: ins ? ins.classList.contains('open') : null,"
             " inspectorRole: ins ? ins.getAttribute('role') : null,"
             " grid: grid}; })()")


def key(cdp, name, code, vk, modifiers=0):
    for t in ("rawKeyDown", "keyUp"):
        cdp.call("Input.dispatchKeyEvent", {"type": t, "key": name, "code": code,
                                            "windowsVirtualKeyCode": vk,
                                            "nativeVirtualKeyCode": vk,
                                            "modifiers": modifiers}, timeout=15)
    time.sleep(0.3)


def main():
    import datetime
    global PROFILE
    PROFILE = Path(f"temp/browser_profile_p6_{datetime.datetime.now().strftime('%H%M%S')}")
    SHOT.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)
    res = {"viewports": {}, "edges": {}, "drawer": {}, "hidden_tabbables": {},
           "resize": {}, "palette_narrow": {}, "ax": {}}
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
    chrome = subprocess.Popen([CHROME, f"--remote-debugging-port={CDP_PORT}",
                               f"--user-data-dir={PROFILE.resolve()}",
                               "--no-first-run", "--no-default-browser-check",
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
        cdp.call("Page.enable"); cdp.call("Runtime.enable")
        cdp.call("Log.enable"); cdp.call("Network.enable")
        cdp.call("Accessibility.enable")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E = cdp.evaluate
        # Phase 6: preset guide store (all tours dismissed) BEFORE app boot
        # semantics matter — first-visit auto-tours steal focus/Escape and
        # would pollute drawer/focus verification (product-intended behavior,
        # disabled here as documented test setup, no product change).
        E("(() => { try { localStorage.setItem('unfoldiq.onboarding.v2', JSON.stringify({"
          " schemaVersion: 2, meta: {welcome: 'dismissed', migratedFromLegacy: true},"
          " tours: {'product-overview': {version: 1, status: 'dismissed'},"
          " 'content-basics': {version: 1, status: 'dismissed'},"
          " 'scene-visual-basics': {version: 1, status: 'dismissed'},"
          " 'studio-basics': {version: 1, status: 'dismissed'},"
          " 'review-basics': {version: 1, status: 'dismissed'},"
          " 'export-basics': {version: 1, status: 'dismissed'},"
          " 'visual-bible-basics': {version: 1, status: 'dismissed'}} }));"
          " } catch (e) {} return true; })()")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E(f"window.loadPreviewAudio('{REF}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        E("""(() => { const b = Array.from(document.querySelectorAll('button'))
          .find(x => (x.innerText||'').includes('Khám phá sau')); if (b) b.click(); })()""")
        time.sleep(0.8)
        E("""(() => { const a = document.getElementById('audio-player');
          if (a) { try { a.pause(); } catch (e) {} a.removeAttribute('src'); a.load(); } })()""")
        time.sleep(1.0)
        # Phase 6: dismiss the auto-start product tour FIRST — its overlay
        # owns focus/Escape while open and would pollute every drawer test.
        E("(() => { const s = document.getElementById('tour-btn-skip'); if (s) s.click(); })()")
        time.sleep(1.2)
        res["tour"] = E("(() => { const s = document.getElementById('tour-btn-skip');"
                        " return {skipClicked: true,"
                        " skipStillVisible: !!(s && s.offsetParent !== null)}; })()")
        print("tour:", res["tour"], flush=True)

        # ---- 1. screenshot matrix + overflow per viewport ----
        for w, h in VIEWPORTS:
            set_viewport(cdp, w, h)
            E("window.switchWorkspace('scenes')")
            time.sleep(1.2)
            ov = overflow_state(E)
            sh = shell_state(E)
            mode = E("window.UQShellMode ? window.UQShellMode() : 'n/a'")
            fn = shot(cdp, f"vp-{w}x{h}")
            res["viewports"][f"{w}x{h}"] = {"overflow": ov, "shell": sh, "mode": mode, "shot": fn}
            print(f"vp {w}x{h}: hscroll={ov['pageHScroll']} grid={sh['grid'][:40]} mode={mode}", flush=True)

        # ---- 2. breakpoint edges ----
        # Chromium emulation rounds fractional viewports (961->962) and
        # matchMedia at exact odd boundaries misfires (1279/959 false);
        # edges are therefore probed at exact even neighbors that DO
        # discriminate (1278/1280, 958/960); exact query strings are pinned
        # by focused tests instead.
        for w, h, tag in ((1280, 800, "edge-1280"), (1278, 800, "edge-1278"),
                          (960, 768, "edge-960"), (958, 768, "edge-958")):
            set_viewport(cdp, w, h)
            E("window.switchWorkspace('scenes')")
            time.sleep(1.2)
            sh = shell_state(E)
            trig = E("(() => { const t = s => { const b = document.querySelector(s);"
                     " return b ? (getComputedStyle(b).display !== 'none') : null; };"
                     " return {sidebarToggle: t('#btn-toggle-sidebar'),"
                     " inspectorToggle: t('#btn-toggle-inspector')}; })()")
            res["edges"][tag] = {"shell": sh, "triggers": trig}
            print(tag, sh["grid"][:44], "sb:", sh["sidebarDisplay"], "ins:", sh["inspectorDisplay"], flush=True)

        # ---- 3. five-workbench smoke at 1366x768 + 320 ----
        for w, h in ((1366, 768), (320, 800)):
            set_viewport(cdp, w, h)
            sm = {}
            for ws in WORKBENCHES:
                E(f"window.switchWorkspace('{ws}')")
                time.sleep(1.0)
                vis = E(f"(() => {{ const v = document.getElementById('ws-{ws}');"
                         " if (!v) return 'missing';"
                         " const r = v.getBoundingClientRect();"
                         " return {active: v.classList.contains('active'),"
                         " w: Math.round(r.width), h: Math.round(r.height),"
                         " blank: (v.innerText||'').trim().length < 20}; })()")
                sm[ws] = vis
            shot(cdp, f"smoke-{w}x{h}-export")
            res[f"smoke_{w}x{h}"] = sm
            print(f"smoke {w}x{h}:", json.dumps(sm)[:220], flush=True)

        # ---- 4. Drawer modal semantics (tour confirmed gone + async content
        # settled: inspector re-renders on load would detach trap refs) ----
        tour_gone = E("!!document.getElementById('tour-btn-skip') && "
                      "document.getElementById('tour-btn-skip').offsetParent !== null")
        stable = E("document.getElementById('workspace-inspector').innerHTML.length")
        time.sleep(2.5)
        stable2 = E("document.getElementById('workspace-inspector').innerHTML.length")
        res["drawer_settle"] = {"tourOverlayBack": tour_gone, "inspectorStable": stable == stable2}
        print("drawer settle:", res["drawer_settle"], flush=True)
        # Input-ready gate with warmup retries: CDP input dispatched too early
        # after browser launch is silently dropped (startup race). Abort LOUDLY
        # instead of recording false failures.
        E("window.__aliveLog = []; document.addEventListener('keydown',"
          " e => window.__aliveLog.push(e.key), true);")
        alive = ""
        for _retry in range(12):
            cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "F1", "code": "F1",
                                                "windowsVirtualKeyCode": 112,
                                                "nativeVirtualKeyCode": 112, "modifiers": 0}, timeout=15)
            cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "F1", "code": "F1",
                                                "windowsVirtualKeyCode": 112,
                                                "nativeVirtualKeyCode": 112, "modifiers": 0}, timeout=15)
            time.sleep(8)
            alive = E("window.__aliveLog.join(',')")
            if alive == "F1":
                break
        res["input_alive"] = alive
        print("input_alive:", res["input_alive"], flush=True)
        assert res["input_alive"] == "F1", "CDP input pipeline dead — aborting drawer tests"
        for w, tag, btn, panel in ((1000, "drawer-inspector", "#btn-toggle-inspector", "workspace-inspector"),
                                   (800, "sheet-nav", "#btn-toggle-sidebar", "pipeline-sidebar"),
                                   (800, "sheet-inspector", "#btn-toggle-inspector", "workspace-inspector")):
            set_viewport(cdp, w, 800)
            E("window.switchWorkspace('scenes')")
            time.sleep(1.0)
            opener_info = E(f"(() => {{ const b = document.querySelector('{btn}'); if (b) b.focus();"
                            " return document.activeElement === b; })()")
            E(f"document.querySelector('{btn}').click()")
            time.sleep(0.8)
            st = E("(() => { const p = document.getElementById('" + panel + "');"
                   " const F = '" + TRAP_SEL + "';"
                   " const vis = (root) => Array.from(root.querySelectorAll(F))"
                   " .filter(el => !el.disabled && (el instanceof HTMLElement) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');"
                   " const f = vis(p);"
                   " return {open: p.classList.contains('open'), role: p.getAttribute('role'),"
                   " modal: p.getAttribute('aria-modal'), label: p.getAttribute('aria-label'),"
                   " focusInside: p.contains(document.activeElement),"
                   " nFocusable: f.length,"
                   " backdrop: document.getElementById('drawer-backdrop').classList.contains('active'),"
                   " bodyLock: document.body.style.overflow}; })()")
            # focus-inside is polled (trap focuses at +50ms; async steals settle)
            for _fi in range(3):
                if not st or st.get("focusInside"):
                    break
                time.sleep(0.7)
                st["focusInside"] = E("document.getElementById('" + panel + "').contains(document.activeElement)")
            st["focusInsideSettled"] = bool(st and st.get("focusInside"))
            # Tab wrap: focus trap-last, Tab -> first; first, Shift+Tab -> last
            wrap = E("(() => { const p = document.getElementById('" + panel + "');"
                     " const F = '" + TRAP_SEL + "';"
                     " const f = Array.from(p.querySelectorAll(F))"
                     " .filter(el => !el.disabled && (el instanceof HTMLElement) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');"
                     " if (f.length < 2) return 'too-few';"
                     " f[f.length-1].focus(); return document.activeElement === f[f.length-1]; })()")
            key(cdp, "Tab", "Tab", 9)
            wrap1 = E("(() => { const p = document.getElementById('" + panel + "');"
                      " const F = '" + TRAP_SEL + "';"
                      " const f = Array.from(p.querySelectorAll(F))"
                      " .filter(el => !el.disabled && (el instanceof HTMLElement) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');"
                      " return p.contains(document.activeElement) && document.activeElement === f[0]; })()")
            key(cdp, "Tab", "Tab", 9, modifiers=0)
            # Shift+Tab from first -> last
            E("(() => { const p = document.getElementById('" + panel + "');"
              " const F = '" + TRAP_SEL + "';"
              " const f = Array.from(p.querySelectorAll(F))"
              " .filter(el => !el.disabled && (el instanceof HTMLElement) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');"
              " if (f[0]) f[0].focus(); })()")
            for t in ("rawKeyDown", "keyUp"):
                cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "Tab", "code": "Tab",
                                                    "windowsVirtualKeyCode": 9,
                                                    "nativeVirtualKeyCode": 9, "modifiers": 8}, timeout=15)
            time.sleep(0.3)
            wrap2 = E("(() => { const p = document.getElementById('" + panel + "');"
                      " const F = '" + TRAP_SEL + "';"
                      " const f = Array.from(p.querySelectorAll(F))"
                      " .filter(el => !el.disabled && (el instanceof HTMLElement) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');"
                      " return p.contains(document.activeElement)"
                      " && document.activeElement === f[f.length-1]; })()")
            # Escape -> close + focus return to opener toggle
            key(cdp, "Escape", "Escape", 27)
            time.sleep(0.5)
            after = E(f"(() => {{ const p = document.getElementById('{panel}');"
                      " const t = document.querySelector('" + btn + "');"
                      " return {closed: !p.classList.contains('open'),"
                      " focusOnOpener: document.activeElement === t,"
                      " bodyLock: document.body.style.overflow}; })()")
            res["drawer"][tag] = {"openerFocused": opener_info, "openState": st,
                                  "tabWrap": [wrap, wrap1, wrap2], "escape": after}
            print(tag, json.dumps(res["drawer"][tag])[:400], flush=True)

        # ---- 4b. closeAll reaction path directly (resize handler funnels here;
        # detection is covered by UQShellMode flips across widths above) ----
        set_viewport(cdp, 800, 800)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        E("window.UQDrawer.open(document.getElementById('workspace-inspector'),"
          " document.querySelector('#btn-toggle-inspector'))")
        time.sleep(0.8)
        E("(() => { const p = document.getElementById('workspace-inspector');"
          " const f = [...p.querySelectorAll('button:not([disabled])')]"
          " .filter(el => el.getClientRects().length > 0);"
          " if (f[0]) f[0].focus(); })()")
        time.sleep(0.3)
        res["closeall_direct"] = E("(() => {"
            " window.UQDrawer.closeAll({refocus: false});"
            " const p = document.getElementById('workspace-inspector');"
            " const t = document.querySelector('#btn-toggle-inspector');"
            " return {closed: !p.classList.contains('open'),"
            " roleGone: !p.getAttribute('role'), modalGone: !p.getAttribute('aria-modal'),"
            " parkedOnToggle: document.activeElement === t,"
            " lock: document.body.style.overflow}; })()")
        print("closeall_direct:", res["closeall_direct"], flush=True)
        # ---- 5. hidden tabbables (drawers closed, narrow drawer-mode) ----
        # rects-based visibility (bulletproof vs offsetParent quirks) ----
        set_viewport(cdp, 800, 800)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        res["hidden_tabbables"] = E("(() => {"
            " const F = '" + TRAP_SEL + "';"
            " const visCount = root => Array.from(root.querySelectorAll(F))"
            "  .filter(el => !el.disabled && el.getClientRects().length > 0).length;"
            " const out = {};"
            " [['pipeline-sidebar'],['workspace-inspector']].forEach(([id]) => {"
            "  const p = document.getElementById(id);"
            "  out[id] = {display: getComputedStyle(p).display, visibleFocusable: visCount(p)}; });"
            " out.visibleFocusableInHiddenViews = Array.from("
            "  document.querySelectorAll('.workspace-view:not(.active)'))"
            "  .reduce((n, v) => n + visCount(v), 0);"
            " return out; })()")
        print("hidden:", json.dumps(res["hidden_tabbables"])[:300], flush=True)

        # ---- 6. resize behavior: detection (UQShellMode flips across widths)
        # + reaction (closeAll path, proven by closeall_direct). The lab window
        # manager refuses setWindowBounds resizes, and emulation neither fires
        # resize nor hits integral edges — both documented limitations.
        res["mode_flips"] = {}
        for w, tag in ((1400, "wide"), (1000, "laptop"), (800, "narrow")):
            set_viewport(cdp, w, 800)
            time.sleep(0.8)
            res["mode_flips"][tag] = {"inner": E("window.innerWidth"),
                                      "mode": E("window.UQShellMode ? window.UQShellMode() : 'n/a'")}
        print("mode_flips:", res["mode_flips"], flush=True)
        ver = json.loads(urllib.request.urlopen(
            f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=5).read())
        bcdp = CDP(ver["webSocketDebuggerUrl"])
        page_id = next(t.get("id") for t in tg if t.get("type") == "page")
        try:
            cdp.call("Emulation.clearDeviceMetricsOverride")
        except Exception:
            pass
        time.sleep(1.0)
        # Best-effort real resize (lab WM refuses: inner never changes).
        # resize reaction: open drawer at narrow width if the WM cooperated,
        # else record the refusal (reaction already proven by closeall_direct)
        inner_narrow = E("window.innerWidth")
        res["resize"] = {"innerNarrow": inner_narrow}
        if inner_narrow < 1280:
            E("window.switchWorkspace('scenes')")
            time.sleep(1.0)
            E("document.querySelector('#btn-toggle-inspector').click()")
            time.sleep(0.6)
            res["resize"]["wasOpenAtNarrow"] = E(
                "document.getElementById('workspace-inspector').classList.contains('open')")
        try:
            win = bcdp.call("Browser.getWindowForTarget", {"targetId": page_id}).get("windowId")
            bcdp.call("Browser.setWindowBounds", {"windowId": win, "bounds": {"width": 1500, "height": 900}})
            time.sleep(2.0)
        except Exception as ex:
            res["resize"]["boundsError"] = str(ex)[:120]
        res["resize"]["innerAfter"] = E("window.innerWidth")
        res["resize"]["note"] = ("resized" if res["resize"]["innerAfter"] != inner_narrow
                                 else "WM refused (inner unchanged); see closeall_direct + mode_flips")
        print("resize:", json.dumps(res["resize"])[:400], flush=True)
        bcdp.ws.close()

        # ---- 7. palette at 320 ----
        set_viewport(cdp, 320, 800)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        for t in ("rawKeyDown", "keyUp"):
            cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "k", "code": "KeyK",
                                                "windowsVirtualKeyCode": 75,
                                                "nativeVirtualKeyCode": 75, "modifiers": 2}, timeout=15)
        time.sleep(0.8)
        res["palette_narrow"] = E("(() => { const d = document.querySelector('.uq-cmd-dialog');"
            " if (!d) return {open: false}; const r = d.getBoundingClientRect();"
            " return {open: true, w: Math.round(r.width), vw: window.innerWidth,"
            " fits: r.width <= window.innerWidth + 1, inputVisible: !!document.getElementById('uq-cmd-input')}; })()")
        shot(cdp, "palette-320")
        key(cdp, "Escape", "Escape", 27)
        print("palette320:", res["palette_narrow"], flush=True)

        # ---- 8. accessibility tree dump ----
        E("window.switchWorkspace('scenes')")
        time.sleep(0.8)
        tree = cdp.call("Accessibility.getFullAXTree", {"depth": 8})
        nodes = tree.get("nodes", [])
        keep = []
        for n in nodes:
            role = (n.get("role") or {}).get("value", "")
            name = (n.get("name") or {}).get("value", "")
            if role in ("navigation", "dialog", "complementary", "button", "searchbox",
                        "listbox", "option", "tablist", "tab", "status", "progressbar") and name:
                keep.append({"role": role, "name": name[:60]})
                if len(keep) > 120:
                    break
        res["ax"] = {"totalNodes": len(nodes), "namedSample": keep[:60]}
        (OUT / "browser" / "ax_tree.json").write_text(
            json.dumps(res["ax"], indent=1, ensure_ascii=False), encoding="utf-8")

        (OUT / "browser" / "matrix.json").write_text(
            json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
        try:
            cdp.drain()
        except OSError:
            pass
        cerrs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        print(f"console errors={len(cerrs)} unhandled={len(unh)}", flush=True)
        res["console"] = {"errors": len(cerrs), "unhandled": len(unh)}
        (OUT / "browser" / "matrix.json").write_text(
            json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
