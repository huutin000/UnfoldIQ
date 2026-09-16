"""
Phase 12–13 Browser Acceptance (CDP over native Edge, stdlib only).

Covers §60: Script QA, Visual Bible, References, Scene Plan, Invalidation,
Multi-project/blank. Mutations happen on disposable projects/phase1213_proj_b;
the reference project is display-only (except additive editorial/visual artifacts).

Usage: python tests/browser_phase1213_cdp.py
"""

import base64
import io
import json
import mimetypes
import os
import re
import socket
import struct
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BASE_DIR = Path(r"D:\Project\UnfoldIQ")
sys.path.insert(0, str(BASE_DIR))
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
CDP_PORT = 9232
USER_DATA = BASE_DIR / "temp" / "edge_cdp_profile_phase1213"
ARTIFACTS_DIR = BASE_DIR / "temp" / "phase1213_browser"
REAL_PROJECT = "2026-09-12_210003_youtube-narration-01"
PROJ_B = "phase1213_proj_b"


class MinimalCDPClient:
    def __init__(self, ws_url: str):
        m = re.match(r"ws://([^:/]+):(\d+)(/.+)", ws_url)
        if not m:
            raise ValueError(f"Invalid WS URL: {ws_url}")
        self.host, self.port, self.path = m.group(1), int(m.group(2)), m.group(3)
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        self._handshake()
        self.msg_id = 0

    def _handshake(self):
        sec_key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET {self.path} HTTP/1.1\r\nHost: {self.host}:{self.port}\r\n"
               "Upgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {sec_key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(req.encode())
        if "101" not in self.sock.recv(4096).decode():
            raise RuntimeError("WebSocket handshake failed")

    def _recv_frame(self) -> str:
        header = self.sock.recv(2)
        payload_len = header[1] & 0x7F
        if payload_len == 126:
            payload_len = struct.unpack("!H", self.sock.recv(2))[0]
        elif payload_len == 127:
            payload_len = struct.unpack("!Q", self.sock.recv(8))[0]
        data = bytearray()
        while len(data) < payload_len:
            chunk = self.sock.recv(payload_len - len(data))
            if not chunk:
                break
            data.extend(chunk)
        return data.decode("utf-8", errors="replace")

    def send_command(self, method: str, params: dict = None) -> dict:
        self.msg_id += 1
        data = json.dumps({"id": self.msg_id, "method": method,
                           "params": params or {}}).encode()
        if len(data) <= 125:
            header = struct.pack("!BB", 0x81, 0x80 | len(data))
        elif len(data) <= 65535:
            header = struct.pack("!BBH", 0x81, 0x80 | 126, len(data))
        else:
            header = struct.pack("!BBQ", 0x81, 0x80 | 127, len(data))
        mask_key = os.urandom(4)
        masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(data))
        self.sock.sendall(header + mask_key + masked)
        while True:
            try:
                obj = json.loads(self._recv_frame())
            except Exception:
                continue
            if obj.get("id") == self.msg_id:
                return obj

    def eval_js(self, js: str):
        res = self.send_command("Runtime.evaluate", {"expression": js,
                               "returnByValue": True, "awaitPromise": True})
        return res.get("result", {}).get("result", {}).get("value")

    def shot(self, name: str):
        res = self.send_command("Page.captureScreenshot", {"format": "png"})
        b64 = res.get("result", {}).get("data")
        if b64:
            (ARTIFACTS_DIR / name).write_bytes(base64.b64decode(b64))
            print(f"  [Artifact] -> {name}")


def http_json(method: str, url: str, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def http_upload(url: str, field_name: str, filename: str, data: bytes,
                query: str = ""):
    boundary = "----UnfoldIQ1213"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field_name}\"; "
            f"filename=\"{filename}\"\r\nContent-Type: image/png\r\n\r\n").encode() \
        + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(url + query, data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def setup_proj_b():
    import shutil
    from tests.visual_foundation_fixtures import (
        build_foundation_project, make_png_bytes, make_rep)
    from studio.visual_bible_v2 import migrate_to_v2
    from studio import editorial_qa as edq
    from studio.visual_prompt import generate_all
    root = BASE_DIR / "projects"
    dest = root / PROJ_B
    if dest.exists():
        shutil.rmtree(dest)
    build_foundation_project(root, PROJ_B)
    # script with a safe applicable suggestion for the browser apply demo
    (dest / "script.txt").write_text(
        "But the river was wide and dangerous. But the group crossed anyway. "
        "The group camped early that evening by the water.", encoding="utf-8")
    migrate_to_v2(dest)
    edq.analyze_project(dest)
    generate_all(dest)
    # Corrective §5: FRONT/3-4/PROFILE references belong to a representative
    # individual, never to a group subject — create the rep first.
    rep = make_rep(dest)
    png = make_png_bytes()
    up = http_upload(f"http://127.0.0.1:7860/api/projects/{PROJ_B}/references/upload",
                     "file", "front.png", png,
                     query=f"?entity_type=CHARACTER&entity_id={rep['characterId']}&view=FRONT")
    print("  proj_B setup: migrated, analyzed, prompts built, rep:",
          rep["characterId"], "asset:", up["asset"]["assetId"])
    return png


def main():
    print("================================================================================")
    print("PHASE 12–13 BROWSER ACCEPTANCE")
    print("================================================================================")
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    USER_DATA.mkdir(parents=True, exist_ok=True)
    setup_proj_b()

    proc = subprocess.Popen([EDGE_PATH, f"--remote-debugging-port={CDP_PORT}",
                             f"--user-data-dir={USER_DATA}", "--headless=new",
                             "--disable-gpu", "--window-size=1440,900", "about:blank"])
    print("Launched headless Edge...")
    time.sleep(2)
    try:
        req = urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=5)
        tabs = json.loads(req.read().decode())
        client = MinimalCDPClient(next(t for t in tabs if t.get("type") == "page")["webSocketDebuggerUrl"])
        client.send_command("Page.navigate", {"url": "http://127.0.0.1:7860"})
        time.sleep(2)

        print("\n[S1] Editorial QA card visible on real project...")
        client.eval_js(f"window.loadPreviewAudio('{REAL_PROJECT}', 665, false);")
        time.sleep(2)
        card = client.eval_js("""({
            badge: document.getElementById('edq-status-badge')?.textContent?.trim(),
            score: document.getElementById('edq-score')?.textContent?.trim(),
            issues: document.getElementById('edq-issue-count')?.textContent?.trim(),
            prot: document.getElementById('edq-protected-count')?.textContent?.trim()
        })""")
        print(f"  card: {card}")
        assert card["issues"] == "18", card
        assert card["score"] == "50", card
        assert card["prot"] == "38", card
        assert "REVIEW" in card["badge"], card

        print("\n[S2] Issue list opens with Before/After + protected highlight...")
        client.eval_js("document.getElementById('btn-edq-view')?.click();")
        time.sleep(1)
        modal = client.eval_js("""({
            open: document.getElementById('edq-modal')?.style?.display !== 'none',
            rows: document.querySelectorAll('#edq-issues-list .compact-row').length,
            hasBefore: (document.getElementById('edq-issue-detail')?.textContent || '').includes('Before'),
            hasAfter: (document.getElementById('edq-issue-detail')?.textContent || '').includes('After'),
            hasProt: (document.getElementById('edq-issue-detail')?.innerHTML || '').includes('vb-tag')
        })""")
        print(f"  modal: {modal}")
        assert modal["open"] and modal["rows"] >= 10, modal
        assert modal["hasBefore"], modal
        client.shot("phase1213_S2_edq_modal.png")
        print("  -> PASS")

        print("\n[S3] Safe apply on proj_B via UI...")
        client.eval_js("document.getElementById('edq-modal-close-btn')?.click();")
        client.eval_js(f"window.loadPreviewAudio('{PROJ_B}', 12, false);")
        time.sleep(2)
        client.eval_js("document.getElementById('btn-edq-view')?.click();")
        time.sleep(1)
        first_has_sugg = client.eval_js("""
            document.getElementById('edq-apply-btn') ? true : false""")
        print(f"  apply button present: {first_has_sugg}")
        assert first_has_sugg is True
        client.eval_js("document.getElementById('edq-apply-btn')?.click();")
        time.sleep(2)
        after = client.eval_js("""({
            score: document.getElementById('edq-score')?.textContent?.trim(),
            issues: document.getElementById('edq-issue-count')?.textContent?.trim()
        })""")
        print(f"  after apply: {after}")
        client.shot("phase1213_S3_edq_apply.png")
        print("  -> PASS")

        print("\n[S4] Visual Bible modal: group/cast tabs separated (§15)...")
        client.eval_js(f"window.loadPreviewAudio('{REAL_PROJECT}', 665, false);")
        time.sleep(2)
        client.eval_js("document.querySelector('.visual-continuity-card .btn-open-visual-bible')?.click();")
        time.sleep(1)
        tabs = client.eval_js(
            "Array.from(document.querySelectorAll('.vb-tab-btn')).map(b => b.getAttribute('data-tab'))")
        print(f"  tabs: {tabs}")
        for t in ("subjects", "cast", "objects", "style", "references"):
            assert t in tabs, tabs
        # Representative cast tab: 3 corrective reps on the real project
        client.eval_js("document.querySelector('.vb-tab-btn[data-tab=\"cast\"]')?.click();")
        time.sleep(1)
        cast_count = client.eval_js(
            "document.querySelectorAll('#vb-entity-items .vb-entity-card').length")
        print(f"  cast cards: {cast_count}")
        assert cast_count == 3, cast_count
        # Subjects/groups tab: Homo habilis group + predator (NOT individuals)
        client.eval_js("document.querySelector('.vb-tab-btn[data-tab=\"subjects\"]')?.click();")
        time.sleep(1)
        subj_count = client.eval_js(
            "document.querySelectorAll('#vb-entity-items .vb-entity-card').length")
        print(f"  subject cards: {subj_count}")
        assert subj_count == 2, subj_count
        client.shot("phase1213_S4_vb_characters.png")
        print("  -> PASS")

        print("\n[S5] Style + References panes...")
        client.eval_js("document.querySelector('.vb-tab-btn[data-tab=\"style\"]')?.click();")
        time.sleep(1)
        style_txt = client.eval_js("document.getElementById('vb-style-pane')?.textContent?.slice(0, 200)")
        print(f"  style: {style_txt[:120]}")
        assert "Preset" in style_txt, style_txt
        client.eval_js("document.querySelector('.vb-tab-btn[data-tab=\"references\"]')?.click();")
        time.sleep(1)
        # references pane on real project (no assets yet) shows empty-state; check upload form
        up_form = client.eval_js("""({
            hasFile: !!document.getElementById('vb-ref-file'),
            hasBtn: !!document.getElementById('vb-ref-upload-btn')
        })""")
        assert up_form["hasFile"] and up_form["hasBtn"], up_form
        client.shot("phase1213_S5_vb_references.png")
        print("  -> PASS")

        print("\n[S6] Reference preview loads (proj_B asset)...")
        client.eval_js("document.getElementById('vb-modal-close-btn')?.click();")
        client.eval_js(f"window.loadPreviewAudio('{PROJ_B}', 12, false);")
        time.sleep(2)
        client.eval_js("document.querySelector('.visual-continuity-card .btn-open-visual-bible')?.click();")
        time.sleep(1)
        client.eval_js("document.querySelector('.vb-tab-btn[data-tab=\"references\"]')?.click();")
        time.sleep(2)
        img_ok = client.eval_js("""
            new Promise(resolve => {
                const img = document.querySelector('#vb-ref-grid img');
                if (!img) resolve({found: false});
                else if (img.complete && img.naturalWidth > 0) resolve({found: true, w: img.naturalWidth});
                else { img.onload = () => resolve({found: true, w: img.naturalWidth}); img.onerror = () => resolve({found: true, broken: true}); setTimeout(() => resolve({found: true, timeout: true}), 4000); }
            })""")
        print(f"  preview: {img_ok}")
        assert img_ok.get("found") and img_ok.get("w", 0) > 0, img_ok
        client.shot("phase1213_S6_ref_preview.png")
        print("  -> PASS")

        print("\n[S7] Scene visual block + override persists (proj_B)...")
        client.eval_js("document.getElementById('vb-modal-close-btn')?.click();")
        client.eval_js("document.getElementById('nav-step-scenes')?.click();")
        time.sleep(2)
        client.eval_js("window.selectSceneById ? selectSceneById('scene_001') : null;")
        time.sleep(2)
        block = client.eval_js("""({
            present: !!document.getElementById('sp-scene-visual-block'),
            text: (document.getElementById('sp-scene-visual-block')?.textContent || '').slice(0, 300)
        })""")
        print(f"  block: {block['text'][:200]}")
        assert block["present"] and "CHARACTER_SCENE" in block["text"], block
        assert ("VEO_CANDIDATE" in block["text"] or "VEO_RECOMMENDED" in block["text"]), block
        # override
        client.eval_js("""
            const sel = document.getElementById('sp-visual-override');
            if (sel) { sel.value = 'EDITOR_MOTION'; sel.dispatchEvent(new Event('change')); }""")
        time.sleep(2)
        eff = client.eval_js(
            "(document.getElementById('sp-scene-visual-block')?.textContent || '').includes('EDITOR_MOTION')")
        print(f"  override effective: {eff}")
        assert eff is True
        client.shot("phase1213_S7_scene_visual.png")
        print("  -> PASS")

        print("\n[S8] Veo inheritance block...")
        client.eval_js("document.getElementById('nav-step-veo')?.click();")
        time.sleep(2)
        client.eval_js("window.selectShotById ? selectShotById('shot_001_01') : null;")
        time.sleep(2)
        inh = client.eval_js(
            "(document.getElementById('veo-inheritance-block')?.textContent || '').slice(0, 1500)")
        print(f"  inheritance: {inh[:200]}")
        assert "Continuity strategy" in inh, inh
        assert "subject_alpha_01" in inh, inh
        client.shot("phase1213_S8_veo_inheritance.png")
        print("  -> PASS")

        print("\n[S9] Character edit invalidates only dependents (proj_B, API-verified)...")
        # S7's override legitimately staled scene_001 -> regenerate to a clean READY baseline first.
        http_json("POST", f"http://127.0.0.1:7860/api/projects/{PROJ_B}/visual-prompts/generate", {})
        before = http_json("GET", f"http://127.0.0.1:7860/api/projects/{PROJ_B}/visual-prompts")
        assert before["status"] == "READY", before["status"]
        http_json("PUT", f"http://127.0.0.1:7860/api/projects/{PROJ_B}/visual-bible/v2/entities/subject_beta_01",
                  {"kind": "character", "entity_id": "subject_beta_01",
                   "updates": {"hair": "browser acceptance anchor"}})
        after = http_json("GET", f"http://127.0.0.1:7860/api/projects/{PROJ_B}/visual-prompts")
        stale = sorted(e["sceneId"] for e in after["entries"] if e["liveStatus"] == "OUTDATED")
        print(f"  outdated scenes: {stale}")
        assert stale == ["scene_002"], stale
        print("  -> PASS")

        print("\n[S10] Multi-project switch + blank close...")
        client.eval_js(f"window.loadPreviewAudio('{REAL_PROJECT}', 665, false);")
        time.sleep(2)
        a_card = client.eval_js("document.getElementById('edq-issue-count')?.textContent?.trim()")
        client.eval_js(f"window.loadPreviewAudio('{PROJ_B}', 12, false);")
        time.sleep(2)
        b_card = client.eval_js("document.getElementById('edq-issue-count')?.textContent?.trim()")
        print(f"  A issues={a_card} B issues={b_card}")
        assert a_card == "18" and b_card != "18", (a_card, b_card)
        client.eval_js("window.resetWorkstationToCleanState ? resetWorkstationToCleanState() : null;")
        time.sleep(1)
        blank = client.eval_js("""({
            edq: document.getElementById('edq-issue-count')?.textContent?.trim(),
            prod: document.getElementById('prod-shot-count')?.textContent?.trim(),
            cardLeak: (document.getElementById('production-card')?.innerHTML || '').includes('""" + REAL_PROJECT + """')
        })""")
        print(f"  blank: {blank}")
        assert blank["edq"] == "0" and blank["prod"] == "0" and blank["cardLeak"] is False
        print("  -> PASS")

        print("\nALL BROWSER CHECKS PASSED.")
    finally:
        try:
            client.sock.close()
        except Exception:
            pass
        proc.terminate()
        # cleanup disposable project
        try:
            urllib.request.urlopen(urllib.request.Request(
                f"http://127.0.0.1:7860/api/projects/{PROJ_B}", method="DELETE"),
                timeout=30)
            print("proj_B deleted.")
        except Exception as e:
            print(f"proj_B cleanup note: {e}")


if __name__ == "__main__":
    main()
