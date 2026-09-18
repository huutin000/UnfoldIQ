"""Phase 6 target-size audit (headed Chrome, CDP).

Normal pointer (1440x900): every visible+enabled author-controlled control
must be >=24x24 CSS px (project minimum == WCAG 2.2 SC 2.5.8 AA minimum).
Coarse pointer (mobile emulation, matchMedia verified true): product UX
target >=44x44 CSS px (NOT the WCAG minimum — reported separately).
Inline text links are classified kind=link (WCAG exception candidates).
Usage: python scripts/verify_phase06_target_sizes.py
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
REF = "2026-09-12_210003_youtube-narration-01"
OUT = Path("temp/phase06_verification")
PROFILE = None  # fresh timestamped profile per run (no stale-CSS doubt)
CDP_PORT = 9381

COLLECT_JS = """(() => {
  const SEL = 'button, a[href], input, select, textarea, [role=button], [role=option], [tabindex]:not([tabindex="-1"])';
  const out = [];
  const seen = new Set();
  document.querySelectorAll(SEL).forEach(el => {
    if (el.disabled) return;
    if (el.getAttribute('aria-disabled') === 'true') return;
    let r;
    try {
      if (!(el instanceof HTMLElement)) return;
      if (el.getClientRects().length === 0) return;
      if (getComputedStyle(el).visibility === 'hidden') return;
      r = el.getBoundingClientRect();
    } catch (e) { return; }
    const tag = el.tagName.toLowerCase();
    const cls = (el.className.baseVal !== undefined ? el.className.baseVal : el.className).toString().split(' ').slice(0,2).join('.');
    let name = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').trim().replace(/\\s+/g, ' ').slice(0,44);
    // Range inputs: the operable target is the THUMB, not the track box.
    let kind = (tag === 'a' && !el.className.toString().match(/btn|nav|tab|cmd/)) ? 'link' : 'control';
    let w = Math.round(r.width * 10) / 10, h = Math.round(r.height * 10) / 10;
    let thumb = null;
    if (tag === 'input' && (el.type === 'range')) {
      kind = 'slider';
      // NOTE: getComputedStyle(el,'::-webkit-slider-thumb') returns the
      // element box in this Chrome (verified by probe) — thumb geometry is
      // NOT AVAILABLE that way; evidence comes from the live-stylesheet
      // rule scan (sliderRules below).
      thumb = 'NOT AVAILABLE via computed-style';
    }
    const key = tag + '|' + cls + '|' + name + '|' + w + 'x' + h;
    if (seen.has(key)) { return; }
    seen.add(key);
    out.push({tag: tag, cls: cls, name: name, kind: kind,
              w: w, h: h, thumb: thumb});
  });
  return out;
})()"""


def audit(E):
    return E(COLLECT_JS)


def main():
    import datetime
    global PROFILE
    PROFILE = Path(f"temp/browser_profile_p6t_{datetime.datetime.now().strftime('%H%M%S')}")
    (OUT / "a11y").mkdir(parents=True, exist_ok=True)
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
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E = cdp.evaluate
        E("(() => { try { localStorage.setItem('unfoldiq.onboarding.v2', JSON.stringify({"
          " schemaVersion: 2, meta: {welcome: 'dismissed', migratedFromLegacy: true},"
          " tours: {'product-overview': {status: 'dismissed'}, 'content-basics': {status: 'dismissed'},"
          " 'scene-visual-basics': {status: 'dismissed'}, 'studio-basics': {status: 'dismissed'},"
          " 'review-basics': {status: 'dismissed'}, 'export-basics': {status: 'dismissed'},"
          " 'visual-bible-basics': {status: 'dismissed'}} })); } catch (e) {} return 1; })()")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        E(f"window.loadPreviewAudio('{REF}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.5)
        # Settle: CDP input is dropped while the freshly-loaded app is still
        # fetching/rendering (startup race). Warm the renderer first.
        for _ws in ("overview", "scenes"):
            E(f"window.switchWorkspace('{_ws}')")
            time.sleep(8)
        # input-ready gate with warmup retries
        E("window.__al=[]; document.addEventListener('keydown', e=>window.__al.push(e.key), true);")
        for _ in range(12):
            cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "F1", "code": "F1",
                                                "windowsVirtualKeyCode": 112,
                                                "nativeVirtualKeyCode": 112, "modifiers": 0}, timeout=15)
            cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "F1", "code": "F1",
                                                "windowsVirtualKeyCode": 112,
                                                "nativeVirtualKeyCode": 112, "modifiers": 0}, timeout=15)
            time.sleep(8)
            if E("window.__al.join()") == "F1":
                break
        assert E("window.__al.join()") == "F1", "input dead"
        print("input alive", flush=True)

        # normal pass across workbenches (accumulate unique)
        all_items = []
        for ws in ("overview", "story", "voice", "scenes", "export"):
            E(f"window.switchWorkspace('{ws}')")
            time.sleep(1.5)
            items = audit(E) or []
            all_items.extend(items)
        seen = set()
        uniq = []
        for it in all_items:
            k = it["tag"] + "|" + it["cls"] + "|" + it["name"]
            if k not in seen:
                seen.add(k)
                uniq.append(it)
        viol24 = [i for i in uniq if i["kind"] == "control" and (i["w"] < 24 or i["h"] < 24)]
        sliders24 = [i for i in uniq if i["kind"] == "slider"]
        links = [i for i in uniq if i["kind"] == "link"]
        # Live-stylesheet rule scan: proves the 24px thumb rules are live
        # (computed-style thumb geometry is NOT AVAILABLE in this Chrome).
        rules = E("(() => { const hits = [];"
                  " for (const sh of document.styleSheets) {"
                  "  let rules; try { rules = sh.cssRules; } catch (e) { continue; }"
                  "  const walk = rs => { for (const r of rs) {"
                  "   if (r.selectorText && r.selectorText.includes('slider-thumb'))"
                  "    hits.push(r.selectorText + ' :: ' + r.style.cssText.slice(0,140));"
                  "   if (r.cssRules) walk(r.cssRules); } };"
                  "  walk(rules); } return hits; })()")
        normal = {"viewport": [1440, 900], "pointer": E("matchMedia('(pointer: coarse)').matches"),
                  "n": len(uniq), "violations24": viol24, "sliders": sliders24,
                  "sliderRules": rules, "links": links, "items": uniq}
        (OUT / "a11y" / "target_sizes_normal.json").write_text(
            json.dumps(normal, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"normal: n={len(uniq)} viol24={len(viol24)} links={len(links)}", flush=True)
        for v in viol24[:20]:
            print("  VIOL24:", v, flush=True)

        # coarse pass (mobile + touch emulation -> pointer:coarse must be true;
        # mobile:true alone leaves the query false — verified pitfall)
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})
        try:
            cdp.call("Emulation.setTouchEmulationEnabled", {"enabled": True})
        except Exception as ex:
            print("touch emulation unavailable:", str(ex)[:120], flush=True)
        time.sleep(1.5)
        coarse_q = E("matchMedia('(pointer: coarse)').matches")
        print("coarse media:", coarse_q, flush=True)
        E("window.switchWorkspace('scenes')")
        time.sleep(1.5)
        citems = audit(E) or []
        # Policy scope: kind=control only. Sliders are judged on thumb size;
        # word-cues fall under the WCAG 2.5.8 Inline exception (reported, not failed).
        viol44 = [i for i in citems if i["kind"] == "control" and (i["w"] < 44 or i["h"] < 44)]
        sliders = [i for i in citems if i["kind"] == "slider"]
        words = [i for i in citems if i["cls"] == "word-cue"]
        ov = E("(() => { const d = document.documentElement;"
               " return {sw: d.scrollWidth, cw: d.clientWidth,"
               " hscroll: d.scrollWidth > d.clientWidth + 1}; })()")
        data = cdp.call("Page.captureScreenshot", {"format": "png"})["data"]
        import base64 as _b64
        (OUT / "a11y" / "coarse-390x844.png").write_bytes(_b64.b64decode(data))
        coarse = {"viewport": [390, 844], "pointerCoarse": coarse_q,
                  "n": len(citems), "violations44": viol44,
                  "sliders": sliders, "wordCues": len(words),
                  "overflow": ov, "items": citems}
        (OUT / "a11y" / "target_sizes_coarse.json").write_text(
            json.dumps(coarse, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"coarse: n={len(citems)} viol44={len(viol44)}", flush=True)
        for v in viol44[:25]:
            print("  VIOL44:", v, flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
