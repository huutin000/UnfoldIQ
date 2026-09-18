"""Probe: CSSRule walk sanity + coarse rule presence on app page."""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manual_browser_closure import CDP, wait_for

PORT = 9384


def main():
    Path("temp/probe_css_profile").mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen(
        [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
         f"--remote-debugging-port={PORT}",
         "--user-data-dir=" + str(Path("temp/probe_css_profile").resolve()),
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
        E("var st=document.createElement('style');"
          "st.textContent='XMEDIA (pointer: coarse){ .foo{color:red} }'"
          ".replace('XMEDIA','@media');"
          "document.head.appendChild(st);")
        print("walk1:", E("(function(){ const hits = [];"
                          " for (const sh of document.styleSheets) {"
                          "  let rules; try { rules = sh.cssRules; } catch (e) { continue; }"
                          "  const walk = function(rs){ for (const r of rs) {"
                          "   if (r.conditionText && r.conditionText.indexOf('pointer') >= 0)"
                          "    hits.push(r.conditionText);"
                          "   if (r.cssRules) walk(r.cssRules); } };"
                          "  walk(rules); } return JSON.stringify(hits); })()"), flush=True)
        cdp.call("Page.navigate", {"url": "http://127.0.0.1:7860"})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        time.sleep(2.0)
        print("nSheets:", E("document.styleSheets.length"), flush=True)
        print("walkApp:", E("(function(){ const hits = [];"
                            " for (const sh of document.styleSheets) {"
                            "  let rules; try { rules = sh.cssRules; } catch (e) { hits.push('INACCESSIBLE:' + (sh.href||'inline')); continue; }"
                            "  const walk = function(rs){ for (const r of rs) {"
                            "   if (r.conditionText && r.conditionText.indexOf('coarse') >= 0)"
                            "    hits.push('COARSE in ' + (sh.href||'inline'));"
                            "   if (r.cssRules) walk(r.cssRules); } };"
                            "  walk(rules); } return JSON.stringify(hits); })()"), flush=True)
        print("helpGuide:", E("(function(){ const b = document.querySelector('.btn-help-guide');"
                              " return b ? 'found' : 'missing'; })()"), flush=True)
    finally:
        chrome.terminate()


if __name__ == "__main__":
    main()
