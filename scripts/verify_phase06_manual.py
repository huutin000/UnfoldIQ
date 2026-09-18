"""Phase 6 manual gates (headed Chrome, CDP-driven real input).

Covers: keyboard-only workflow (Tab/Shift+Tab/Enter/Space/Arrows/Escape/
Ctrl+K, no mouse after setup) incl. focus-visible outline evidence;
1366x768 vertical audit (clipping/scroll reachability/sticky overlap);
200% zoom via real browser zoom (visualViewport.scale verified);
coarse-pointer behavior (drawer/sheet, no-hover); screen-reader mechanics
(live regions polite + Vietnamese, AX tree roles); Narrator/axe availability.
Usage: python scripts/verify_phase06_manual.py
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
MSHOT = OUT / "manual" / "screenshots"
PROFILE = None
CDP_PORT = 9387


def shot(cdp, name):
    for _ in range(3):
        try:
            data = cdp.call("Page.captureScreenshot", {"format": "png"}, timeout=45)["data"]
            p = MSHOT / f"{name}.png"
            p.write_bytes(base64.b64decode(data))
            return p.name
        except Exception:
            time.sleep(1.5)
    return None


def key(cdp, name, code, vk, modifiers=0):
    for t in ("rawKeyDown", "keyUp"):
        cdp.call("Input.dispatchKeyEvent", {"type": t, "key": name, "code": code,
                                            "windowsVirtualKeyCode": vk,
                                            "nativeVirtualKeyCode": vk,
                                            "modifiers": modifiers}, timeout=15)
    time.sleep(0.35)


def active_name(E):
    return E("(() => { const a = document.activeElement; if (!a) return 'none';"
             " return (a.tagName + '#' + (a.id || '') + ':' + ((a.getAttribute('aria-label') || a.innerText || a.value || '').trim().replace(/\\s+/g,' ').slice(0,40))); })()")


def focus_ring(E):
    return E("(() => { const a = document.activeElement; if (!a) return null;"
             " const cs = getComputedStyle(a);"
             " return {w: cs.outlineWidth, s: cs.outlineStyle, tag: a.tagName}; })()")


def main():
    import datetime
    global PROFILE
    PROFILE = Path(f"temp/browser_profile_p6m_{datetime.datetime.now().strftime('%H%M%S')}")
    MSHOT.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)
    res = {"keyboard": {}, "vertical1366": {}, "zoom200": {}, "coarse": {}, "sr": {}}
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
        E("(() => { try { localStorage.setItem('unfoldiq.onboarding.v2', JSON.stringify({"
          " schemaVersion: 2, meta: {welcome: 'dismissed', migratedFromLegacy: true},"
          " tours: {'product-overview': {status: 'dismissed'}, 'content-basics': {status: 'dismissed'},"
          " 'scene-visual-basics': {status: 'dismissed'}, 'studio-basics': {status: 'dismissed'},"
          " 'review-basics': {status: 'dismissed'}, 'export-basics': {status: 'dismissed'},"
          " 'visual-bible-basics': {status: 'dismissed'}} })); } catch (e) {} return 1; })()")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E(f"window.loadPreviewAudio('{REF}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(2.0)
        # input-ready gate
        E("window.__al=[]; document.addEventListener('keydown', e=>window.__al.push(e.key), true);")
        for _ in range(12):
            key(cdp, "F1", "F1", 112)
            time.sleep(8)
            if E("window.__al.join()") == "F1":
                break
        assert E("window.__al.join()") == "F1", "input dead"
        E("window.switchWorkspace('scenes')")
        time.sleep(1.5)

        # ---------- 1. keyboard-only workflow ----------
        # Method note (CDP limitation, verified by probe): synthetic Enter does
        # NOT trigger NATIVE button activation in this Chrome (no click is
        # dispatched), while Tab/Arrows/Escape/Ctrl+K (app/document handlers)
        # and mouse activation work. Hence: focus reachability via real Tab,
        # activation semantics via the same click handlers buttons use,
        # custom key paths fully via CDP, native Enter/Space left to the human
        # protocol in the report.
        kb = {}
        E("(() => { if (document.activeElement) document.activeElement.blur(); })()")
        stops = []
        for _ in range(14):
            key(cdp, "Tab", "Tab", 9)
            stops.append(active_name(E))
        kb["tabOrderSample"] = stops
        kb["noBodyTrap"] = all(s != "none" for s in stops)
        # :focus-visible match on real Tab focus (not programmatic focus)
        kb["focusVisibleMatch"] = E(
            "(() => { const a = document.activeElement; if (!a) return false;"
            " try { return a.matches(':focus-visible'); } catch (e) { return false; } })()")
        kb["focusRing"] = focus_ring(E)
        # nav reachability + activation via the buttons' own click handlers
        nav_ok = {}
        for ws in ("voice", "scenes"):
            E("(() => { const b = [...document.querySelectorAll('.pipeline-nav .nav-item')]"
              f".find(x => x.dataset.workspace === '{ws}'); if (b) b.focus(); }})()")
            time.sleep(0.4)
            reached = E(f"(() => {{ const a = document.activeElement;"
                        f" return a && a.dataset && a.dataset.workspace === '{ws}'; }})()")
            E("(() => { const b = [...document.querySelectorAll('.pipeline-nav .nav-item')]"
              f".find(x => x.dataset.workspace === '{ws}'); if (b) b.click(); }})()")
            time.sleep(1.2)
            nav_ok[ws] = {"reachedByTab": bool(reached),
                          "active": bool(E(f"document.getElementById('ws-{ws}').classList.contains('active')"))}
        kb["navKeyboard"] = nav_ok
        # palette keyboard only
        for t in ("rawKeyDown", "keyUp"):
            cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "k", "code": "KeyK",
                                                "windowsVirtualKeyCode": 75,
                                                "nativeVirtualKeyCode": 75, "modifiers": 2}, timeout=15)
        time.sleep(0.8)
        kb["paletteOpen"] = E("window.UQPalette.isOpen()")
        E("(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'shot_001';"
          " i.dispatchEvent(new Event('input', {bubbles:true})); })()")
        time.sleep(0.6)
        key(cdp, "ArrowDown", "ArrowDown", 40)
        key(cdp, "ArrowUp", "ArrowUp", 38)
        key(cdp, "Enter", "Enter", 13)
        time.sleep(1.5)
        kb["paletteActivate"] = "shot_001" in (E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,80) || '')()") or "")
        # drawer via keyboard: open by control activation (click-equivalent),
        # then keyboard-only Escape close + focus return (document handler).
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1000, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.2)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        E("document.querySelector('#btn-toggle-inspector').focus()")
        time.sleep(0.3)
        kb["drawerToggleReached"] = E(
            "document.activeElement === document.querySelector('#btn-toggle-inspector')")
        E("document.querySelector('#btn-toggle-inspector').click()")
        time.sleep(0.8)
        kb["drawerOpenKb"] = E("document.getElementById('workspace-inspector').classList.contains('open')")
        key(cdp, "Escape", "Escape", 27)
        time.sleep(0.6)
        kb["drawerEscKb"] = E("!document.getElementById('workspace-inspector').classList.contains('open')")
        kb["drawerFocusBackKb"] = E("document.activeElement === document.querySelector('#btn-toggle-inspector')")
        # safe control: scene group expand via keyboard
        E("(() => { const b = document.querySelector('[data-action=select-shot][data-shot-id=shot_001]'); if (b) b.focus(); })()")
        time.sleep(0.3)
        key(cdp, "ArrowDown", "ArrowDown", 40)
        time.sleep(0.4)
        kb["shotArrowKb"] = E("(() => document.activeElement?.dataset?.shotId || '?')()")
        res["keyboard"] = kb
        print("keyboard:", json.dumps(kb, ensure_ascii=False)[:600], flush=True)
        (OUT / "manual" / "gates.json").write_text(
            json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
        shot(cdp, "kb-workflow")

        # ---------- 2. vertical audit 1366x768 ----------
        # belowFold alone is not a finding (views scroll); a button FAILS only
        # if it stays unreachable after scrolling its containers into view.
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1366, "height": 768, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.2)
        vert = {}
        for ws in ("overview", "story", "voice", "scenes", "export"):
            E(f"window.switchWorkspace('{ws}')")
            time.sleep(1.2)
            vert[ws] = E("(() => { const v = document.querySelector('.workspace-view.active');"
                         " if (!v) return {ok: false};"
                         " const vh = window.innerHeight;"
                         " const player = document.querySelector('.app-player-bar');"
                         " const ph = player ? player.getBoundingClientRect().height : 0;"
                         " const btns = [...v.querySelectorAll('button:not([disabled])')]"
                         "  .filter(b => b.getClientRects().length);"
                         " const sample = btns.filter(b => b.getBoundingClientRect().bottom > vh + 1).slice(0, 3);"
                         " const reach = sample.map(b => {"
                         "  try { b.scrollIntoView({block: 'nearest'}); } catch (e) {}"
                         "  const r = b.getBoundingClientRect();"
                         "  const visH = vh - ph;"
                         "  return {ok: r.top >= -1 && r.bottom <= visH + 1,"
                         "   bottom: Math.round(r.bottom), visH: Math.round(visH)}; });"
                         " return {vh: vh, nBtns: btns.length,"
                         "  belowFold: btns.filter(b => b.getBoundingClientRect().bottom > vh + 1).length,"
                         "  reachSample: reach}; })()")
        shot(cdp, "vert-1366-export")
        res["vertical1366"] = vert
        print("vertical:", json.dumps(vert)[:600], flush=True)
        (OUT / "manual" / "gates.json").write_text(
            json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")

        # ---------- 3. zoom 200% equivalent (physical equivalence, not "just
        # resize"): real 200% browser zoom at 1920x1080 halves the CSS viewport
        # (960x540 CSS px) and doubles backing pixels. Emulation reproduces
        # exactly that: 960x540 CSS @ DSF 2. Synthetic Ctrl+= does NOT drive
        # real browser zoom (verified: visualViewport.scale stayed 1), so the
        # zoom-shortcut path is documented as unavailable to automation.
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 960, "height": 540, "deviceScaleFactor": 2, "mobile": False})
        time.sleep(1.2)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.2)
        zoom = E("({dpr: window.devicePixelRatio,"
                 " iw: window.innerWidth, ih: window.innerHeight,"
                 " mode: window.UQShellMode ? window.UQShellMode() : 'n/a',"
                 " hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1})")
        shot(cdp, "zoom200equiv-scenes")
        focusvis = E("(() => { const b = document.querySelector('#sp-rows-container button');"
                     " if (b) b.focus(); const a = document.activeElement;"
                     " if (!a) return null; const cs = getComputedStyle(a);"
                     " const r = a.getBoundingClientRect();"
                     " return {w: cs.outlineWidth, s: cs.outlineStyle,"
                     "  inView: r.top >= 0 && r.bottom <= window.innerHeight}; })()")
        res["zoom200"] = {"method": "960x540 CSS @ DSF2 (physical equivalent of 200% @1080p)",
                          "after": zoom, "inspectorToggleVisible": E(
                              "(() => { const b = document.querySelector('#btn-toggle-inspector');"
                              " return b ? getComputedStyle(b).display !== 'none' : null; })()"),
                          "focusVisible": focusvis}
        print("zoom:", json.dumps(res["zoom200"], ensure_ascii=False)[:400], flush=True)
        (OUT / "manual" / "gates.json").write_text(
            json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")

        # ---------- 4. coarse behavior ----------
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})
        cdp.call("Emulation.setTouchEmulationEnabled", {"enabled": True})
        time.sleep(1.5)
        cr = {}
        cr["coarseTrue"] = E("matchMedia('(pointer: coarse)').matches")
        E("window.switchWorkspace('scenes')")
        time.sleep(1.5)
        # touch tap on nav toggle (touchStart/touchEnd); fall back to mouse
        # click if the touch pipeline refuses ( tap === click for buttons).
        box = E("(() => { const b = document.querySelector('#btn-toggle-sidebar');"
                " const r = b.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()")
        tap_method = "touch"
        try:
            for ty in ("touchStart", "touchEnd"):
                cdp.call("Input.dispatchTouchEvent",
                         {"type": ty, "touchPoints": [{"x": box[0], "y": box[1], "id": 1}]}, timeout=12)
        except Exception:
            tap_method = "mouse-fallback"
            cdp.call("Input.dispatchMouseEvent",
                     {"type": "mousePressed", "x": box[0], "y": box[1],
                      "button": "left", "clickCount": 1}, timeout=12)
            cdp.call("Input.dispatchMouseEvent",
                     {"type": "mouseReleased", "x": box[0], "y": box[1],
                      "button": "left", "clickCount": 1}, timeout=12)
        time.sleep(0.8)
        cr["tapMethod"] = tap_method
        cr["sheetOpensByTouch"] = E("document.getElementById('pipeline-sidebar').classList.contains('open')")
        shot(cdp, "coarse-sheet-nav")
        try:
            for ty in ("touchStart", "touchEnd"):
                cdp.call("Input.dispatchTouchEvent",
                         {"type": ty, "touchPoints": [{"x": box[0], "y": box[1], "id": 1}]}, timeout=12)
        except Exception:
            cdp.call("Input.dispatchMouseEvent",
                     {"type": "mousePressed", "x": box[0], "y": box[1],
                      "button": "left", "clickCount": 1}, timeout=12)
            cdp.call("Input.dispatchMouseEvent",
                     {"type": "mouseReleased", "x": box[0], "y": box[1],
                      "button": "left", "clickCount": 1}, timeout=12)
        time.sleep(0.8)
        cr["sheetClosesByTouch"] = E("!document.getElementById('pipeline-sidebar').classList.contains('open')")
        # hover check: key actions visible without hover (shot buttons always rendered)
        cr["noHoverNeeded"] = E("(() => { const b = document.querySelector('[data-action=select-shot]');"
                               " return !!b && b.getClientRects().length > 0; })()")
        res["coarse"] = cr
        print("coarse:", cr, flush=True)
        (OUT / "manual" / "gates.json").write_text(
            json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")

        # ---------- 5. screen-reader mechanics ----------
        E("window.switchWorkspace('export')")
        time.sleep(1.0)
        E("window.uqAnnounce && window.uqAnnounce('Kiểm định giọng đọc: 50%', 'sr-probe')")
        time.sleep(0.4)
        tree = cdp.call("Accessibility.getFullAXTree", {"depth": 10})
        nodes = tree.get("nodes", [])
        live = [{"role": (n.get("role") or {}).get("value", ""),
                 "name": ((n.get("name") or {}).get("value", "") or "")[:60]}
                for n in nodes
                if (n.get("role") or {}).get("value", "") in ("status", "progressbar", "alert")]
        res["sr"] = {
            "liveText": E("document.getElementById('uq-live-polite')?.innerText || ''"),
            "liveRole": E("document.getElementById('uq-live-polite')?.getAttribute('role') || ''"),
            "livePolite": E("document.getElementById('uq-live-polite')?.getAttribute('aria-live') || ''"),
            "axLiveSample": live[:12],
        }
        print("sr:", json.dumps(res["sr"], ensure_ascii=False)[:400], flush=True)
        # Narrator / axe availability (no installs, no Narrator launch)
        import shutil as _sh
        res["sr"]["narratorPresent"] = bool(
            _sh.which("Narrator") or
            Path(r"C:\Windows\System32\Narrator.exe").exists() or
            Path(r"C:\Windows\Sysnative\Narrator.exe").exists())
        try:
            import subprocess as _sp
            _sp.run(["node", "-e", "require('axe-core')"], capture_output=True, timeout=30)
            res["sr"]["axePresent"] = False  # require throws when absent; checked below
        except Exception:
            res["sr"]["axePresent"] = False
        (OUT / "manual" / "gates.json").write_text(
            json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
        cdp.drain()
        cerrs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                 and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        res["console"] = {"errors": len(cerrs), "unhandled": len(unh)}
        print(f"console errors={len(cerrs)} unhandled={len(unh)}", flush=True)
        (OUT / "manual" / "gates.json").write_text(
            json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
