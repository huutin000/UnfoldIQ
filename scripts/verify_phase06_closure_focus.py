"""Clean focus-visible recheck: settled page, one verified OS Tab, match+ring."""
import ctypes
import datetime
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from manual_browser_closure import CDP, wait_for
from verify_phase06_closure_keyboard import OSKeyboard, find_window, VK_TAB

PORT = 9397
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUT = Path("temp/phase06_final_closure/keyboard")
user32 = ctypes.windll.user32


def main():
    import socket
    srv, started = None, False
    if socket.socket().connect_ex(("127.0.0.1", 7860)) != 0:
        srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "studio.app:app",
                                "--host", "127.0.0.1", "--port", "7860"],
                               cwd=str(Path(__file__).resolve().parents[2]),
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            time.sleep(1)
            if socket.socket().connect_ex(("127.0.0.1", 7860)) == 0:
                break
        started = True
        time.sleep(10)
    prof = Path(f"temp/p6close_fv_{datetime.datetime.now().strftime('%H%M%S')}")
    prof.mkdir(parents=True, exist_ok=True)
    chrome = subprocess.Popen([CHROME, f"--remote-debugging-port={PORT}",
                               f"--user-data-dir={prof.resolve()}",
                               "--no-first-run", "--no-default-browser-check",
                               "--disable-session-crashed-bubble",
                               "--window-size=1440,900", "--window-position=10,10",
                               "about:blank"], stderr=subprocess.DEVNULL)
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
        E("(() => { try { localStorage.setItem('unfoldiq.onboarding.v2', JSON.stringify({"
          " schemaVersion: 2, meta: {welcome: 'dismissed', migratedFromLegacy: true},"
          " tours: {'product-overview': {status: 'dismissed'}, 'content-basics': {status: 'dismissed'},"
          " 'scene-visual-basics': {status: 'dismissed'}, 'studio-basics': {status: 'dismissed'},"
          " 'review-basics': {status: 'dismissed'}, 'export-basics': {status: 'dismissed'},"
          " 'visual-bible-basics': {status: 'dismissed'}} })); } catch (e) {} return 1; })()")
        cdp.call("Page.navigate", {"url": "http://127.0.0.1:7860"})
        assert wait_for(cdp, "document.readyState==='complete'", 60)
        assert wait_for(cdp, "typeof window.loadPreviewAudio==='function'", 60)
        loaded = False
        for _ in range(3):
            E("window.loadPreviewAudio('2026-09-12_210003_youtube-narration-01',665.64,false)")
            if wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 60):
                loaded = True
                break
            time.sleep(5)
        assert loaded
        time.sleep(20)  # settle: let async renders + focus-restore finish
        wins = []
        for _ in range(20):
            wins = find_window(chrome.pid)
            if wins:
                break
            time.sleep(1)
        assert wins
        kb = OSKeyboard(wins[0])
        assert kb.foreground()
        cdp.call("Page.bringToFront")
        E("window.focus();")
        E("window.__al=[]; document.addEventListener('keydown', e=>window.__al.push(e.key), true);")
        E("if (document.activeElement) document.activeElement.blur();")
        time.sleep(0.5)
        recs = []
        for i in range(3):
            ok = kb.press_expect(E, VK_TAB, "Tab", settle=0.6)
            recs.append({
                "tabArrived": ok,
                "focused": E("(document.activeElement.tagName+'#'+document.activeElement.id)"),
                "keysSeen": E("window.__al.join('+') || 'NONE'"),
                "match": bool(E("(() => { const a=document.activeElement;"
                                " try { return a.matches(':focus-visible'); }"
                                " catch(e){ return false; } })()")),
                "ring": E("(() => { const a=document.activeElement; const cs=getComputedStyle(a);"
                          " return {w:cs.outlineWidth, s:cs.outlineStyle, shadow:(cs.boxShadow||'none').slice(0,80)}; })()"),
            })
            print(json.dumps(recs[-1], ensure_ascii=False), flush=True)
            E("window.__al=[];")
        (OUT / "focus_recheck.json").write_text(json.dumps(recs, indent=1, ensure_ascii=False), encoding="utf-8")
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
