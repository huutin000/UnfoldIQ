"""Phase 6: dense off-window palette reveal (fresh profile, input warmup).
Rebuilds _p5d dense fixture, searches shot_d250 via palette, Enter, asserts
card. Cleans up. Usage: python scripts/verify_phase06_palette_dense.py
"""
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
DENSE = "_p5d_dense300"
PERF = Path("temp/phase06_verification/palette")
PROFILE = None
CDP_PORT = 9389


def main():
    import datetime
    import shutil
    global PROFILE
    PROFILE = Path(f"temp/headed_profile_p6pd_{datetime.datetime.now().strftime('%H%M%S')}")
    PERF.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)
    dst = Path("projects") / DENSE
    shutil.rmtree(dst, ignore_errors=True)
    r = subprocess.run([sys.executable, "scripts/make_dense_fixture.py", DENSE, "300"],
                       capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, r.stderr[-2000:]
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
        E(f"window.loadPreviewAudio('{DENSE}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(2.0)
        E("window.__al=[]; document.addEventListener('keydown', e=>window.__al.push(e.key), true);")
        for _ in range(12):
            for t in ("rawKeyDown", "keyUp"):
                cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "F1", "code": "F1",
                                                    "windowsVirtualKeyCode": 112,
                                                    "nativeVirtualKeyCode": 112, "modifiers": 0}, timeout=15)
            time.sleep(8)
            if E("window.__al.join()"):
                break
        assert E("window.__al.join()"), "input dead"
        print("input alive", flush=True)

        def ctrl_k():
            for t in ("rawKeyDown", "keyUp"):
                cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "k", "code": "KeyK",
                                                    "windowsVirtualKeyCode": 75,
                                                    "nativeVirtualKeyCode": 75, "modifiers": 2}, timeout=15)
            time.sleep(0.8)

        def key(name, code, vk):
            for t in ("rawKeyDown", "keyUp"):
                cdp.call("Input.dispatchKeyEvent", {"type": t, "key": name, "code": code,
                                                    "windowsVirtualKeyCode": vk,
                                                    "nativeVirtualKeyCode": vk}, timeout=15)
            time.sleep(0.4)

        out = {}
        for trial in (1, 2):
            ctrl_k()
            E("(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'shot_d250';"
              " i.dispatchEvent(new Event('input', {bubbles:true})); })()")
            time.sleep(1.0)
            items = E("(() => Array.from(document.querySelectorAll('.uq-cmd-item'))"
                      ".map(b=>b.querySelector('.uq-cmd-sub').innerText.split(' ')[0]))()")
            key("Enter", "Enter", 13)
            time.sleep(1.5)
            card = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,100) || '')()")
            out[f"trial{trial}"] = {"items": (items or [])[:3], "card": card[:60],
                                    "pass": any("shot_d250" in x for x in (items or [])) and "shot_d250" in card}
            print(f"trial{trial}:", json.dumps(out[f"trial{trial}"], ensure_ascii=False), flush=True)
            if out[f"trial{trial}"]["pass"]:
                break
        (PERF / "dense_reveal.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
        cdp.drain()
        errs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        print("console errors:", len(errs), flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()
    shutil.rmtree(dst, ignore_errors=True)
    print("leftover:", [p.name for p in Path("projects").glob("_p5d*")], flush=True)


if __name__ == "__main__":
    main()
