"""Probe: slider thumb computed style + live stylesheet rules."""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for

PORT = 9382


def main():
    Path("temp/probe_thumb_profile").mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen(
        [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
         f"--remote-debugging-port={PORT}",
         "--user-data-dir=" + str(Path("temp/probe_thumb_profile").resolve()),
         "--no-first-run", "--no-default-browser-check",
         "--window-size=800,600", "about:blank"], stderr=subprocess.DEVNULL)
    try:
        for _ in range(30):
            time.sleep(1)
            try:
                json.loads(urllib.request.urlopen(
                    f"http://127.0.0.1:{PORT}/json/version", timeout=5).read())
                break
            except Exception:
                continue
        tg = json.loads(urllib.request.urlopen(
            f"http://127.0.0.1:{PORT}/json/list", timeout=10).read())
        pt = next(t for t in tg if t.get("type") == "page")
        cdp = CDP(pt["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        E = cdp.evaluate
        E("document.body.innerHTML = '<input type=range id=r style=\"width:200px\">';")
        print("native thumb:", E("(() => { const el = document.getElementById('r');"
                                 " const cs = getComputedStyle(el, '::-webkit-slider-thumb');"
                                 " return cs.width + ' x ' + cs.height; })()"), flush=True)
        print("rulescan:", E("(() => { const hits = [];"
                             " for (const sh of document.styleSheets) {"
                             "  let rules; try { rules = sh.cssRules; } catch (e) { continue; }"
                             "  for (const r of rules) {"
                             "   if (r.selectorText && r.selectorText.includes('slider-thumb')) hits.push(r.selectorText + ' :: ' + r.style.cssText.slice(0,120));"
                             "   if (r.cssRules) for (const r2 of r.cssRules) {"
                             "    if (r2.selectorText && r2.selectorText.includes('slider-thumb')) hits.push(r2.selectorText + ' :: ' + r2.style.cssText.slice(0,120)); } } }"
                             " return JSON.stringify(hits); })()"), flush=True)
    finally:
        chrome.terminate()


if __name__ == "__main__":
    main()
