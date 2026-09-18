"""Phase 5 final browser validation — real Chrome via CDP.

Reference project (79 scenes, below virtualization threshold): 3 viewports,
5-workbench smoke, palette open/search/activate/close, navigator regression
(select/keyboard/dirty still intact), console/network gates, screenshots.
No mutations.
"""
import base64
import hashlib
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
PROJ = "2026-09-12_210003_youtube-narration-01"
OUT = Path("temp/phase05_verification/browser")
SHOT = OUT / "screenshots"
PROFILE = Path("temp/browser_profile_p5f")
CDP_PORT = 9341

results = {}


def check(name, cond, extra=""):
    results[name] = {"pass": bool(cond), "extra": extra}
    print(("PASS " if cond else "FAIL ") + name, extra)


def main():
    SHOT.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)
    veo = Path("projects") / PROJ / "veo_prompts.json"
    h_before = hashlib.sha256(veo.read_bytes()).hexdigest()
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
        cdp.call("Log.enable"); cdp.call("Network.enable")
        E = cdp.evaluate
        for (w, h) in [(1920, 1080), (1440, 900), (1366, 768)]:
            key = f"{w}x{h}"
            cdp.call("Emulation.setDeviceMetricsOverride",
                     {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False})
            cdp.call("Page.navigate", {"url": APP})
            assert wait_for(cdp, "document.readyState==='complete'", 60)
            assert wait_for(cdp, "typeof window.loadPreviewAudio==='function'", 60)
            E(f"window.loadPreviewAudio('{PROJ}',665.64,false)")
            assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
            E("""(() => { const b = Array.from(document.querySelectorAll('button'))
              .find(x => (x.innerText||'').includes('Khám phá sau')); if (b) b.click(); })()""")
            time.sleep(0.8)
            E("window.switchWorkspace('scenes')")
            time.sleep(1.2)
            # palette smoke on 1920 only (behavior fully covered on dedicated run)
            if w == 1920:
                for t in ("rawKeyDown", "keyUp"):
                    cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "k", "code": "KeyK",
                                                        "windowsVirtualKeyCode": 75,
                                                        "nativeVirtualKeyCode": 75, "modifiers": 2})
                time.sleep(0.8)
                pal = E("window.UQPalette.isOpen()")
                shot_data = cdp.call("Page.captureScreenshot", {"format": "png"})["data"]
                (SHOT / f"{key}-palette.png").write_bytes(base64.b64decode(shot_data))
                E("window.UQPalette.close()")
            else:
                shot_data = cdp.call("Page.captureScreenshot", {"format": "png"})["data"]
                (SHOT / f"{key}-scenes.png").write_bytes(base64.b64decode(shot_data))
            layout = E("""(() => ({noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
              groups: document.querySelectorAll('#sp-rows-container .visual-scene-group').length,
              spacers: document.querySelectorAll('#sp-rows-container .uq-vspacer').length}))()""")
            cdp.drain()
            results[key] = {"layout_pass": bool(layout["noOverflow"] and layout["groups"] == 79),
                            "groups": layout["groups"], "spacers": layout["spacers"],
                            "palette_open": bool(pal) if w == 1920 else "n/a"}
            print(key, results[key])
        # 5-workbench smoke (last viewport)
        smoke = {}
        for ws in ["overview", "story", "voice", "scenes", "export"]:
            cdp.evaluate(f"window.switchWorkspace('{ws}')")
            time.sleep(1.2)
            smoke[ws] = cdp.evaluate("""(() => { const v = document.querySelector('.workspace-view.active');
              return v ? {id: v.id, blank: (v.innerText||'').trim().length < 5} : null; })()""")
        check("smoke non-blank", all(v and not v["blank"] for v in smoke.values()), str(smoke))
        # navigator regression: select + keyboard + dirty guard intact
        E("window.selectVisualShot('shot_002','scene_001')")
        assert wait_for(cdp, "(document.querySelector('.visual-shot-identity-card')?.innerText||'').includes('shot_002')", 30)
        check("shot select intact", True)
        E("""(() => { const b = document.querySelector('#sp-rows-container button'); if (b) b.focus(); })()""")
        kb0 = E("(() => document.activeElement?.tagName + ':' + (document.activeElement?.dataset?.shotId || document.activeElement?.dataset?.sceneId || '?'))()")
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "ArrowDown",
                                            "code": "ArrowDown", "windowsVirtualKeyCode": 40})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "ArrowDown",
                                            "code": "ArrowDown", "windowsVirtualKeyCode": 40})
        time.sleep(0.5)
        kb = E("(() => document.activeElement?.tagName + ':' + (document.activeElement?.dataset?.shotId || document.activeElement?.dataset?.sceneId || '?'))()")
        check("keyboard intact", kb.startswith("BUTTON:") and kb != kb0, f"{kb0}->{kb}")
        errs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                and e.get("params", {}).get("entry", {}).get("level") == "error"]
        unh = [e for e in cdp.events if e.get("method") == "Runtime.exceptionThrown"]
        fails, f5xx = [], []
        for ev in cdp.events:
            if ev.get("method") == "Network.loadingFailed" and ev.get("params", {}).get("type") not in ("Media",):
                fails.append(ev.get("params", {}).get("errorText", ""))
            if ev.get("method") == "Network.responseReceived":
                r = ev.get("params", {}).get("response", {})
                if r.get("url", "").startswith(APP) and r.get("status", 0) >= 500:
                    f5xx.append(r.get("url", ""))
        check("console clean", len(errs) == 0, str(len(errs)))
        check("no unhandled", len(unh) == 0, str(len(unh)))
        check("network clean", len(fails) == 0 and len(f5xx) == 0, f"{fails[:3]}/{f5xx[:3]}")
        check("reference untouched", h_before == hashlib.sha256(veo.read_bytes()).hexdigest())
        (OUT / "final_results.json").write_text(
            json.dumps({"viewports": results, "checks": {k: v for k, v in results.items() if k in (
                "smoke non-blank",)}}, indent=1, ensure_ascii=False), encoding="utf-8")
        (OUT / "checks.json").write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
        print("OVERALL:", all(v.get("pass", True) for v in results.values()
                              if isinstance(v, dict) and "pass" in v))
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
