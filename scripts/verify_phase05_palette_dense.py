"""Palette dense off-window reveal recheck with diagnostics (ranking,
timing, index rebuild). Headed, temp dense fixture, cleaned up.
Writes temp/phase05_performance_gate_closure/performance/palette_dense_recheck.json
Usage: python scripts/verify_phase05_palette_dense.py
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
DENSE = "_p5s_dense300"
PERF = Path("temp/phase05_performance_gate_closure/performance")
PROFILE = Path("temp/headed_profile_p5d")
CDP_PORT = 9354


def main():
    import shutil
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
    PROFILE.mkdir(parents=True, exist_ok=True)
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
        E(f"window.loadPreviewAudio('{DENSE}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(2.0)  # allow palette index rebuild after project switch

        def ctrl_k():
            for t in ("rawKeyDown", "keyUp"):
                cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "k", "code": "KeyK",
                                                    "windowsVirtualKeyCode": 75,
                                                    "nativeVirtualKeyCode": 75, "modifiers": 2}, timeout=12)
            time.sleep(0.8)

        def key(name, code, vk):
            for t in ("rawKeyDown", "keyUp"):
                cdp.call("Input.dispatchKeyEvent", {"type": t, "key": name, "code": code,
                                                    "windowsVirtualKeyCode": vk,
                                                    "nativeVirtualKeyCode": vk}, timeout=12)
            time.sleep(0.4)

        items_of = ("(() => Array.from(document.querySelectorAll('.uq-cmd-item'))"
                    ".map(b=>b.querySelector('.uq-cmd-sub').innerText.split(' ')[0]))()")
        out = {}
        for trial in (1, 2):
            ctrl_k()
            E("(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'shot_d250';"
              " i.dispatchEvent(new Event('input', {bubbles:true})); })()")
            time.sleep(1.0)  # longer settle than main harness (0.6s)
            items = E(items_of)
            active = E("(() => document.querySelector('.uq-cmd-item.is-active')?.id || '')()")
            key("Enter", "Enter", 13)
            time.sleep(1.5)
            card = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,100) || '')()")
            out[f"trial{trial}"] = {"items": items, "active": active, "card": card,
                                    "pass": any("shot_d250" in x for x in (items or []))
                                    and "shot_d250" in card}
            print(f"trial{trial}:", json.dumps(out[f"trial{trial}"], ensure_ascii=False)[:300], flush=True)
            if out[f"trial{trial}"]["pass"]:
                break
        out["deterministic"] = out.get("trial1", {}).get("items") == out.get("trial2", {}).get("items") \
            if "trial2" in out else True
        (PERF / "palette_dense_recheck.json").write_text(
            json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
        cdp.drain()
        errs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        print("console errors:", len(errs), flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()
    shutil.rmtree(dst, ignore_errors=True)
    print("leftover:", [p.name for p in Path("projects").glob("_p5s*")], flush=True)


if __name__ == "__main__":
    main()
