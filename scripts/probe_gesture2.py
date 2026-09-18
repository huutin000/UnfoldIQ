"""Probe 2: where does the touch gesture go + mouse-source gesture effect.
Usage: python scripts/probe_gesture2.py
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
PROFILE = Path("temp/probe_gesture_profile")
CDP_PORT = 9365


def main():
    import shutil
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
    dst = Path("projects") / "_p5s_probe"
    shutil.rmtree(dst, ignore_errors=True)
    r = subprocess.run([sys.executable, "scripts/make_large_fixture.py", "_p5s_probe", "500"],
                       capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, r.stderr[-2000:]
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
        cdpIn = CDP(pt["webSocketDebuggerUrl"])
        cdp.call("Page.enable"); cdp.call("Runtime.enable")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E = cdp.evaluate
        E("window.loadPreviewAudio('_p5s_probe',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        E("""(() => { const b = Array.from(document.querySelectorAll('button'))
          .find(x => (x.innerText||'').includes('Khám phá sau')); if (b) b.click(); })()""")
        time.sleep(0.8)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        E("""(() => { const a = document.getElementById('audio-player');
          if (a) { try { a.pause(); } catch (e) {} a.removeAttribute('src'); a.load(); } })()""")
        time.sleep(1.0)
        box = E("(() => { const r = document.getElementById('sp-rows-container').getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()")
        print("touch-action:", E("getComputedStyle(document.getElementById('sp-rows-container')).touchAction"), flush=True)
        print("overflowY:", E("getComputedStyle(document.getElementById('sp-rows-container')).overflowY"), flush=True)
        # touch gesture then inspect both scrollers
        cdpIn.call("Input.synthesizeScrollGesture", {
            "x": box[0], "y": box[1], "yDistance": -3000, "speed": 2000,
            "gestureSourceType": "touch", "preventFling": True}, timeout=60)
        time.sleep(0.5)
        print("after touch: container=", E("document.getElementById('sp-rows-container').scrollTop"),
              "page=", E("document.scrollingElement.scrollTop"),
              "bodyH=", E("document.body.scrollHeight"), flush=True)
        # mouse-source gesture
        E("document.getElementById('sp-rows-container').scrollTop = 0")
        time.sleep(0.3)
        try:
            cdpIn.call("Input.synthesizeScrollGesture", {
                "x": box[0], "y": box[1], "yDistance": -3000,
                "gestureSourceType": "mouse", "preventFling": True}, timeout=60)
            print("mouse gesture ok", flush=True)
        except Exception as ex:
            print("MOUSE GESTURE ERROR:", str(ex)[:200], flush=True)
        time.sleep(0.5)
        print("after mouse: container=", E("document.getElementById('sp-rows-container').scrollTop"), flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()
    shutil.rmtree(dst, ignore_errors=True)


if __name__ == "__main__":
    main()
