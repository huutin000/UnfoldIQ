"""Probe: is CDP input (mouse/key/wheel) dispatched at all right now?"""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for

PORT = 9378


def main():
    Path("temp/probe_inp_profile").mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen(
        [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
         f"--remote-debugging-port={PORT}",
         "--user-data-dir=" + str(Path("temp/probe_inp_profile").resolve()),
         "--no-first-run", "--no-default-browser-check",
         "--window-size=800,600", "about:blank"], stderr=subprocess.DEVNULL)
    try:
        for _ in range(30):
            time.sleep(1)
            try:
                v = json.loads(urllib.request.urlopen(
                    f"http://127.0.0.1:{PORT}/json/version", timeout=5).read())
                break
            except Exception:
                continue
        print("browser:", v.get("Browser"), flush=True)
        tg = json.loads(urllib.request.urlopen(
            f"http://127.0.0.1:{PORT}/json/list", timeout=10).read())
        pt = next(t for t in tg if t.get("type") == "page")
        cdp = CDP(pt["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        E = cdp.evaluate
        E("document.body.innerHTML = '<button id=t style=\"margin:100px\">hi</button>';")
        E("window.__ev=[]; ['mousedown','mouseup','click','keydown','wheel']"
          ".forEach(t=>document.addEventListener(t,e=>window.__ev.push(t+':'+(e.key||'')),true));")
        E("document.getElementById('t').addEventListener('click',()=>window.__ev.push('btn-click'));")
        print("mousePress:", cdp.call("Input.dispatchMouseEvent",
              {"type": "mousePressed", "x": 120, "y": 115,
               "button": "left", "clickCount": 1}, timeout=15), flush=True)
        print("mouseRel:", cdp.call("Input.dispatchMouseEvent",
              {"type": "mouseReleased", "x": 120, "y": 115,
               "button": "left", "clickCount": 1}, timeout=15), flush=True)
        time.sleep(0.5)
        print("ev1:", E("window.__ev.join('|')"), flush=True)
        print("wheel:", cdp.call("Input.dispatchMouseEvent",
              {"type": "mouseWheel", "x": 120, "y": 115,
               "deltaX": 0, "deltaY": -300, "pointerType": "mouse"}, timeout=15), flush=True)
        time.sleep(0.5)
        print("ev2:", E("window.__ev.join('|')"), flush=True)
        print("key:", cdp.call("Input.dispatchKeyEvent",
              {"type": "rawKeyDown", "key": "a", "code": "KeyA",
               "windowsVirtualKeyCode": 65, "nativeVirtualKeyCode": 65,
               "modifiers": 0}, timeout=15), flush=True)
        time.sleep(0.5)
        print("ev3:", E("window.__ev.join('|')"), flush=True)
    finally:
        chrome.terminate()


if __name__ == "__main__":
    main()
