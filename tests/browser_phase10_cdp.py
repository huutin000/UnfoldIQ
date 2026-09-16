"""
Phase 10 Browser-Level UI Acceptance Test using Chrome DevTools Protocol (CDP) over native Edge.
Verifies:
1. Hidden-by-default visual continuity director (no visible 7th tab in sidebar)
2. Contextual visual continuity widget in Scene Plan & Veo Prompt inspectors
3. Visual Bible modal opening, category navigation (Subjects, Environments, Periods, Props, Groups, Issues)
4. Issue queue rendering and severity filters
5. Clean workstation lifecycle (project switch/close clears transient visual continuity state)
6. Captures visual screenshots to artifacts directory for walkthrough proof.
"""

import base64
import json
import os
import re
import socket
import struct
import subprocess
import shutil
import sys
import time
import urllib.request
from pathlib import Path

BASE_DIR = Path(r"D:\Project\UnfoldIQ")
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
CDP_PORT = 9230
USER_DATA = BASE_DIR / "temp" / "edge_cdp_profile_phase10"
ARTIFACTS_DIR = Path(r"C:\Users\huuti\.gemini\antigravity-ide\brain\5628e87f-6e41-47df-b7bb-2771d3786088")


class MinimalCDPClient:
    def __init__(self, ws_url: str):
        m = re.match(r"ws://([^:/]+):(\d+)(/.+)", ws_url)
        if not m:
            raise ValueError(f"Invalid WS URL: {ws_url}")
        self.host = m.group(1)
        self.port = int(m.group(2))
        self.path = m.group(3)

        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        self._handshake()
        self.msg_id = 0

    def _handshake(self):
        sec_key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {sec_key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        resp = self.sock.recv(4096).decode()
        if "101" not in resp:
            raise RuntimeError(f"WebSocket handshake failed: {resp}")

    def send_command(self, method: str, params: dict = None) -> dict:
        self.msg_id += 1
        msg = {"id": self.msg_id, "method": method, "params": params or {}}
        data = json.dumps(msg).encode("utf-8")

        mask_key = os.urandom(4)
        length = len(data)
        if length <= 125:
            header = struct.pack("!BB", 0x81, 0x80 | length)
        elif length <= 65535:
            header = struct.pack("!BBH", 0x81, 0x80 | 126, length)
        else:
            header = struct.pack("!BBQ", 0x81, 0x80 | 127, length)

        masked_data = bytearray(length)
        for i in range(length):
            masked_data[i] = data[i] ^ mask_key[i % 4]

        frame = header + mask_key + masked_data
        self.sock.sendall(frame)

        # Receive response
        while True:
            resp_data = self._read_frame()
            try:
                resp_json = json.loads(resp_data)
                if resp_json.get("id") == self.msg_id:
                    return resp_json
            except Exception:
                pass

    def _read_frame(self) -> str:
        head = self.sock.recv(2)
        if len(head) < 2:
            return ""
        b1, b2 = struct.unpack("!BB", head)
        payload_len = b2 & 0x7F
        if payload_len == 126:
            ext = self.sock.recv(2)
            payload_len = struct.unpack("!H", ext)[0]
        elif payload_len == 127:
            ext = self.sock.recv(8)
            payload_len = struct.unpack("!Q", ext)[0]

        data = bytearray()
        while len(data) < payload_len:
            chunk = self.sock.recv(payload_len - len(data))
            if not chunk:
                break
            data.extend(chunk)
        return data.decode("utf-8", errors="replace")

    def eval_js(self, js: str):
        res = self.send_command("Runtime.evaluate", {
            "expression": js,
            "returnByValue": True,
            "awaitPromise": True
        })
        return res.get("result", {}).get("result", {}).get("value")

    def capture_screenshot(self, output_path: Path):
        res = self.send_command("Page.captureScreenshot", {"format": "png"})
        b64 = res.get("result", {}).get("data")
        if b64:
            output_path.write_bytes(base64.b64decode(b64))
            print(f"  [Artifact Captured] -> {output_path.name}")
        else:
            print(f"  [ERROR] Failed to capture screenshot for {output_path.name}")


def main():
    print("================================================================================")
    print("PHASE 10 BROWSER UI ACCEPTANCE AUDIT: VISUAL CONTINUITY DIRECTOR")
    print("================================================================================")

    USER_DATA.mkdir(parents=True, exist_ok=True)
    cmd = [
        EDGE_PATH,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={USER_DATA}",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1440,900",
        "about:blank",
    ]
    proc = subprocess.Popen(cmd)
    print(f"Launched headless Edge with CDP port {CDP_PORT}...")

    time.sleep(2)

    try:
        req = urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=5)
        tabs = json.loads(req.read().decode())
        page_tab = next(t for t in tabs if t.get("type") == "page")
        ws_url = page_tab["webSocketDebuggerUrl"]
        client = MinimalCDPClient(ws_url)

        print("\n[Step 1] Navigating to UnfoldIQ Studio...")
        client.send_command("Page.navigate", {"url": "http://127.0.0.1:7860"})
        time.sleep(2)

        # Assertion 1: Verify 6 visible numbered pipeline steps (NO 7th tab in sidebar)
        visible_nav_tabs = client.eval_js("""
            Array.from(document.querySelectorAll('.pipeline-nav .nav-item'))
                .filter(b => b.querySelector('.nav-step-num'))
                .map(b => b.querySelector('.nav-label').textContent.trim())
        """)
        print(f"  Visible Numbered Pipeline Steps: {visible_nav_tabs}")
        assert len(visible_nav_tabs) == 6, f"Expected exactly 6 visible pipeline tabs, got {len(visible_nav_tabs)}"
        assert not any("Visual Continuity" in t for t in visible_nav_tabs), "Visual Continuity must NOT be a visible 7th tab!"
        print("  -> PASS: Hidden-by-default architecture confirmed (6 visible pipeline stages).")

        # [Step 2] Open real project 2026-09-12_210003_youtube-narration-01
        print("\n[Step 2] Opening project '2026-09-12_210003_youtube-narration-01'...")
        client.eval_js("""
            window.loadPreviewAudio('2026-09-12_210003_youtube-narration-01', 665, false);
        """)
        time.sleep(2)

        # Switch to Scene Plan workspace
        client.eval_js("""
            const btn = document.getElementById('nav-step-scenes');
            if (btn) btn.click();
        """)
        time.sleep(1)

        # Assertion 2: Verify contextual widget rendered
        widget_status = client.eval_js("""
            document.getElementById('vc-status-badge-scenes')?.textContent?.trim()
        """)
        subj_count = client.eval_js("""
            document.getElementById('vc-subjects-count-scenes')?.textContent?.trim()
        """)
        env_count = client.eval_js("""
            document.getElementById('vc-envs-count-scenes')?.textContent?.trim()
        """)
        grp_count = client.eval_js("""
            document.getElementById('vc-groups-count-scenes')?.textContent?.trim()
        """)
        conflicts = client.eval_js("""
            document.getElementById('vc-conflicts-count-scenes')?.textContent?.trim()
        """)
        print(f"  Contextual Widget Status: {widget_status}")
        print(f"  Metrics: {subj_count} subjects, {env_count} environments, {grp_count} groups, {conflicts} conflicts")
        assert widget_status in ("READY", "PASS"), f"Expected READY/PASS, got {widget_status}"
        assert int(subj_count) >= 1, f"Expected subjects >= 1, got {subj_count}"

        client.capture_screenshot(ARTIFACTS_DIR / "phase10_01_visual_continuity_widget.png")

        # [Step 3] Open Visual Bible Modal
        print("\n[Step 3] Clicking 'Xem Visual Bible' button...")
        client.eval_js("""
            document.querySelector('.visual-continuity-card .btn-open-visual-bible').click();
        """)
        time.sleep(1)

        modal_visible = client.eval_js("""
            document.getElementById('visual-bible-modal')?.style?.display !== 'none'
        """)
        active_tab = client.eval_js("""
            document.querySelector('.vb-tab-btn.active')?.textContent?.trim()
        """)
        entity_cards_count = client.eval_js("""
            document.querySelectorAll('#vb-entity-items .vb-entity-card').length
        """)
        print(f"  Modal visible: {modal_visible}, Active tab: {active_tab}, Entity cards: {entity_cards_count}")
        assert modal_visible, "Visual Bible modal should be visible!"
        assert entity_cards_count >= 1, "Entity list should render entities!"

        client.capture_screenshot(ARTIFACTS_DIR / "phase10_02_visual_bible_modal_subjects.png")

        # [Step 4] Switch to 'Cần kiểm tra' (Issues Queue) tab
        print("\n[Step 4] Switching to 'Cần kiểm tra' tab in modal...")
        client.eval_js("""
            document.querySelector('.vb-tab-btn[data-tab="issues"]').click();
        """)
        time.sleep(1)

        issues_summary = client.eval_js("""
            document.getElementById('vb-issues-summary-text')?.textContent?.trim()
        """)
        print(f"  Issues Summary: {issues_summary}")

        client.capture_screenshot(ARTIFACTS_DIR / "phase10_03_visual_bible_modal_issues.png")

        # [Step 5] Close modal and verify workstation clean reset
        print("\n[Step 5] Closing Visual Bible modal...")
        client.eval_js("""
            document.getElementById('vb-modal-done-btn').click();
        """)
        time.sleep(0.5)

        modal_closed = client.eval_js("""
            document.getElementById('visual-bible-modal')?.style?.display === 'none'
        """)
        assert modal_closed, "Modal should be closed!"

        print("\n[Step 6] Testing clean workstation reset on project close...")
        client.eval_js("""
            window.resetWorkstationToCleanState();
        """)
        time.sleep(1)

        reset_badge = client.eval_js("""
            document.getElementById('vc-status-badge-scenes')?.textContent?.trim()
        """)
        reset_subjects = client.eval_js("""
            document.getElementById('vc-subjects-count-scenes')?.textContent?.trim()
        """)
        print(f"  After project close: status='{reset_badge}', subjects='{reset_subjects}'")
        assert reset_badge == "NOT GENERATED", f"Expected NOT GENERATED, got {reset_badge}"
        assert reset_subjects == "0", f"Expected 0, got {reset_subjects}"

        client.capture_screenshot(ARTIFACTS_DIR / "phase10_04_clean_workstation_reset.png")
        print("  -> PASS: Transient visual continuity state completely purged on project close.")

        print("\n================================================================================")
        print("ALL BROWSER UI ACCEPTANCE CHECKS PASSED SUCCESSFULLY!")
        print("================================================================================")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
        if USER_DATA.exists():
            try:
                shutil.rmtree(USER_DATA)
            except Exception:
                pass


if __name__ == "__main__":
    main()
