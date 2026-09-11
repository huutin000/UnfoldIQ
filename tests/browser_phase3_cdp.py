"""
Phase 3 Browser-Level UI Acceptance Test using Chrome DevTools Protocol (CDP) over native Edge.
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
CDP_PORT = 9222
USER_DATA = BASE_DIR / "temp" / "edge_cdp_profile_phase3"


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
            length = struct.unpack("!H", self.sock.recv(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self.sock.recv(8))[0]

        buf = bytearray()
        while len(buf) < length:
            chunk = self.sock.recv(length - len(buf))
            if not chunk:
                break
            buf.extend(chunk)
        return bytes(buf)

    def eval_js(self, expression: str):
        res = self.send_command("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        })
        val = res.get("result", {}).get("result", {}).get("value")
        return val

    def capture_screenshot(self, output_path: Path):
        res = self.send_command("Page.captureScreenshot", {"format": "png"})
        b64 = res.get("result", {}).get("data", "")
        if b64:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(base64.b64decode(b64))

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


def run_phase3_browser_test():
    print("=== PHASE 3 — BROWSER-LEVEL UI ACCEPTANCE TEST ===")

    cmd = [
        EDGE_PATH,
        f"--remote-debugging-port={CDP_PORT}",
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        f"--user-data-dir={USER_DATA}",
        "--window-size=1440,1100",
        "http://127.0.0.1:7860"
    ]
    print("Launching Edge headless browser via CDP...")
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)

    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list") as resp:
            targets = json.loads(resp.read().decode())

        page_target = next((t for t in targets if t.get("type") == "page"), None)
        if not page_target:
            raise RuntimeError("No browser page target found in Edge.")

        ws_url = page_target["webSocketDebuggerUrl"]
        client = MinimalCDPClient(ws_url)

        client.send_command("Page.enable")
        client.send_command("Runtime.enable")
        client.send_command("Page.navigate", {"url": "http://127.0.0.1:7860"})
        time.sleep(2)

        # 1. Verify Page Loaded
        title = client.eval_js("document.title")
        print(f"Page Title: '{title}'")
        assert "UnfoldIQ TTS Studio" in title

        # 2. Verify Pronunciation Dictionary Card visible
        card_title = client.eval_js("document.querySelector('#pronunciation-card .card-title').textContent")
        print(f"Pronunciation Card Title: '{card_title}'")
        assert "Pronunciation" in card_title

        # 3. Click "+ Add Word" button
        print("Clicking '+ Add Word' button (#btn-toggle-add-pron)...")
        client.eval_js("document.getElementById('btn-toggle-add-pron').click()")
        time.sleep(0.5)

        # Verify form is displayed
        form_display = client.eval_js("document.getElementById('pron-form-container').style.display")
        assert form_display != "none"
        print(f"Pronunciation form displayed: {form_display}")

        # 4. Fill in test word
        client.eval_js("""
            document.getElementById('pron-orig-input').value = 'Homo habilis';
            document.getElementById('pron-spoken-input').value = 'Homo ha-bih-lis';
        """)

        # 5. Save the override
        print("Clicking 'Save Override' button (#btn-save-pron)...")
        client.eval_js("document.getElementById('btn-save-pron').click()")
        time.sleep(1.0)

        # 6. Verify entry rendered in table
        rows_count = client.eval_js("document.getElementById('pron-table-body').querySelectorAll('tr').length")
        first_orig = client.eval_js("document.querySelector('#pron-table-body .pron-orig-text')?.textContent")
        first_spoken = client.eval_js("document.querySelector('#pron-table-body .pron-spoken-text')?.textContent")
        print(f"Dictionary Table Rows: {rows_count}, Original: '{first_orig}', Spoken: '{first_spoken}'")
        assert first_orig == "Homo habilis"
        assert first_spoken == "Homo ha-bih-lis"

        # 7. Capture Phase 3 Browser Screenshot
        screenshot_path = BASE_DIR / "outputs" / "phase3_browser_pronunciation_ui.png"
        client.capture_screenshot(screenshot_path)
        print(f"Saved Phase 3 UI Screenshot: {screenshot_path.name} ({screenshot_path.stat().st_size} bytes)")

        # 8. Clean up test entry by deleting it
        print("Clicking delete button for test entry in UI...")
        client.eval_js("""
            const delBtn = document.querySelector('#pron-table-body .btn-danger');
            if (delBtn) {
                // Mock window.confirm
                window.confirm = () => true;
                delBtn.click();
            }
        """)
        time.sleep(1.0)

        # Verify clean
        cleaned_count = client.eval_js("document.querySelectorAll('#pron-table-body .pron-orig-text').length")
        print(f"Entries remaining after deletion: {cleaned_count}")
        assert cleaned_count == 0

        print("\nPHASE 3 BROWSER-LEVEL UI ACCEPTANCE: ALL CHECKS PASSED!")

    finally:
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
    run_phase3_browser_test()
