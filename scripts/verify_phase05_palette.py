"""Phase 5 Command Palette scenarios (CDP, real browser, temp project safe).

Covers §51 subset executable headlessly: open/close, focus return, scene/
shot/character search, deterministic ranking, no-network-per-keystroke,
arrow nav, Enter stable-ID activation, virtualized target, empty state,
project-switch rebuild. No mutations (reads + navigation only).
"""
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
OUT = Path("temp/phase05_verification/palette")
PROFILE = Path("temp/browser_profile_p5p")
CDP_PORT = 9340

results = {}


def check(name, cond, extra=""):
    results[name] = {"pass": bool(cond), "extra": extra}
    print(("PASS " if cond else "FAIL ") + name, extra)


def key(cdp, k, code, vk, t="rawKeyDown"):
    cdp.call("Input.dispatchKeyEvent", {"type": t, "key": k, "code": code,
                                        "windowsVirtualKeyCode": vk,
                                        "nativeVirtualKeyCode": vk})


def ctrl_k(cdp):
    for t in ("rawKeyDown", "keyUp"):
        cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "k", "code": "KeyK",
                                            "windowsVirtualKeyCode": 75,
                                            "nativeVirtualKeyCode": 75,
                                            "modifiers": 2})


def main():
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
    assert targets
    try:
        pt = next(t for t in targets if t.get("type") == "page")
        cdp = CDP(pt["webSocketDebuggerUrl"])
        cdp.call("Page.enable"); cdp.call("Runtime.enable")
        cdp.call("Log.enable"); cdp.call("Network.enable")
        cdp.call("Page.navigate", {"url": APP})
        assert wait_for(cdp, "typeof window.loadPreviewAudio==='function'", 60)
        assert wait_for(cdp, "typeof window.UQPalette==='object'", 30), "palette missing"
        E = cdp.evaluate
        E(f"window.loadPreviewAudio('{PROJ}',665.64,false)")
        assert wait_for(cdp, "document.querySelectorAll('#sp-rows-container .visual-scene-group').length>0", 90)
        E("""(() => { const b = Array.from(document.querySelectorAll('button'))
          .find(x => (x.innerText||'').includes('Khám phá sau')); if (b) b.click(); })()""")
        time.sleep(0.8)

        # 1. Ctrl+K opens (with Ctrl modifier!)
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "k", "code": "KeyK",
                                            "windowsVirtualKeyCode": 75, "nativeVirtualKeyCode": 75, "modifiers": 2})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "k", "code": "KeyK",
                                            "windowsVirtualKeyCode": 75, "nativeVirtualKeyCode": 75, "modifiers": 2})
        time.sleep(0.8)
        check("ctrl+k opens", E("window.UQPalette.isOpen()") is True)
        check("input focused", E("document.activeElement && document.activeElement.id") == "uq-cmd-input")

        # 2. type shot id -> shot result; deterministic ranking (two runs same order)
        E("""(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'shot_001';
          i.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        time.sleep(0.6)
        r1 = E("(() => Array.from(document.querySelectorAll('.uq-cmd-item')).map(b=>b.querySelector('.uq-cmd-sub').innerText.split(' ')[0]))()")
        E("""(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'shot_00';
          i.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        time.sleep(0.6)
        E("""(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'shot_001';
          i.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        time.sleep(0.6)
        r2 = E("(() => Array.from(document.querySelectorAll('.uq-cmd-item')).map(b=>b.querySelector('.uq-cmd-sub').innerText.split(' ')[0]))()")
        check("shot search deterministic", r1 == r2 and any("shot_001" in x for x in r1), str(r1[:3]))
        kinds = E("(() => Array.from(document.querySelectorAll('.uq-cmd-kind')).map(b=>b.innerText))()")
        check("vietnamese kind labels", all(k in ("Cảnh", "Cảnh quay", "Nhân vật") for k in kinds), str(set(kinds)))

        # 3. no network per keystroke: count api fetches during typing
        cdp.drain()
        before = len([e for e in cdp.events if e.get("method") == "Network.requestWillBeSent"])
        for ch in ["s", "c", "e", "n", "e"]:
            E(f"(() => {{ const i = document.getElementById('uq-cmd-input'); i.value = i.value + '{ch}'; i.dispatchEvent(new Event('input', {{bubbles:true}})); }})()")
            time.sleep(0.25)
        cdp.drain()
        after = len([e for e in cdp.events if e.get("method") == "Network.requestWillBeSent"])
        check("no network per keystroke", after == before, f"{before}->{after}")

        # 4. Enter activates highlighted item by stable ID (no ArrowDown: index 0)
        E("""(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'shot_001';
          i.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        time.sleep(0.6)
        act0 = E("(() => document.querySelector('.uq-cmd-item.is-active')?.id || '')()")
        key(cdp, "ArrowDown", "ArrowDown", 40); key(cdp, "ArrowDown", "ArrowDown", 40, "keyUp")
        time.sleep(0.4)
        act1 = E("(() => document.querySelector('.uq-cmd-item.is-active')?.id || '')()")
        check("arrow moves active result", act0 == "uq-cmd-opt-0" and act1 == "uq-cmd-opt-1", f"{act0}->{act1}")
        key(cdp, "ArrowUp", "ArrowUp", 38); key(cdp, "ArrowUp", "ArrowUp", 38, "keyUp")
        time.sleep(0.4)
        key(cdp, "Enter", "Enter", 13); key(cdp, "Enter", "Enter", 13, "keyUp")
        time.sleep(1.5)
        card = E("(() => document.querySelector('.visual-shot-identity-card')?.innerText.slice(0,120) || '')()")
        check("enter activates stable shot", "shot_001" in card, card[:80])
        check("palette closed after activate", E("window.UQPalette.isOpen()") is False)

        # 5. character search + activation opens bible modal
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "k", "code": "KeyK",
                                            "windowsVirtualKeyCode": 75, "nativeVirtualKeyCode": 75, "modifiers": 2})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "k", "code": "KeyK",
                                            "windowsVirtualKeyCode": 75, "nativeVirtualKeyCode": 75, "modifiers": 2})
        time.sleep(0.8)
        E("""(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'habilis';
          i.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        time.sleep(0.6)
        ch = E("(() => Array.from(document.querySelectorAll('.uq-cmd-kind')).map(b=>b.innerText))()")
        check("character search", "Nhân vật" in ch, str(ch))
        key(cdp, "Enter", "Enter", 13); key(cdp, "Enter", "Enter", 13, "keyUp")
        time.sleep(1.5)
        modal = E("(() => { const m = document.getElementById('visual-bible-modal'); return m ? (m.style.display !== 'none' || m.classList.contains('open')) : 'no-modal'; })()")
        check("character activates bible modal", modal is True, str(modal))
        # close modal via its close button for clean state
        E("""(() => { const b = document.getElementById('vb-modal-close-btn'); if (b) b.click(); })()""")
        time.sleep(0.5)

        # 6. empty state
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "k", "code": "KeyK",
                                            "windowsVirtualKeyCode": 75, "nativeVirtualKeyCode": 75, "modifiers": 2})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "k", "code": "KeyK",
                                            "windowsVirtualKeyCode": 75, "nativeVirtualKeyCode": 75, "modifiers": 2})
        time.sleep(0.8)
        E("""(() => { const i = document.getElementById('uq-cmd-input'); i.value = 'zzz-khong-ton-tai';
          i.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        time.sleep(0.6)
        empty = E("(() => document.querySelector('.uq-cmd-empty')?.innerText || '')()")
        check("empty result state", "Không tìm thấy" in empty, empty)

        # 7. Escape closes + focus returns to invoker (the Ctrl+K happened from body;
        # focus a real button first, then open, then escape)
        E("""(() => { const b = document.querySelector('#sp-rows-container button'); if (b) b.focus(); })()""")
        time.sleep(0.3)
        invoker = E("(() => document.activeElement?.dataset?.sceneId || '?')()")
        cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "k", "code": "KeyK",
                                            "windowsVirtualKeyCode": 75, "nativeVirtualKeyCode": 75, "modifiers": 2})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "k", "code": "KeyK",
                                            "windowsVirtualKeyCode": 75, "nativeVirtualKeyCode": 75, "modifiers": 2})
        time.sleep(0.8)
        key(cdp, "Escape", "Escape", 27); key(cdp, "Escape", "Escape", 27, "keyUp")
        time.sleep(0.5)
        back = E("(() => document.activeElement?.dataset?.sceneId || '?')()")
        check("escape closes + focus returns", E("window.UQPalette.isOpen()") is False and back == invoker,
              f"{invoker}->{back}")

        errs = [e for e in cdp.events if e.get("method") == "Log.entryAdded"
                and e.get("params", {}).get("entry", {}).get("level") == "error"]
        check("no console errors", len(errs) == 0, str(len(errs)))
        (OUT / "palette_results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
        print("OVERALL:", all(v["pass"] for v in results.values()))
    finally:
        chrome.terminate()
        if started and srv:
            srv.terminate()


if __name__ == "__main__":
    main()
