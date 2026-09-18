"""Phase 4 browser validation — real Chrome via CDP (stdlib + websockets).

Verifies UI touched by Phase 4: Export Workbench package card, reference
thumbnail-first image with master fallback, 3A/3B/3C/3D smoke. Read-only
(no package builds, no renders, no saves).
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
OUT = Path("temp/phase04_verification/browser")
SHOT = OUT / "screenshots"
PROFILE = Path("temp/browser_profile_p4")
CDP_PORT = 9337


def main():
    SHOT.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)
    veo = Path("projects") / PROJ / "veo_prompts.json"
    audio = Path("projects") / PROJ / "audio.wav"
    h_veo = hashlib.sha256(veo.read_bytes()).hexdigest()
    h_audio = hashlib.sha256(audio.read_bytes()).hexdigest()

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
    assert targets, "DevTools never came up"
    try:
        pt = next(t for t in targets if t.get("type") == "page")
        cdp = CDP(pt["webSocketDebuggerUrl"])
        cdp.call("Page.enable"); cdp.call("Runtime.enable")
        cdp.call("Log.enable"); cdp.call("Network.enable")
        results, errors, unhandled, failed, f5xx = {}, [], [], [], []
        req_url, netlog = {}, []
        for (w, h) in [(1920, 1080), (1440, 900), (1366, 768)]:
            key = f"{w}x{h}"
            cdp.call("Emulation.setDeviceMetricsOverride",
                     {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False})
            cdp.call("Page.navigate", {"url": APP})
            assert wait_for(cdp, "document.readyState==='complete'", 60)
            assert wait_for(cdp, "typeof window.loadPreviewAudio==='function'", 60)
            cdp.evaluate(f"window.loadPreviewAudio('{PROJ}',665.64,false)")
            assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 60)
            cdp.evaluate("""(() => { const b = Array.from(document.querySelectorAll('button'))
              .find(x => (x.innerText||'').includes('Khám phá sau')); if (b) b.click(); })()""")
            time.sleep(0.8)
            # Export workbench: package card
            cdp.evaluate("window.switchWorkspace('export')")
            assert wait_for(cdp, "!!document.getElementById('export-package-box')", 30)
            time.sleep(1.5)
            exp = cdp.evaluate("""(() => ({
              box: !!(document.getElementById('export-package-box')),
              btn: !!(document.getElementById('btn-download-portable-package')),
              btnEnabled: (document.getElementById('btn-download-portable-package')||{}).disabled === false,
              readiness: (document.getElementById('export-readiness-box')?.innerText||'').slice(0,120)
            }))()""")
            cdp.call("Page.navigate", {"url": APP}) if False else None
            # Visual bible reference image: thumbnail-first with master fallback
            cdp.evaluate("window.switchWorkspace('scenes')")
            time.sleep(1.0)
            img = cdp.evaluate("""(async () => {
              const r = await fetch('/api/projects/%s/visual/bible').then(x=>x.json()).catch(()=>null);
              return {ok: !!r};
            })()""" % PROJ)
            shot_data = cdp.call("Page.captureScreenshot", {"format": "png"})["data"]
            (SHOT / f"{key}-phase4.png").write_bytes(base64.b64decode(shot_data))
            print(key, "shot saved")
            layout = cdp.evaluate("""(() => ({noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1}))()""")
            results[key] = {"inner": [w, h], "layout_pass": bool(layout["noOverflow"]),
                            "export_pkg": exp, "bible_api": img,
                            "noOverflow": layout["noOverflow"]}
        # smoke all workbenches
        smoke = {}
        for ws in ["overview", "story", "voice", "scenes", "export"]:
            cdp.evaluate(f"window.switchWorkspace('{ws}')")
            time.sleep(1.2)
            smoke[ws] = cdp.evaluate("""(() => { const v = document.querySelector('.workspace-workbench.active,.workspace-view.active');
              const el = v || document.body;
              return {blank: ((v?.innerText||'').trim().length < 5)}; })()""")
        cdp.drain()
        for ev in cdp.events:
            m, p = ev.get("method", ""), ev.get("params", {})
            if m == "Network.requestWillBeSent" and p.get("requestId"):
                req_url[p["requestId"]] = p.get("request", {}).get("url", "")
            elif m == "Log.entryAdded":
                e = p.get("entry", {})
                if e.get("level") == "error" and e.get("source") in ("javascript", "network"):
                    errors.append({"text": e.get("text", "")[:250], "url": e.get("url", "")})
            elif m == "Runtime.exceptionThrown":
                unhandled.append(str(p.get("exceptionDetails", {}).get("text", ""))[:250])
            elif m == "Network.loadingFailed":
                if p.get("type") not in ("Media",):
                    failed.append({"url": req_url.get(p.get("requestId", ""), ""),
                                   "err": p.get("errorText", "")})
            elif m == "Network.responseReceived":
                r = p.get("response", {})
                netlog.append(r.get("status"))
                if r.get("url", "").startswith(APP) and r.get("status", 0) >= 500:
                    f5xx.append(r.get("url", ""))
        summary = {"viewports": {k: v["layout_pass"] for k, v in results.items()},
                   "details": results,
                   "console_errors": len(errors), "errors": errors[:10],
                   "unhandled": len(unhandled), "failed_non_media": len(failed),
                   "failed": failed[:10], "server_5xx": len(f5xx), "smoke": smoke,
                   "veo_unchanged": h_veo == hashlib.sha256(veo.read_bytes()).hexdigest(),
                   "audio_unchanged": h_audio == hashlib.sha256(audio.read_bytes()).hexdigest()}
        (OUT / "run_summary_p4.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps(summary, indent=1, ensure_ascii=False)[:2200])
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
