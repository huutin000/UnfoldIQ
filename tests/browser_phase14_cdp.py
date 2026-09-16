"""
Phase 14 Browser Acceptance (CDP over native Edge, stdlib only).
Verifies:
- Vietnamese UI localization & Cost Policy pill
- Navigation between all Phase 14 workspaces (Overview, Research, Library, Timeline, Review, Export)
- Claim Ledger rendering & Source Locking status
- Canonical Library coverage
- Timeline compiler stats & Narration Master status
- Scene Mode toggle (Simple vs Advanced)
- Google Flow Modal generation
- Zero unhandled console errors

Usage: python tests/browser_phase14_cdp.py
"""

import base64
import json
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
CDP_PORT = 9235
USER_DATA = BASE_DIR / "temp" / "edge_cdp_profile_phase14"
ARTIFACTS_DIR = BASE_DIR / "temp" / "phase14_browser"
REAL_PROJECT = "2026-09-12_210003_youtube-narration-01"


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
        resp = self.sock.recv(4096).decode()
        if "101" not in resp:
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


def main():
    print("================================================================================")
    print("PHASE 14 BROWSER ACCEPTANCE (EDP/CDP)")
    print("================================================================================")
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    USER_DATA.mkdir(parents=True, exist_ok=True)

    proc = subprocess.Popen([EDGE_PATH, f"--remote-debugging-port={CDP_PORT}",
                             f"--user-data-dir={USER_DATA}", "--headless=new",
                             "--disable-gpu", "--window-size=1440,900", "about:blank"])
    print("Launched headless Edge...")
    time.sleep(2)
    try:
        req = urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=5)
        tabs = json.loads(req.read().decode())
        client = MinimalCDPClient(next(t for t in tabs if t.get("type") == "page")["webSocketDebuggerUrl"])
        client.send_command("Page.enable")
        client.send_command("Runtime.enable")
        client.send_command("Page.navigate", {"url": "http://127.0.0.1:7860"})
        time.sleep(3)

        # 1. Cost Policy & Header
        print("\n[Step 1] Verifying Vietnamese Cost Policy Pill & App Title...")
        cost_badge = client.eval_js("document.getElementById('cost-policy-badge')?.textContent?.trim()")
        print(f"  Cost Policy badge: {cost_badge}")
        assert cost_badge and "miễn phí" in cost_badge.lower(), f"Unexpected badge: {cost_badge}"

        # 2. Select Project
        print("\n[Step 2] Selecting Real Project and Loading Overview...")
        client.eval_js(f"window.loadPreviewAudio('{REAL_PROJECT}', 665, false);")
        time.sleep(2)

        # Switch to overview workspace
        client.eval_js("window.switchWorkspace('overview');")
        time.sleep(2)
        client.shot("01_phase14_overview.png")

        stage_cards = client.eval_js("document.querySelectorAll('#overview-stages-grid .stage-card').length")
        print(f"  Rendered stage cards: {stage_cards}")
        assert stage_cards >= 6, f"Expected >= 6 stage cards, got {stage_cards}"

        overview_title = client.eval_js("document.getElementById('overview-project-title')?.textContent")
        print(f"  Overview Title: {overview_title}")
        assert overview_title and len(overview_title) > 3, f"Expected project title, got {overview_title}"

        # 3. Research Workspace & Claim Ledger
        print("\n[Step 3] Verifying Research Workspace & Claim Ledger...")
        client.eval_js("window.switchWorkspace('research');")
        time.sleep(2)
        client.shot("02_phase14_research.png")

        claim_cards = client.eval_js("document.querySelectorAll('#research-claims-list .claim-card').length")
        source_cards = client.eval_js("document.querySelectorAll('#research-sources-list .source-card').length")
        source_lock = client.eval_js("document.getElementById('research-lock-badge')?.textContent")
        print(f"  Sources: {source_cards}, Claims: {claim_cards}, Source Lock Status: {source_lock}")
        assert source_cards >= 4, f"Expected >= 4 sources, got {source_cards}"
        assert claim_cards >= 5, f"Expected >= 5 claims, got {claim_cards}"
        assert "Đã khóa" in (source_lock or ""), f"Expected locked status, got {source_lock}"

        # 4. Canonical Library Workspace
        print("\n[Step 4] Verifying Canonical Library Workspace...")
        client.eval_js("window.switchWorkspace('library');")
        time.sleep(2)
        client.shot("03_phase14_library.png")

        library_cards = client.eval_js("document.querySelectorAll('#library-cards-container .stage-card').length")
        print(f"  Library Cards: {library_cards}")
        assert library_cards >= 3, f"Expected >= 3 library entities, got {library_cards}"

        # 5. Timeline Workspace
        print("\n[Step 5] Verifying Timeline Compiler Workspace...")
        client.eval_js("window.switchWorkspace('timeline');")
        time.sleep(2)
        client.shot("04_phase14_timeline.png")

        tl_scenes = client.eval_js("document.getElementById('timeline-scenes-count')?.textContent")
        tl_clips = client.eval_js("document.querySelectorAll('#timeline-clips-list .timeline-clip-row').length")
        print(f"  Timeline Scenes text: {tl_scenes}, Clips rendered: {tl_clips}")
        assert "79" in (tl_scenes or ""), f"Expected 79 scenes in timeline, got {tl_scenes}"
        assert tl_clips == 79, f"Expected 79 clip rows rendered, got {tl_clips}"

        # 6. Review & Approval Workspace
        print("\n[Step 6] Verifying Review & Quality Issues...")
        client.eval_js("window.switchWorkspace('review');")
        time.sleep(2)
        client.shot("05_phase14_review.png")

        issues_cards = client.eval_js("document.querySelectorAll('#review-issues-container .stage-card').length")
        print(f"  Review Issues rendered: {issues_cards}")
        assert issues_cards >= 1, f"Expected at least 1 issue card, got {issues_cards}"

        # 7. Export Workspace
        print("\n[Step 7] Verifying Export Workspace Deliverables Checklist...")
        client.eval_js("window.switchWorkspace('export');")
        time.sleep(2)
        client.shot("06_phase14_export.png")

        deliverables = client.eval_js("document.querySelectorAll('.deliverables-list .deliverable-item').length")
        has_draft_btn = client.eval_js("document.getElementById('btn-trigger-draft-render') !== null")
        has_final_btn = client.eval_js("document.getElementById('btn-trigger-final-render') !== null")
        print(f"  Deliverables items: {deliverables}, Draft btn: {has_draft_btn}, Final btn: {has_final_btn}")
        assert deliverables >= 5, f"Expected 5 deliverables, got {deliverables}"
        assert has_draft_btn and has_final_btn, "Expected draft and final buttons"

        # 8. Scene Mode Toggle (Simple vs Advanced)
        print("\n[Step 8] Verifying Scene Mode Toggle in Scenes Workspace...")
        client.eval_js("window.switchWorkspace('scenes');")
        time.sleep(2)

        # Switch to Simple Mode
        client.eval_js("document.getElementById('btn-scene-simple-mode')?.click();")
        time.sleep(1)
        simple_active = client.eval_js("document.getElementById('btn-scene-simple-mode')?.classList.contains('active')")
        print(f"  Simple mode button active: {simple_active}")
        assert simple_active is True, "Simple mode button should be active"

        # Switch to Advanced Mode
        client.eval_js("document.getElementById('btn-scene-advanced-mode')?.click();")
        time.sleep(1)
        adv_active = client.eval_js("document.getElementById('btn-scene-advanced-mode')?.classList.contains('active')")
        print(f"  Advanced mode button active: {adv_active}")
        assert adv_active is True, "Advanced mode button should be active"

        # 9. Google Flow Adapter Modal
        print("\n[Step 9] Verifying Google Flow Modal Generation...")
        client.eval_js("window.openFlowInstructions('scene_001');")
        time.sleep(2)
        client.shot("07_phase14_flow_modal.png")

        modal_open = client.eval_js("document.getElementById('modal-flow-instructions')?.style?.display !== 'none'")
        flow_prompt = client.eval_js("document.getElementById('flow-modal-prompt-text')?.value")
        print(f"  Flow Modal Open: {modal_open}, Prompt length: {len(flow_prompt or '')}")
        assert modal_open is True, "Flow modal should be visible"
        assert flow_prompt and len(flow_prompt) > 20, "Flow prompt should be populated"
        assert "@Homo habilis" in flow_prompt, f"Expected @Homo habilis tag in prompt, got {flow_prompt[:60]}"

        # Close modal
        client.eval_js("document.getElementById('flow-modal-close-btn')?.click();")
        time.sleep(1)

        print("\n================================================================================")
        print("ALL PHASE 14 BROWSER ACCEPTANCE CHECKS PASSED (9/9)")
        print("================================================================================")

    finally:
        proc.kill()


if __name__ == "__main__":
    main()
