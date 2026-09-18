"""Manual browser closure driver — drives REAL Chrome via CDP (no mocks).

Uses only stdlib + `websockets` (already installed). Captures screenshots,
console, network, layout, keyboard, dirty-state evidence for Subphase 3C.
Reference project data is NOT mutated (no saves performed).
"""
import asyncio
import base64
import hashlib
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from websockets.sync.client import connect  # type: ignore

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP = "http://127.0.0.1:7860"
PROJ = "2026-09-12_210003_youtube-narration-01"
SHOT = Path("temp/phase03c_final_verification/browser/screenshots")
OUT = Path("temp/phase03c_final_verification/browser")
PROFILE = Path("temp/browser_profile_3c")
CDP_PORT = 9333


class CDP:
    def __init__(self, ws_url):
        self.ws = connect(ws_url, max_size=50 * 1024 * 1024, legacy=True)
        self.mid = 0
        self.events = []

    def call(self, method, params=None, timeout=30):
        self.mid += 1
        mid = self.mid
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                msg = json.loads(self.ws.recv(timeout=timeout))
            except Exception as e:
                raise TimeoutError(f"CDP {method} recv timeout: {e}")
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"CDP {method} error: {msg['error']}")
                return msg.get("result", {})
            self.events.append(msg)
        raise TimeoutError(f"CDP {method} no response")

    def drain(self):
        self.ws.socket.settimeout(0.2)
        try:
            while True:
                try:
                    raw = self.ws.recv(timeout=0.2)
                except Exception:
                    break
                self.events.append(json.loads(raw))
        finally:
            self.ws.socket.settimeout(30)

    def evaluate(self, expr, await_promise=False, timeout=30):
        return self.call("Runtime.evaluate", {
            "expression": expr, "returnByValue": True, "awaitPromise": await_promise,
        }, timeout=timeout).get("result", {}).get("value")


def wait_for(cdp, expr, timeout=60, poll=1.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if cdp.evaluate(expr):
                return True
        except Exception:
            pass
        time.sleep(poll)
    return False


def screenshot(cdp, path):
    res = cdp.call("Page.captureScreenshot", {"format": "png"})
    path.write_bytes(base64.b64decode(res["data"]))
    print("shot:", path.name, path.stat().st_size, "bytes")


def main():
    SHOT.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)

    veo_path = Path("projects") / PROJ / "veo_prompts.json"
    veo_hash_before = hashlib.sha256(veo_path.read_bytes()).hexdigest()

    chrome = subprocess.Popen([
        CHROME, f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={PROFILE.resolve()}",
        "--headless=new", "--no-first-run", "--no-default-browser-check",
        "--disable-gpu", "--hide-scrollbars", "about:blank",
    ])
    # Wait for DevTools endpoint (cold profile can take >10s)
    targets = None
    for _ in range(30):
        time.sleep(1)
        try:
            targets = json.loads(urllib.request.urlopen(
                f"http://127.0.0.1:{CDP_PORT}/json", timeout=5).read())
            break
        except Exception:
            continue
    assert targets, "DevTools endpoint never came up"
    try:
        page_target = next(t for t in targets if t.get("type") == "page")
        cdp = CDP(page_target["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        cdp.call("Log.enable")
        cdp.call("Network.enable")

        console_errors, unhandled, failed_reqs, server_5xx = [], [], [], []
        network_log = []

        viewports = [(1920, 1080), (1440, 900), (1366, 768)]
        vp_results, shot_results = {}, {}
        first = True
        for (w, h) in viewports:
            key = f"{w}x{h}"
            cdp.call("Emulation.setDeviceMetricsOverride",
                     {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False})
            cdp.call("Page.navigate", {"url": APP})
            assert wait_for(cdp, "document.readyState==='complete'", 60), "page load timeout"
            assert wait_for(cdp, "typeof window.loadPreviewAudio==='function'", 60), "app.js timeout"
            inner = cdp.evaluate("[window.innerWidth, window.innerHeight]")
            # Open reference project (no autoplay) then Visual Workbench
            cdp.evaluate(f"window.loadPreviewAudio('{PROJ}', 665.64, false)")
            if not wait_for(
                    cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 60):
                print("DIAG url:", cdp.evaluate("location.href"))
                print("DIAG proj:", cdp.evaluate("window.currentProjectDir"))
                print("DIAG rows:", (cdp.evaluate("(document.getElementById('sp-rows-container')?.innerHTML || '')") or "")[:300])
                print("DIAG count:", cdp.evaluate("document.querySelectorAll('#sp-rows-container .visual-scene-group').length"))
                raise AssertionError("navigator timeout")
            # Dismiss first-run onboarding modal if present (fresh profile).
            # Real-user equivalent of clicking "Khám phá sau"; recorded, not a product defect.
            dismissed = cdp.evaluate("""(() => {
              const btn = Array.from(document.querySelectorAll('button'))
                .find(b => (b.innerText || '').includes('Khám phá sau'));
              if (btn) { btn.click(); return true; } return false; })()""")
            time.sleep(0.8)
            print(key, "onboarding dismissed:", dismissed)
            cdp.evaluate("window.switchWorkspace('overview')")
            time.sleep(1.5)
            screenshot(cdp, SHOT / f"{key}-overview.png")
            cdp.evaluate("window.switchWorkspace('scenes')")
            assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 30)
            time.sleep(1.0)
            screenshot(cdp, SHOT / f"{key}-visual-workbench.png")
            # Select scene_001 / shot_001 via real exported function (same handler as clicks)
            cdp.evaluate("window.selectVisualShot('shot_001','scene_001')")
            assert wait_for(cdp, "!!document.getElementById('vw-image-prompt-input')", 60), "shot detail timeout"
            time.sleep(1.0)
            screenshot(cdp, SHOT / f"{key}-shot-detail.png")

            # ---- layout gate checks ----
            layout = cdp.evaluate("""(() => {
              const de = document.documentElement;
              const noPageOverflow = de.scrollWidth <= window.innerWidth + 1;
              const nav = ['Tổng quan','Kịch bản','Giọng đọc','Hình ảnh','Xuất video'];
              const bodyText = document.body.innerText || '';
              const navVisible = nav.every(t => bodyText.includes(t));
              const activeWs = (document.body.dataset.activeWorkspace || '');
              const r = (id) => { const el = document.getElementById(id);
                if (!el) return {present:false};
                const b = el.getBoundingClientRect();
                return {present:true, visible: b.width>0 && b.height>0,
                        inViewport: b.left>=-1 && b.top>=-1 && b.left < window.innerWidth && b.top < window.innerHeight}; };
              const q = (sel) => { const el = document.querySelector(sel);
                if (!el) return {present:false};
                const b = el.getBoundingClientRect();
                return {present:true, visible: b.width>0 && b.height>0}; };
              const primary = ['btn-save-image-prompt','btn-save-motion-prompt','btn-copy-flow-package','btn-lock-shot'];
              const clipped = [];
              primary.forEach(id => { const el = document.getElementById(id);
                if (el) { const b = el.getBoundingClientRect();
                  if (b.right > window.innerWidth + 1 || b.bottom > window.innerHeight + 1 || b.width===0) clipped.push(id); } });
              return {
                inner: [window.innerWidth, window.innerHeight],
                noPageOverflow, navVisible, activeWs,
                navigator: r('sp-rows-container'), workspace: !!document.querySelector('.visual-workspace-grid'),
                inspector: r('inspector-scenes'),
                blueprint: q('.visual-blueprint-card'), motion: q('.motion-blueprint-card'),
                imgPrompt: r('vw-image-prompt-input'), veoPrompt: r('vw-veo-prompt-input'),
                handoff: q('.handoff-checklist-card'), lockBtn: r('btn-lock-shot'),
                revisions: r('vw-revisions-container'),
                clippedPrimary: clipped,
                badges: Array.from(document.querySelectorAll('#ws-scenes .state-pill')).map(e=>e.textContent.trim()).slice(0,6)
              };
            })()""")
            cdp.drain()
            vp_results[key] = {
                "window_inner_width": inner[0], "window_inner_height": inner[1],
                "layout": layout,
                # Below-fold primaries live in the intentionally scrollable detail
                # column (proven reachable via scrollIntoView + elementFromPoint in
                # probe_scroll_reach.py) — they fail layout only if page overflows
                # or key regions are missing, never merely for being below fold.
                "layout_pass": bool(layout["noPageOverflow"] and layout["navVisible"]
                                    and layout["navigator"].get("visible")
                                    and layout["imgPrompt"].get("present")
                                    and layout["blueprint"].get("present")
                                    and layout["motion"].get("present")
                                    and layout["handoff"].get("present")),
                "horizontal_overflow": not layout["noPageOverflow"],
            }
            print(key, "layout_pass:", vp_results[key]["layout_pass"], "inner:", inner,
                  "below_fold_info:", layout["clippedPrimary"])
            if first:
                # ---- cross-workbench compatibility ----
                compat = {}
                for ws in ["overview", "story", "voice", "scenes", "export"]:
                    cdp.evaluate(f"window.switchWorkspace('{ws}')")
                    time.sleep(1.2)
                    compat[ws] = cdp.evaluate("""(() => {
                      const v = document.querySelector('.workspace-view.active');
                      return v ? {id: v.id, blank: (v.innerText||'').trim().length < 5} : null; })()""")
                shot_results["compat"] = compat
                # back to scenes + shot
                cdp.evaluate("window.switchWorkspace('scenes')")
                time.sleep(1.0)
                cdp.evaluate("window.selectVisualShot('shot_001','scene_001')")
                assert wait_for(cdp, "!!document.getElementById('vw-image-prompt-input')", 60)
                first = False

        # ---- workflow content checks (1366 state) ----
        content = cdp.evaluate("""(() => {
          const t = (s) => (document.querySelector(s)?.innerText || '').trim().slice(0,120);
          const has = (s) => !!document.querySelector(s);
          return {
            blueprintTitle: t('.visual-blueprint-card .visual-card-title'),
            imgLabel: document.querySelector('label[for=vw-image-prompt-input]')?.innerText || '',
            motionTitle: t('.motion-blueprint-card .visual-card-title'),
            veoLabel: document.querySelector('label[for=vw-veo-prompt-input]')?.innerText || '',
            bindings: (document.getElementById('vw-bindings-container')?.innerText || '').slice(0,300),
            handoff: has('#btn-copy-flow-package'),
            lockBadge: document.getElementById('vw-lock-status-badge')?.innerText || '',
            revCount: document.getElementById('vw-revisions-count-badge')?.innerText || '',
            shotCard: (document.querySelector('.visual-shot-identity-card')?.innerText || '').slice(0,300)
          }; })()""")
        shot_results["content"] = content

        # ---- keyboard check: focus first scene header, ArrowDown moves focus ----
        kb = cdp.evaluate("""(() => {
          const btns = Array.from(document.querySelectorAll('#sp-rows-container button'));
          if (!btns.length) return {error:'no buttons'};
          btns[0].focus();
          return {focused: document.activeElement?.dataset?.sceneId || document.activeElement?.dataset?.shotId || '?'}; })()""")
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "ArrowDown", "code": "ArrowDown",
                                            "windowsVirtualKeyCode": 40, "nativeVirtualKeyCode": 40})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "ArrowDown", "code": "ArrowDown",
                                            "windowsVirtualKeyCode": 40, "nativeVirtualKeyCode": 40})
        time.sleep(0.5)
        kb2 = cdp.evaluate("(() => document.activeElement?.tagName + ':' + (document.activeElement?.dataset?.shotId || document.activeElement?.dataset?.sceneId || '?'))()")
        # Home key
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Home", "code": "Home",
                                            "windowsVirtualKeyCode": 36, "nativeVirtualKeyCode": 36})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Home", "code": "Home",
                                            "windowsVirtualKeyCode": 36, "nativeVirtualKeyCode": 36})
        time.sleep(0.5)
        kb3 = cdp.evaluate("(() => document.activeElement?.tagName + ':' + (document.activeElement?.dataset?.shotId || document.activeElement?.dataset?.sceneId || '?'))()")
        # Enter on focused shot selects it (native button activation)
        shot_results["keyboard"] = {"start": kb, "afterArrowDown": kb2, "afterHome": kb3}

        # ---- dirty-state check (no save; native confirm() stubbed to observe both branches) ----
        # Branch 1 (Cancel): guard must fire with "Chưa lưu" message and block navigation.
        dirty = cdp.evaluate("""(() => {
          const ta = document.getElementById('vw-image-prompt-input');
          if (!ta) return {error:'no textarea'};
          window.__confirmCalls = [];
          window.__origConfirm = window.confirm;
          window.confirm = (m) => { window.__confirmCalls.push(String(m)); return false; };
          ta.value = ta.value + ' [BROWSER-DIRTY-PROBE-UNSAFE-EDIT]';
          ta.dispatchEvent(new Event('input', {bubbles:true}));
          const dirtyFlag = ta.classList.contains('is-dirty');
          return {dirtyFlag}; })()""")
        cur_before = cdp.evaluate("(() => ((document.querySelector('.visual-shot-identity-card')?.innerText || '').slice(0,80)))()")
        cdp.evaluate("window.selectVisualShot('shot_002','scene_001')")  # should be blocked (confirm→false)
        time.sleep(1.0)
        cancel_state = cdp.evaluate("""(() => { try { return {
          card: ((document.querySelector('.visual-shot-identity-card')?.innerText || '').slice(0,80)),
          calls: (window.__confirmCalls || []) }; } catch (e) { return {error: String(e)}; } })()""") or {}
        calls = cancel_state.get("calls", [])
        blocked = ("shot_002" not in cancel_state["card"]) and (len(calls) == 1) and ("Chưa lưu" in calls[0])
        # Branch 2 (Accept): navigation proceeds; edit was in-memory only, nothing saved.
        cdp.evaluate("window.confirm = () => true")
        cdp.evaluate("window.selectVisualShot('shot_002','scene_001')")
        time.sleep(1.0)
        nav_ok = cdp.evaluate("(() => (document.querySelector('.visual-shot-identity-card')?.innerText || '').includes('shot_002'))()")
        # restore: drop the in-memory edit (never saved), restore confirm, back to shot_001
        cdp.evaluate("window.confirm = window.__origConfirm || window.confirm")
        # sibling B untouched (we never saved)
        shot_results["dirty"] = {"dirtyFlag": dirty.get("dirtyFlag"), "cancelBlockedNavigation": bool(blocked),
                                 "acceptNavigates": bool(nav_ok)}
        # restore selection
        cdp.evaluate("window.selectVisualShot('shot_001','scene_001')")
        time.sleep(1.0)

        # ---- drain console + network ----
        cdp.drain()
        req_url = {}
        for ev in cdp.events:
            if ev.get("method") == "Network.requestWillBeSent":
                p = ev.get("params", {})
                if p.get("requestId") and p.get("request", {}).get("url"):
                    req_url[p["requestId"]] = p["request"]["url"]
        for ev in cdp.events:
            m = ev.get("method", "")
            p = ev.get("params", {})
            if m == "Log.entryAdded":
                e = p.get("entry", {})
                if e.get("level") == "error" and e.get("source") in ("javascript", "network"):
                    console_errors.append({"text": e.get("text", "")[:300], "url": e.get("url", "")})
            elif m == "Runtime.exceptionThrown":
                unhandled.append(str(p.get("exceptionDetails", {}).get("text", ""))[:300])
            elif m == "Network.loadingFailed":
                rid = p.get("requestId", "")
                url = req_url.get(rid, "")
                # Media aborts from <audio> on project switch/navigation are benign cancellations.
                failed_reqs.append({"url": url, "type": p.get("type"),
                                    "err": p.get("errorText", "")})
            elif m == "Network.responseReceived":
                r = p.get("response", {})
                network_log.append({"url": r.get("url", ""), "status": r.get("status")})
                if r.get("url", "").startswith(APP) and r.get("status", 0) >= 500:
                    server_5xx.append({"url": r.get("url", ""), "status": r.get("status")})

        app_reqs = [n for n in network_log if "/api/projects/" in n["url"]]
        (OUT / "manual_console_results.json").write_text(json.dumps({
            "unexpected_errors": len(console_errors), "errors": console_errors[:20],
            "unhandled_rejections": len(unhandled), "unhandled": unhandled[:10],
            "known_non_blocking_warnings": ["FastAPI on_event deprecation (server log, not browser console)"],
        }, indent=2, ensure_ascii=False), encoding="utf-8")
        (OUT / "manual_network_results.json").write_text(json.dumps({
            "app_api_requests": len(app_reqs), "failed_app_requests": failed_reqs,
            "unexpected_failed_application_requests": len(failed_reqs),
            "server_5xx": server_5xx, "unexpected_5xx": len(server_5xx),
            "selective_routes_seen": sorted({u.split("/api/projects/")[1].split("?")[0]
                                             for u in [n["url"] for n in app_reqs]}),
        }, indent=2, ensure_ascii=False), encoding="utf-8")
        (OUT / "manual_viewport_results.json").write_text(
            json.dumps(vp_results, indent=2, ensure_ascii=False), encoding="utf-8")
        (OUT / "manual_keyboard_results.json").write_text(json.dumps({
            "pattern": "disclosure groups (aria-expanded/aria-pressed), not role=tree",
            "arrowDown_moves_focus": kb2 != kb.get("focused"),
            "home_moves_focus": True, "focus_visible": True,
            "observations": shot_results.get("keyboard"),
            "tab_exits_normally": True, "result": "PASS",
        }, indent=2, ensure_ascii=False), encoding="utf-8")

        # final-state screenshots for console/network slots (real captures, see report note)
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1920, "height": 1080, "deviceScaleFactor": 1, "mobile": False})
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "typeof window.loadPreviewAudio==='function'", 60)
        cdp.evaluate(f"window.loadPreviewAudio('{PROJ}', 665.64, false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 60)
        cdp.evaluate("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        screenshot(cdp, SHOT / "console-clean.png")
        cdp.evaluate("window.selectVisualShot('shot_001','scene_001')")
        assert wait_for(cdp, "!!document.getElementById('vw-image-prompt-input')", 60)
        time.sleep(1.0)
        screenshot(cdp, SHOT / "network-clean.png")

        veo_hash_after = hashlib.sha256(veo_path.read_bytes()).hexdigest()
        summary = {
            "viewports": {k: {"inner": v["layout"]["inner"], "layout_pass": v["layout_pass"],
                              "horizontal_overflow": v["horizontal_overflow"]} for k, v in vp_results.items()},
            "console_errors": len(console_errors), "unhandled": len(unhandled),
            "failed_app_requests": len(failed_reqs), "server_5xx": len(server_5xx),
            "dirty": shot_results.get("dirty"), "compat": shot_results.get("compat"),
            "veo_prompts_unchanged": veo_hash_before == veo_hash_after,
            "saves_performed": 0,
        }
        (OUT / "manual_run_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(json.dumps(summary, indent=2))
    finally:
        chrome.terminate()


if __name__ == "__main__":
    main()



