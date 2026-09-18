"""Follow-up probe: prove below-fold primary buttons are reachable via inner scroll
(not clipped), and capture scrolled evidence screenshots at 1366x768."""
import base64, json, subprocess, sys, time, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path("scripts").resolve()))
from manual_browser_closure import CDP, wait_for, CHROME, APP, PROJ

CDP_PORT = 9335
PROFILE = Path("temp/browser_profile_3c_probe")
SHOT = Path("temp/phase03c_final_verification/browser/screenshots")

chrome = subprocess.Popen([CHROME, f"--remote-debugging-port={CDP_PORT}",
                           f"--user-data-dir={PROFILE.resolve()}",
                           "--headless=new", "--no-first-run", "--disable-gpu",
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
    c = CDP(pt["webSocketDebuggerUrl"])
    c.call("Page.enable"); c.call("Runtime.enable")
    c.call("Emulation.setDeviceMetricsOverride",
           {"width": 1366, "height": 768, "deviceScaleFactor": 1, "mobile": False})
    c.call("Page.navigate", {"url": APP})
    assert wait_for(c, "typeof window.loadPreviewAudio==='function'", 60)
    c.evaluate("window.loadPreviewAudio('%s',665.64,false)" % PROJ)
    assert wait_for(c, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 60)
    c.evaluate("""(() => { const b = Array.from(document.querySelectorAll('button'))
      .find(x => (x.innerText||'').includes('Khám phá sau')); if (b) b.click(); })()""")
    time.sleep(0.8)
    c.evaluate("window.switchWorkspace('scenes')")
    time.sleep(1.0)
    c.evaluate("window.selectVisualShot('shot_001','scene_001')")
    assert wait_for(c, "!!document.getElementById('vw-image-prompt-input')", 60)
    time.sleep(1.0)
    res = c.evaluate("""(() => {
      const ids = ['btn-save-image-prompt','btn-save-motion-prompt','btn-copy-flow-package',
                   'btn-copy-image-prompt','btn-copy-motion-prompt','btn-lock-shot'];
      const out = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) { out[id] = {present:false}; continue; }
        el.scrollIntoView({block:'center'});
        const b = el.getBoundingClientRect();
        const cx = Math.min(Math.max(b.left + b.width/2, 0), window.innerWidth-1);
        const cy = Math.min(Math.max(b.top + b.height/2, 0), window.innerHeight-1);
        const top = document.elementFromPoint(cx, cy);
        out[id] = {present:true, rect:[Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)],
                   inViewport: b.top>=-1 && b.left>=-1 && b.bottom<=window.innerHeight+1 && b.right<=window.innerWidth+1,
                   clickable: !!(top && (top===el || el.contains(top))),
                   topmost: (top?.tagName||'?') + '.' + (top?.className||'').toString().slice(0,40)};
      }
      return out; })()""")
    print(json.dumps(res, indent=1, ensure_ascii=False))
    # scrolled evidence: motion card + handoff in view
    c.evaluate("document.getElementById('btn-copy-flow-package')?.scrollIntoView({block:'center'})")
    time.sleep(0.6)
    data = c.call("Page.captureScreenshot", {"format": "png"})["data"]
    (SHOT / "1366x768-scrolled-handoff.png").write_bytes(base64.b64decode(data))
    print("scrolled screenshot saved")
finally:
    chrome.terminate()
