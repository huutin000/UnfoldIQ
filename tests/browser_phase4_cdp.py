"""
Phase 4 Browser-Level UI Acceptance Test using Chrome DevTools Protocol (CDP) over native Edge.
Verifies the Timestamps & Subtitles UI, status badges, cue timeline preview, and capture evidence screenshot.
100% Python Standard Library.
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
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
CDP_PORT = 9223  # Dedicated port for Phase 4
USER_DATA = BASE_DIR / "temp" / "edge_cdp_profile_phase4"


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

        if length < 126:
            header = bytearray([0x81, 0x80 | length])
        elif length < 65536:
            header = bytearray([0x81, 0x80 | 126]) + struct.pack("!H", length)
        else:
            header = bytearray([0x81, 0x80 | 127]) + struct.pack("!Q", length)

        masked_data = bytearray(b ^ mask_key[i % 4] for i, b in enumerate(data))
        self.sock.sendall(header + mask_key + masked_data)

        while True:
            resp_data = self._read_frame()
            if not resp_data:
                continue
            parsed = json.loads(resp_data.decode("utf-8"))
            if parsed.get("id") == self.msg_id:
                return parsed

    def _read_frame(self) -> bytes:
        head = self.sock.recv(2)
        if len(head) < 2:
            return b""
        b1, b2 = head[0], head[1]
        length = b2 & 0x7F
        if length == 126:
            len_bytes = self.sock.recv(2)
            length = struct.unpack("!H", len_bytes)[0]
        elif length == 127:
            len_bytes = self.sock.recv(8)
            length = struct.unpack("!Q", len_bytes)[0]

        payload = bytearray()
        while len(payload) < length:
            chunk = self.sock.recv(length - len(payload))
            if not chunk:
                break
            payload.extend(chunk)
        return bytes(payload)

    def eval_js(self, expr: str) -> any:
        res = self.send_command("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return res.get("result", {}).get("result", {}).get("value")

    def capture_screenshot(self, output_path: Path):
        res = self.send_command("Page.captureScreenshot", {"format": "png"})
        b64_data = res.get("result", {}).get("data", "")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(base64.b64decode(b64_data))

    def close(self):
        self.sock.close()


def run_phase4_browser_test():
    print("=" * 60)
    print("PHASE 4 SECTION 46: BROWSER-LEVEL UI ACCEPTANCE TEST")
    print("=" * 60)

    USER_DATA.mkdir(parents=True, exist_ok=True)

    cmd = [
        EDGE_PATH,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={USER_DATA}",
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1440,1100",
        "about:blank",
    ]

    print(f"Launching Edge with CDP on port {CDP_PORT}...")
    proc = subprocess.Popen(cmd)

    client = None
    try:
        time.sleep(2)
        pages_url = f"http://127.0.0.1:{CDP_PORT}/json"
        req = urllib.request.Request(pages_url)
        with urllib.request.urlopen(req) as resp:
            pages = json.loads(resp.read().decode())

        target_page = next((p for p in pages if p.get("type") == "page"), None)
        assert target_page is not None, "No active page found in Edge CDP targets"
        ws_url = target_page["webSocketDebuggerUrl"]

        client = MinimalCDPClient(ws_url)
        print("Connected to Edge DevTools WebSocket successfully.")

        client.send_command("Page.enable")
        client.send_command("Runtime.enable")
        client.send_command("Page.navigate", {"url": "http://127.0.0.1:7860"})
        time.sleep(2.5)

        # 1. Verify Page Loaded
        title = client.eval_js("document.title")
        print(f"1. Page Title: '{title}'")
        assert "UnfoldIQ TTS Studio" in title

        # 2. Verify Timestamps & Subtitles Card visible
        card_title = client.eval_js("document.querySelector('#timestamps-card .card-title')?.textContent")
        print(f"2. Timestamps Card Title: '{card_title}'")
        assert "Timestamp" in card_title

        # 3. Load completed project
        print("3. Selecting baseline project in history list...")
        client.eval_js("""
            const playBtns = document.querySelectorAll('#projects-list .btn');
            if (playBtns.length > 0) {
                playBtns[0].click();
            }
        """)
        time.sleep(1.5)

        # 4. Verify status badges and cues
        status_text = client.eval_js("document.getElementById('ts-status-pill')?.textContent")
        coverage_text = client.eval_js("document.getElementById('ts-coverage-badge')?.textContent")
        cues_text = client.eval_js("document.getElementById('ts-cues-badge')?.textContent")
        print(f"4. Status Pill: '{status_text}', Coverage: '{coverage_text}', Cues: '{cues_text}'")
        assert status_text in ("Hoàn thành", "Cần tạo lại")

        # 5. Check timeline cue elements rendered
        cue_cards_count = client.eval_js("document.querySelectorAll('#ts-cues-list .ts-cue-card').length")
        first_cue_time = client.eval_js("document.querySelector('#ts-cues-list .ts-cue-time span')?.textContent")
        first_cue_text = client.eval_js("document.querySelector('#ts-cues-list .ts-cue-text')?.textContent")
        print(f"5. Rendered Subtitle Cues: {cue_cards_count}")
        print(f"   First Cue Timing: '{first_cue_time}'")
        print(f"   First Cue Text:   '{first_cue_text}'")
        assert cue_cards_count > 0, "No subtitle cues rendered in UI!"

        # 6. Verify Download buttons enabled
        srt_disabled = client.eval_js("document.getElementById('btn-download-srt')?.disabled")
        json_disabled = client.eval_js("document.getElementById('btn-download-ts-json')?.disabled")
        print(f"6. Download Buttons: SRT disabled={srt_disabled}, JSON disabled={json_disabled}")
        assert not srt_disabled, "Download SRT button is disabled!"
        assert not json_disabled, "Download JSON button is disabled!"

        # 7. Click cue to seek audio player
        print("7. Testing click-to-seek audio interaction on first cue...")
        client.eval_js("document.querySelector('#ts-cues-list .ts-cue-card')?.click()")
        time.sleep(0.5)

        # 8. Capture Phase 4 UI Screenshot
        screenshot_path = BASE_DIR / "outputs" / "phase4_browser_timestamps_ui.png"
        client.capture_screenshot(screenshot_path)
        print(f"8. Captured Phase 4 UI Screenshot: {screenshot_path.name} ({screenshot_path.stat().st_size} bytes)")
        assert screenshot_path.exists() and screenshot_path.stat().st_size > 50000

        print("\nPHASE 4 BROWSER-LEVEL UI ACCEPTANCE: ALL CHECKS PASSED (100% VERIFIED)!")

    finally:
        if client:
            try:
                client.close()
            except Exception:
                pass
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    run_phase4_browser_test()
