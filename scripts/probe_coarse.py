"""Probe: which coarse rules are live + computed min-values on violators."""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for

PORT = 9383


def main():
    Path("temp/probe_coarse_profile").mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen(
        [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
         f"--remote-debugging-port={PORT}",
         "--user-data-dir=" + str(Path("temp/probe_coarse_profile").resolve()),
         "--no-first-run", "--no-default-browser-check",
         "--window-size=1440,900", "about:blank"], stderr=subprocess.DEVNULL)
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
        cdp.call("Page.navigate", {"url": "http://127.0.0.1:7860"})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        time.sleep(2.0)
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})
        cdp.call("Emulation.setTouchEmulationEnabled", {"enabled": True})
        time.sleep(1.5)
        print("coarse:", E("matchMedia('(pointer: coarse)').matches"), flush=True)
        print("coarseRules:", E("(() => { const hits = [];"
                               " for (const sh of document.styleSheets) {"
                               "  let rules; try { rules = sh.cssRules; } catch (e) { continue; }"
                               "  const walk = rs => { for (const r of rs) {"
                               "   if (r.conditionText && r.conditionText.includes('pointer: coarse'))"
                               "    hits.push(r.conditionText + ' :: ' + [...r.cssRules].length + ' rules :: ' + [...r.cssRules].map(x=>x.selectorText).join(','));"
                               "   if (r.cssRules) walk(r.cssRules); } };"
                               "  walk(rules); } return JSON.stringify(hits); })()"), flush=True)
        print("helpGuide:", E("(() => { const b = document.querySelector('.btn-help-guide');"
                              " if (!b) return 'missing'; const cs = getComputedStyle(b);"
                              " const r = b.getBoundingClientRect();"
                              " return JSON.stringify({minW: cs.minWidth, minH: cs.minHeight,"
                              " display: cs.display, w: Math.round(r.width), h: Math.round(r.height)}); })()"), flush=True)
    finally:
        chrome.terminate()


if __name__ == "__main__":
    main()
