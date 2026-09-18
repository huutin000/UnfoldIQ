"""Phase 5 perf harness — CDP measurements (no fabrication).

Measures on the live app: navigator render ms (p50/p95 over N runs),
DOM node counts, selection latency, keyboard latency. Writes JSON evidence.
Usage: python scripts/verify_phase05_performance.py [project_dir] [runs]
"""
import base64
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
OUT = Path("temp/phase05_verification/performance")
PROFILE = Path("temp/browser_profile_p5")
CDP_PORT = 9338


def main():
    proj = sys.argv[1] if len(sys.argv) > 1 else "2026-09-12_210003_youtube-narration-01"
    runs = int(sys.argv[2]) if len(sys.argv) > 2 else 21
    label = sys.argv[3] if len(sys.argv) > 3 else "baseline"
    OUT.mkdir(parents=True, exist_ok=True)
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
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1920, "height": 1080, "deviceScaleFactor": 1, "mobile": False})
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        assert wait_for(cdp, "typeof window.loadPreviewAudio==='function'", 60)
        ua = cdp.evaluate("navigator.userAgent")
        cdp.evaluate(f"window.loadPreviewAudio('{proj}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        cdp.evaluate("""(() => { const b = Array.from(document.querySelectorAll('button'))
          .find(x => (x.innerText||'').includes('Khám phá sau')); if (b) b.click(); })()""")
        time.sleep(0.8)
        cdp.evaluate("window.switchWorkspace('scenes')")
        time.sleep(1.0)
        # Settle: stop the 32MB startup audio stream so select timing isn't
        # polluted by single-worker head-of-line blocking (documented).
        cdp.evaluate("""(() => { const a = document.getElementById('audio-player');
          if (a) { try { a.pause(); } catch (e) {} a.removeAttribute('src'); a.load(); } })()""")
        time.sleep(4.0)
        # Warmup: first request from fresh headless Chrome pays connection/
        # proxy setup cost (~seconds); exclude it from steady-state timing.
        cdp.evaluate("fetch('/health').then(r=>r.json()).catch(()=>null)")
        time.sleep(1.0)

        render_ms, sel_ms, key_ms = [], [], []
        for _ in range(runs):
            v = cdp.evaluate("""(() => {
              const t0 = performance.now();
              window.renderVisualSceneNavigator();
              const t1 = performance.now();
              return {render: t1 - t0, nodes: document.getElementsByTagName('*').length,
                      groups: document.querySelectorAll('#sp-rows-container .visual-scene-group').length,
                      rows: document.querySelectorAll('#sp-rows-container button').length};
            })()""")
            render_ms.append(v["render"])
            last = v
        # selection latency: select 5 different shots
        shots = cdp.evaluate("(() => Array.from(document.querySelectorAll('#sp-rows-container [data-action=select-shot]')).slice(0,5).map(b=>[b.dataset.shotId,b.dataset.sceneId]))()")
        for sid, scid in shots:
            v = cdp.evaluate(f"""(async () => {{
              const t0 = performance.now();
              await window.selectVisualShot('{sid}','{scid}');
              return performance.now() - t0; }})()""", await_promise=True)
            sel_ms.append(v)
        # scroll FPS: programmatic top->bottom scroll, count rAF over the run
        fps = cdp.evaluate("""(() => new Promise(res => {
          const el = document.getElementById('sp-rows-container');
          if (!el) res({fps: 0, frames: 0, ms: 0});
          let frames = 0;
          const t0 = performance.now();
          el.scrollTop = 0;
          function tick() {
            frames++;
            const el2 = document.getElementById('sp-rows-container');
            const max = el2.scrollHeight - el2.clientHeight;
            el2.scrollTop = Math.min(max, el2.scrollTop + Math.max(60, max / 40));
            if (performance.now() - t0 < 2500 && el2.scrollTop < max) requestAnimationFrame(tick);
            else {
              const ms = performance.now() - t0;
              res({fps: Math.round(frames / (ms / 1000)), frames, ms: Math.round(ms)});
            }
          }
          requestAnimationFrame(tick);
        }))()""", await_promise=True, timeout=60)
        cdp.evaluate("""(() => { const b = document.querySelector('#sp-rows-container button'); if (b) b.focus(); })()""")
        for _ in range(5):
            t0 = time.perf_counter()
            cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "ArrowDown",
                                                "code": "ArrowDown", "windowsVirtualKeyCode": 40})
            cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "ArrowDown",
                                                "code": "ArrowDown", "windowsVirtualKeyCode": 40})
            key_ms.append((time.perf_counter() - t0) * 1000)

        import statistics
        def pct(data, p):
            s = sorted(data)
            k = (len(s) - 1) * p / 100
            f, c = int(k), min(int(k) + 1, len(s) - 1)
            return s[f] + (s[c] - s[f]) * (k - f)
        result = {"label": label, "project": proj, "runs": runs,
                  "viewport": [1920, 1080], "userAgent": ua,
                  "render_ms": {"samples": [round(x, 2) for x in render_ms],
                                "p50": round(pct(render_ms, 50), 2),
                                "p95": round(pct(render_ms, 95), 2)},
                  "dom": {"nodes": last["nodes"], "groups": last["groups"], "rows": last["rows"]},
                  "scroll_fps": fps,
                  "select_ms": {"p50": round(pct(sel_ms, 50), 2), "p95": round(pct(sel_ms, 95), 2)},
                  "key_ms": {"p50": round(pct(key_ms, 50), 2), "p95": round(pct(key_ms, 95), 2)}}
        (OUT / f"{label}.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
        print(json.dumps(result, indent=1)[:1200])
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
