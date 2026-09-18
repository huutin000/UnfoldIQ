"""Phase 5 virtualization behavior scenarios (CDP, real browser).

Covers §31: selected-outside-window, scroll back, filter/clear,
ArrowDown/Up across boundary, Home/End, project switch, scene/shot switch,
no sibling mutation, no full detail preload. Temp fixture only.
"""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for  # noqa: E402

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP = "http://127.0.0.1:7860"
PROJ = "_p5_big1500"
OUT = Path("temp/phase05_verification/virtualization")
PROFILE = Path("temp/browser_profile_p5v")
CDP_PORT = 9339

results = {}


def check(name, cond, extra=""):
    results[name] = {"pass": bool(cond), "extra": extra}
    print(("PASS " if cond else "FAIL ") + name, extra)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)
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
                               "--headless=new", "--no-first-run",
                               "--no-default-browser-check", "--disable-gpu",
                               "--hide-scrollbars", "about:blank"])
    targets = None
    for _ in range(30):
        time.sleep(1)
        try:
            targets = json.loads(urllib.request.urlopen(
                f"http://127.0.0.1:{CDP_PORT}/json", timeout=5).read())
            break
        except Exception:
            continue
    assert targets
    try:
        pt = next(t for t in targets if t.get("type") == "page")
        cdp = CDP(pt["webSocketDebuggerUrl"])
        cdp.call("Page.enable"); cdp.call("Runtime.enable")
        cdp.call("Log.enable")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "typeof window.loadPreviewAudio==='function'", 60)
        cdp.evaluate(f"window.loadPreviewAudio('{PROJ}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        cdp.evaluate("window.switchWorkspace('scenes')")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.0)
        E = cdp.evaluate

        groups = E("document.querySelectorAll('#sp-rows-container .visual-scene-group').length")
        check("virtualized (windowed groups)", 0 < groups < 100, f"mounted={groups}")

        # 1. select near end by stable ID (success = card shows target, not spinner)
        E("window.selectVisualShot('shot_1600','scene_566')")
        assert wait_for(cdp, "!!document.getElementById('vw-image-prompt-input')", 60)
        assert wait_for(cdp, "(document.querySelector('.visual-shot-identity-card')?.innerText||'').includes('shot_1600')", 60)
        time.sleep(0.5)
        sel = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,80) || '')()")
        check("select far shot by stable ID", "shot_1600" in sel, sel[:60])
        nav_sel = E("(() => { const b = document.querySelector('[data-action=select-shot][data-shot-id=shot_1600]'); return b ? b.getAttribute('aria-pressed') : 'missing'; })()")
        check("navigator shows selection", nav_sel == "true", nav_sel)
        if nav_sel != "true":
            print("DIAG debug:", E("window.__visualNavDebug ? window.__visualNavDebug() : 'no-hook'"))
            print("DIAG range:", E("(() => Array.from(document.querySelectorAll('#sp-rows-container .visual-scene-group')).map(g=>g.dataset.sceneId).slice(0,2).join(',') + '..' + Array.from(document.querySelectorAll('#sp-rows-container .visual-scene-group')).map(g=>g.dataset.sceneId).slice(-2).join(','))()"))
            print("DIAG scene566 shots:", E("(() => { const g = document.querySelector('.visual-scene-group[data-scene-id=scene_566]'); return g ? g.querySelectorAll('[data-action=select-shot]').length : 'no-group'; })()"))

        # 2. scroll away to top, selection state preserved in state (not DOM-dependent)
        cdp.evaluate("document.getElementById('sp-rows-container').scrollTop = 0")
        time.sleep(1.0)
        still = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.includes('shot_1600'))()")
        check("selection survives scroll-away", bool(still))
        # scroll back via ensure (reselect same shot after dirty-safe no-op)
        E("window.selectVisualShot('shot_1600','scene_566')")
        time.sleep(1.0)
        back = E("(() => document.querySelector('[data-action=select-shot][data-shot-id=shot_1600]')?.getAttribute('aria-pressed'))()")
        check("remount shows selected", back == "true", str(back))

        # 3. ArrowDown across window boundary (focus last mounted, ArrowDown)
        E("""(() => { const bs = document.querySelectorAll('#sp-rows-container button');
          if (bs.length) bs[bs.length-1].focus(); })()""")
        before = E("(() => document.activeElement?.dataset?.shotId || document.activeElement?.dataset?.sceneId || '?')()")
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "ArrowDown",
                                            "code": "ArrowDown", "windowsVirtualKeyCode": 40})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "ArrowDown",
                                            "code": "ArrowDown", "windowsVirtualKeyCode": 40})
        time.sleep(0.8)
        after = E("(() => document.activeElement?.tagName + ':' + (document.activeElement?.dataset?.shotId || document.activeElement?.dataset?.sceneId || '?'))()")
        check("ArrowDown crosses boundary with valid focus", after.startswith("BUTTON:") and after != "BUTTON:?", f"{before} -> {after}")

        # 4. Home / End
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Home", "code": "Home", "windowsVirtualKeyCode": 36})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Home", "code": "Home", "windowsVirtualKeyCode": 36})
        time.sleep(0.8)
        home = E("(() => document.activeElement?.dataset?.sceneId || '?')()")
        check("Home reaches first scene", home == "scene_001", home)
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "End", "code": "End", "windowsVirtualKeyCode": 35})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "End", "code": "End", "windowsVirtualKeyCode": 35})
        time.sleep(0.8)
        end = E("(() => document.activeElement?.tagName + ':' + (document.activeElement?.dataset?.sceneId || '?'))()")
        check("End reaches last group", end.startswith("BUTTON:scene_"), end)
        if not end.startswith("BUTTON:scene_"):
            print("DIAG end buttons:", E("document.querySelectorAll('#sp-rows-container button').length"))
            print("DIAG end debug:", E("window.__visualNavDebug ? window.__visualNavDebug() : 'no-hook'"))

        # 5. filter then clear
        E("""(() => { const i = document.getElementById('sp-search-input'); if (i) { i.value = 'scene_010'; i.dispatchEvent(new Event('input', {bubbles:true})); } })()""")
        time.sleep(1.2)
        fcount = E("document.querySelectorAll('#sp-rows-container .visual-scene-group').length")
        E("""(() => { const i = document.getElementById('sp-search-input'); if (i) { i.value = ''; i.dispatchEvent(new Event('input', {bubbles:true})); } })()""")
        time.sleep(1.2)
        ccount = E("document.querySelectorAll('#sp-rows-container .visual-scene-group').length")
        check("filter narrows then clear restores", fcount < ccount < 100, f"{fcount}->{ccount}")
        if not (fcount < ccount < 100):
            try:
                raw = cdp.call("Runtime.evaluate", {"expression": "window.__visualNavDebug()",
                                                    "returnByValue": True})
                print("DIAG debug:", str(raw.get("result", {}).get("value")))
            except Exception as ex:
                print("DIAG raw EXC:", ex)
            print("DIAG badge:", E("document.getElementById('sp-row-count-badge')?.innerText"))
            print("DIAG clientH:", E("document.getElementById('sp-rows-container').clientHeight"))
            print("DIAG scrollH:", E("document.getElementById('sp-rows-container').scrollHeight"))
            print("DIAG scrollTop:", E("document.getElementById('sp-rows-container').scrollTop"))

        # 6. no sibling mutation: shot_001 prompt intact after far selection
        veo = json.loads(Path(f"projects/{PROJ}/veo_prompts.json").read_text(encoding="utf-8"))
        s1 = next(s for s in veo["shots"] if s["shot_id"] == "shot_001")
        check("no sibling mutation", s1.get("image_prompt") is None)

        # 7. no full detail preload: only selected shot detail fetched (count shot URLs)
        cdp.drain()
        shot_urls = set()
        for ev in cdp.events:
            if ev.get("method") == "Network.requestWillBeSent":
                u = ev.get("params", {}).get("request", {}).get("url", "")
                if "/visual/shots/" in u:
                    shot_urls.add(u.split("/visual/shots/")[1].split("?")[0])
        check("no detail preload storm", len(shot_urls) <= 4, f"detail URLs: {sorted(shot_urls)}")

        # 8. console errors
        errs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                and e.get("params", {}).get("entry", {}).get("level") == "error"]
        check("no console errors", len(errs) == 0, f"{len(errs)} errors")

        # 9. scroll FPS: virtualized vs forced-direct on the same fixture
        fps = {}
        for mode, thr in (("virtual", 200), ("direct", 1000000)):
            E(f"window.UQVirtualList.THRESHOLD_GROUPS = {thr}")
            cdp.evaluate("window.renderVisualSceneNavigator()")
            time.sleep(0.5)
            r = cdp.evaluate("""(() => new Promise(res => {
              const el = document.getElementById('sp-rows-container');
              let frames = 0;
              const t0 = performance.now();
              el.scrollTop = 0;
              function tick() {
                frames++;
                const max = el.scrollHeight - el.clientHeight;
                el.scrollTop = Math.min(max, el.scrollTop + Math.max(80, max / 30));
                if (performance.now() - t0 < 2500 && el.scrollTop < max) requestAnimationFrame(tick);
                else { const ms = performance.now() - t0; res({fps: Math.round(frames / (ms / 1000)), frames, ms: Math.round(ms)}); }
              }
              requestAnimationFrame(tick);
            }))()""", await_promise=True, timeout=60)
            fps[mode] = r
            (OUT / f"fps_{mode}.json").write_text(json.dumps(r, indent=1), encoding="utf-8")
        E("window.UQVirtualList.THRESHOLD_GROUPS = 200")
        check("scroll fps measured both modes", all("fps" in v for v in fps.values()), json.dumps(fps))

        (OUT / "scenario_results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
        print("OVERALL:", all(v["pass"] for v in results.values()))
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
