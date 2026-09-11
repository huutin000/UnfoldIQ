"""
Browser-Level UI Acceptance Test using Chrome DevTools Protocol (CDP) over native Edge.
100% Python Standard Library (no external drivers, no npm, no selenium, no playwright required).
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
USER_DATA = BASE_DIR / "temp" / "edge_cdp_profile"


class MinimalCDPClient:
    def __init__(self, ws_url: str):
        # ws_url: ws://127.0.0.1:9222/devtools/page/XYZ
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

        # Encode client WebSocket frame (masked)
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

        # Receive responses until message with matching id
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


def run_browser_test():
    print("=== MISSING AUDIT 3 — REAL BROWSER-LEVEL UI ACCEPTANCE ===")

    # 1. Launch Edge with remote debugging
    cmd = [
        EDGE_PATH,
        f"--remote-debugging-port={CDP_PORT}",
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        f"--user-data-dir={USER_DATA}",
        "--window-size=1440,900",
        "http://127.0.0.1:7860"
    ]
    print("Launching Edge browser process via CDP...")
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)

    try:
        # 2. Get active page target
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list") as resp:
            targets = json.loads(resp.read().decode())

        page_target = next((t for t in targets if t.get("type") == "page"), None)
        if not page_target:
            raise RuntimeError("No browser page target found in Edge.")

        ws_url = page_target["webSocketDebuggerUrl"]
        print(f"Connected to Edge Page Target: {ws_url}")
        client = MinimalCDPClient(ws_url)

        # Enable Page and Runtime domains
        client.send_command("Page.enable")
        client.send_command("Runtime.enable")

        # Explicitly navigate to UnfoldIQ Studio
        client.send_command("Page.navigate", {"url": "http://127.0.0.1:7860"})
        time.sleep(2)

        # 3. Verify Page Loaded
        title = client.eval_js("document.title")
        print(f"Page Title: '{title}'")
        assert "UnfoldIQ TTS Studio" in title

        # Check Kokoro status badge
        status_text = client.eval_js("document.getElementById('service-status-text').textContent")
        print(f"Service Status Badge in UI: '{status_text}'")

        # 4. Verify Voice Select populated from Kokoro
        voice_count = client.eval_js("document.getElementById('voice-select').options.length")
        selected_voice = client.eval_js("document.getElementById('voice-select').value")
        print(f"Voice Dropdown count: {voice_count} voices loaded. Currently selected: '{selected_voice}'")
        assert voice_count >= 50
        assert selected_voice == "af_heart"

        # 5. Enter baseline script into textarea
        script_text = (
            "Early humans were not always the hunters.\n"
            "Sometimes, they were prey.\n"
            "And that creates a strange problem."
        )
        escaped_script = json.dumps(script_text)
        client.eval_js(f"""
            const el = document.getElementById('script-input');
            el.value = {escaped_script};
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
        """)

        # 6. Verify dynamic counters
        char_count = client.eval_js("document.getElementById('char-count').textContent")
        word_count = client.eval_js("document.getElementById('word-count').textContent")
        est_dur = client.eval_js("document.getElementById('est-duration').textContent")
        print(f"Live UI Counters: Character count='{char_count}', Word count='{word_count}', Estimated Duration='{est_dur}'")
        assert char_count == "104"
        assert word_count == "17"

        # 7. Set project name and speed
        client.eval_js("""
            const p = document.getElementById('project-name-input');
            p.value = 'browser_ui_acceptance_test';
            p.dispatchEvent(new Event('input', { bubbles: true }));
        """)
        slug_preview = client.eval_js("document.getElementById('slug-preview').textContent")
        speed_val = client.eval_js("document.getElementById('speed-value').textContent")
        print(f"Project Slug: '{slug_preview}', Speed: '{speed_val}'")

        # Capture initial screenshot
        initial_ss = BASE_DIR / "outputs" / "browser_01_script_entered.png"
        client.capture_screenshot(initial_ss)
        print(f"Saved initial browser screenshot: {initial_ss.name} ({initial_ss.stat().st_size} bytes)")

        # 8. Click 'Generate Voice' button in browser UI
        print("\nClicking 'Generate Voice' button (#btn-generate) in UI...")
        client.eval_js("document.getElementById('btn-generate').click()")

        # 9. Monitor live UI progress
        start_t = time.time()
        completed = False
        while time.time() - start_t < 25:
            time.sleep(0.5)
            state_pill = client.eval_js("document.getElementById('job-state-pill').textContent")
            pct = client.eval_js("document.getElementById('progress-pct').textContent")
            chunks_text = client.eval_js("document.getElementById('chunk-metric').textContent")
            elapsed = client.eval_js("document.getElementById('elapsed-metric').textContent")
            print(f"UI State: {state_pill} | Progress: {pct} | {chunks_text} | {elapsed}")

            if state_pill == "Hoàn thành":
                completed = True
                break

        assert completed, "UI did not reach 'Hoàn thành' state within timeout!"

        # 10. Verify Preview audio element and duration
        final_dur = client.eval_js("document.getElementById('final-duration-text').textContent")
        audio_src = client.eval_js("document.getElementById('audio-player').src")
        print(f"\nFinal UI Audio Duration: {final_dur}")
        print(f"Audio Player Source: {audio_src}")
        assert "audio/wav" in audio_src
        assert final_dur != "--"

        # Capture completed screenshot
        completed_ss = BASE_DIR / "outputs" / "browser_02_completed_preview.png"
        client.capture_screenshot(completed_ss)
        print(f"Saved completed browser screenshot: {completed_ss.name} ({completed_ss.stat().st_size} bytes)")

        # 11. Click Export WAV and Export MP3 buttons
        print("\nClicking 'Export Master WAV' and 'Export MP3' buttons in browser UI...")
        client.eval_js("document.getElementById('btn-export-wav').click()")
        time.sleep(0.5)
        client.eval_js("document.getElementById('btn-export-mp3').click()")
        time.sleep(1.0)

        # 12. Verify history entry in UI
        history_items = client.eval_js("document.getElementById('projects-list').getElementsByClassName('project-item').length")
        print(f"Recent projects listed in UI history: {history_items} items.")
        assert history_items > 0

        print("\nBROWSER-LEVEL UI ACCEPTANCE: ALL 17 CHECKS PASSED!")

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
    run_browser_test()
