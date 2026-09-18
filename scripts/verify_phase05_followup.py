"""Phase 5 corrective closure — targeted follow-up (headed, temp-only).

1. Home-key focus target on dense fixture (full activeElement identity;
   main harness only read dataset.shotId, which scene headers lack).
2. Palette Enter re-check with correct contract: ArrowDown then ArrowUp
   back to opt-0, Enter must activate the HIGHLIGHTED stable ID (shot_001).
Writes temp/phase05_evidence_closure/performance/{dense_home,palette_enter_corrected}.json
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
DENSE = "_p5e_dense300"
PERF = Path("temp/phase05_evidence_closure/performance")
PROFILE = Path("temp/headed_profile_p5f")
CDP_PORT = 9351


def key(cdp, name, code, vk):
    for t in ("rawKeyDown", "keyUp"):
        cdp.call("Input.dispatchKeyEvent", {"type": t, "key": name, "code": code,
                                            "windowsVirtualKeyCode": vk,
                                            "nativeVirtualKeyCode": vk}, timeout=12)
    time.sleep(0.4)


def ctrl_k(cdp):
    for t in ("rawKeyDown", "keyUp"):
        cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "k", "code": "KeyK",
                                            "windowsVirtualKeyCode": 75,
                                            "nativeVirtualKeyCode": 75, "modifiers": 2}, timeout=12)
    time.sleep(0.8)


def main():
    import shutil
    dst = Path("projects") / DENSE
    shutil.rmtree(dst, ignore_errors=True)
    r = subprocess.run([sys.executable, "scripts/make_dense_fixture.py", DENSE, "300"],
                       capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, r.stderr[-2000:]
    print(r.stdout.strip(), flush=True)

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

        ident = ("(() => { const a = document.activeElement; if (!a) return null;"
                 " return {tag: a.tagName, shot: a.dataset?.shotId || null,"
                 " scene: a.dataset?.sceneId || null,"
                 " text: (a.innerText||'').slice(0,40)}; })()")
        # --- Home probe on dense (mirror main-harness setup: dismiss
        # onboarding, scenes workspace, pause audio) ---
        E(f"window.loadPreviewAudio('{DENSE}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        E("""(() => { const b = Array.from(document.querySelectorAll('button'))
          .find(x => (x.innerText||'').includes('Khám phá sau')); if (b) b.click(); })()""")
        time.sleep(0.8)
        E("window.switchWorkspace('scenes')")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.0)
        E("""(() => { const a = document.getElementById('audio-player');
          if (a) { try { a.pause(); } catch (e) {} a.removeAttribute('src'); a.load(); } })()""")
        time.sleep(1.0)
        E("window.selectVisualShot('shot_d001','scene_900')")
        time.sleep(1.0)
        E("window.renderVisualSceneNavigator()")
        time.sleep(1.0)
        print("DIAG card:", E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,60) || 'NO-CARD')()"), flush=True)
        print("DIAG d001btn:", E("!!document.querySelector('[data-action=select-shot][data-shot-id=shot_d001]')"), flush=True)
        print("DIAG groups:", E("document.querySelectorAll('#sp-rows-container .visual-scene-group').length"), flush=True)
        print("DIAG shotbtns:", E("document.querySelectorAll('[data-action=select-shot]').length"), flush=True)
        print("DIAG focusnow:", E("(() => { const b = document.querySelector('[data-action=select-shot][data-shot-id=shot_d001]'); if (b) b.focus(); const a = document.activeElement; return a === b ? 'FOCUSED-OK' : (a?.tagName + '|' + (a?.innerText||'').slice(0,20)); })()"), flush=True)
        time.sleep(0.3)
        E("(() => { const b = document.querySelector('[data-action=select-shot][data-shot-id=shot_d001]'); if (b) b.focus(); })()")
        time.sleep(0.3)
        before = E(ident)
        key(cdp, "Home", "Home", 36)
        after_home = E(ident)
        key(cdp, "ArrowDown", "ArrowDown", 40)
        after_down = E(ident)
        first_btn = E("(() => { const b = document.querySelector('#sp-rows-container button');"
                      " return b ? {scene: b.dataset?.sceneId || null, shot: b.dataset?.shotId || null} : null; })()")
        home = {"focus_before": before, "focus_after_home": after_home,
                "focus_after_arrowdown": after_down, "first_button": first_btn,
                "home_matches_first_button": after_home is not None and first_btn is not None and
                after_home.get("scene") == first_btn.get("scene") and
                after_home.get("shot") == first_btn.get("shot")}
        (PERF / "dense_home.json").write_text(json.dumps(home, indent=1, ensure_ascii=False), encoding="utf-8")
        print("HOME:", json.dumps(home, ensure_ascii=False), flush=True)

        # --- palette Enter contract on reference ---
        E(f"window.loadPreviewAudio('{REF}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        time.sleep(1.0)
        ctrl_k(cdp)
        opened = E("window.UQPalette.isOpen()")
        E("(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'shot_001';"
          " i.dispatchEvent(new Event('input', {bubbles:true})); })()")
        time.sleep(0.6)
        key(cdp, "ArrowDown", "ArrowDown", 40)
        mid = E("(() => document.querySelector('.uq-cmd-item.is-active')?.id || '')()")
        key(cdp, "ArrowUp", "ArrowUp", 38)
        top = E("(() => document.querySelector('.uq-cmd-item.is-active')?.id || '')()")
        key(cdp, "Enter", "Enter", 13)
        time.sleep(1.5)
        card = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,120) || '')()")
        enter = {"opened": opened, "active_after_down": mid, "active_after_up": top,
                 "card": card, "pass": opened is True and top == "uq-cmd-opt-0" and "shot_001" in card}
        (PERF / "palette_enter_corrected.json").write_text(
            json.dumps(enter, indent=1, ensure_ascii=False), encoding="utf-8")
        print("ENTER:", json.dumps(enter, ensure_ascii=False)[:300], flush=True)
        cdp.drain()
        errs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                and (e.get("params", {}) or {}).get("entry", {}).get("level") == "error"]
        print("console errors:", len(errs), flush=True)
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()
    shutil.rmtree(dst, ignore_errors=True)
    print("leftover:", [p.name for p in Path("projects").glob("_p5e*")], flush=True)


if __name__ == "__main__":
    main()
