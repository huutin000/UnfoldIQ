"""
Phase 11 Browser-Level UI Acceptance (CDP over native Edge, stdlib only).

Phase A (blocked state): 6 sidebar stages, Production card in Veo workspace
with correct counts/blockers, blocked export shows exact error, blank state
clears Production card.
Phase B (ready state): READY badge, successful export via UI click, history
persists after reload.

Usage:
  python tests/browser_phase11_cdp.py --phase A
  python tests/browser_phase11_cdp.py --phase B
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
CDP_PORT = 9231
USER_DATA = BASE_DIR / "temp" / "edge_cdp_profile_phase11"
ARTIFACTS_DIR = BASE_DIR / "temp" / "phase11_browser"
PROJECT_ID = "2026-09-12_210003_youtube-narration-01"


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

    def _send_frame(self, data: bytes):
        mask_key = os.urandom(4)
        length = len(data)
        if length <= 125:
            header = struct.pack("!BB", 0x81, 0x80 | length)
        elif length <= 65535:
            header = struct.pack("!BBH", 0x81, 0x80 | 126, length)
        else:
            header = struct.pack("!BBQ", 0x81, 0x80 | 127, length)
        masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(data))
        self.sock.sendall(header + mask_key + masked)

    def _recv_frame(self) -> str:
        header = self.sock.recv(2)
        if len(header) < 2:
            raise RuntimeError("CDP connection closed")
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
        msg = {"id": self.msg_id, "method": method, "params": params or {}}
        data = json.dumps(msg).encode("utf-8")
        length = len(data)
        if length <= 125:
            header = struct.pack("!BB", 0x81, 0x80 | length)
        elif length <= 65535:
            header = struct.pack("!BBH", 0x81, 0x80 | 126, length)
        else:
            header = struct.pack("!BBQ", 0x81, 0x80 | 127, length)
        # client frames MUST be masked
        mask_key = os.urandom(4)
        masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(data))
        self.sock.sendall(header + mask_key + masked)
        while True:
            raw = self._recv_frame()
            try:
                obj = json.loads(raw)
            except Exception:
                continue
            if obj.get("id") == self.msg_id:
                return obj

    def eval_js(self, js: str):
        res = self.send_command("Runtime.evaluate", {
            "expression": js,
            "returnByValue": True,
            "awaitPromise": True,
        })
        return res.get("result", {}).get("result", {}).get("value")

    def capture_screenshot(self, output_path: Path):
        res = self.send_command("Page.captureScreenshot", {"format": "png"})
        b64 = res.get("result", {}).get("data")
        if b64:
            output_path.write_bytes(base64.b64decode(b64))
            print(f"  [Artifact] -> {output_path.name}")
        else:
            print(f"  [ERROR] screenshot failed for {output_path.name}")


def launch():
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    USER_DATA.mkdir(parents=True, exist_ok=True)
    cmd = [EDGE_PATH, f"--remote-debugging-port={CDP_PORT}",
           f"--user-data-dir={USER_DATA}", "--headless=new",
           "--disable-gpu", "--window-size=1440,900", "about:blank"]
    proc = subprocess.Popen(cmd)
    print(f"Launched headless Edge (CDP {CDP_PORT})...")
    time.sleep(2)
    req = urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=5)
    tabs = json.loads(req.read().decode())
    page_tab = next(t for t in tabs if t.get("type") == "page")
    return proc, MinimalCDPClient(page_tab["webSocketDebuggerUrl"])


def open_project_veo(client):
    client.eval_js(f"window.loadPreviewAudio('{PROJECT_ID}', 665, false);")
    time.sleep(2)
    client.eval_js("document.getElementById('nav-step-veo')?.click();")
    time.sleep(2)


def phase_a(client):
    print("\n[A1] Sidebar has exactly 6 stages (no 7th Production stage)...")
    navs = client.eval_js("""
        Array.from(document.querySelectorAll('#pipeline-sidebar .nav-item'))
            .filter(b => b.querySelector('.nav-step-num'))
            .map(b => b.textContent.replace(/\\s+/g, ' ').trim())
    """)
    print(f"  nav items: {navs}")
    assert len(navs) == 6, f"Expected 6 stages, got {len(navs)}"
    assert not any("sản xuất" in t.lower() or "production" in t.lower() for t in navs)
    print("  -> PASS")

    print("\n[A2] Production card in Veo workspace with correct counts...")
    open_project_veo(client)
    card = client.eval_js("""({
        badge: document.getElementById('prod-status-badge')?.textContent?.trim(),
        scenes: document.getElementById('prod-scene-count')?.textContent?.trim(),
        shots: document.getElementById('prod-shot-count')?.textContent?.trim(),
        blockers: document.getElementById('prod-blocker-count')?.textContent?.trim(),
        inVeo: !!document.querySelector('#inspector-veo #production-card')
    })""")
    print(f"  card: {card}")
    assert card["inVeo"] is True, "Production card must live inside #inspector-veo"
    assert card["scenes"] == "79", f"scene count: {card['scenes']}"
    assert card["shots"] == "141", f"shot count: {card['shots']}"
    assert int(card["blockers"]) >= 1, "expected >= 1 blocker (Voice QA FAIL)"
    client.capture_screenshot(ARTIFACTS_DIR / "phase11_A_blocked_card.png")
    print("  -> PASS")

    print("\n[A3] Blocked export click shows exact error...")
    client.eval_js("document.getElementById('btn-production-export')?.click();")
    time.sleep(1)
    result = client.eval_js("""({
        visible: document.getElementById('prod-result')?.style?.display !== 'none',
        text: document.getElementById('prod-result')?.textContent?.slice(0, 400)
    })""")
    print(f"  result box: {result}")
    assert result["visible"] is True
    assert "Không thể xuất gói sản xuất" in result["text"], result["text"]
    assert "Voice QA" in result["text"], result["text"]
    print("  -> PASS")

    print("\n[A4] Blank state clears Production card (no leakage)...")
    client.eval_js("""
        if (window.resetWorkstationToCleanState) window.resetWorkstationToCleanState();
    """)
    time.sleep(1)
    blank = client.eval_js("""({
        badge: document.getElementById('prod-status-badge')?.textContent?.trim(),
        scenes: document.getElementById('prod-scene-count')?.textContent?.trim(),
        shots: document.getElementById('prod-shot-count')?.textContent?.trim(),
        blockers: document.getElementById('prod-blocker-count')?.textContent?.trim(),
        history: document.getElementById('prod-history-list')?.textContent?.trim()?.slice(0, 120),
        exportDisabled: document.getElementById('btn-production-export')?.disabled,
        cardLeaksProject: (document.getElementById('production-card')?.innerHTML || '').includes('""" + PROJECT_ID + """')
    })""")
    print(f"  blank: {blank}")
    assert blank["scenes"] == "0" and blank["shots"] == "0" and blank["blockers"] == "0"
    assert blank["cardLeaksProject"] is False, "production card leaked previous project path/status"
    assert blank["exportDisabled"] is True, "export button must be disabled with no project"
    print("  -> PASS")


def phase_b(client):
    print("\n[B1] READY badge after QA acceptance...")
    open_project_veo(client)
    card = client.eval_js("""({
        badge: document.getElementById('prod-status-badge')?.textContent?.trim(),
        scenes: document.getElementById('prod-scene-count')?.textContent?.trim(),
        shots: document.getElementById('prod-shot-count')?.textContent?.trim(),
        blockers: document.getElementById('prod-blocker-count')?.textContent?.trim()
    })""")
    print(f"  card: {card}")
    assert card["badge"] == "SẴN SÀNG SẢN XUẤT", card
    assert card["scenes"] == "79" and card["shots"] == "141"
    assert card["blockers"] == "0", card
    print("  -> PASS")

    print("\n[B2] Click export -> success box...")
    client.eval_js("document.getElementById('btn-production-export')?.click();")
    for _ in range(60):
        time.sleep(1)
        done = client.eval_js("""({
            visible: document.getElementById('prod-result')?.style?.display !== 'none',
            text: document.getElementById('prod-result')?.textContent?.slice(0, 400),
            btn: document.getElementById('btn-production-export')?.querySelector('span')?.textContent
        })""")
        if done["visible"] and done["btn"] == "Xuất gói sản xuất":
            break
    print(f"  result: {done}")
    assert done["visible"] is True
    assert "Xuất gói sản xuất thành công" in done["text"], done["text"]
    assert "79" in done["text"] and "141" in done["text"]
    client.capture_screenshot(ARTIFACTS_DIR / "phase11_B_success.png")
    print("  -> PASS")

    print("\n[B3] History persists after reload...")
    client.send_command("Page.navigate", {"url": "http://127.0.0.1:7860"})
    time.sleep(2)
    open_project_veo(client)
    hist = client.eval_js(
        "document.getElementById('prod-history-list')?.textContent?.slice(0, 300)")
    print(f"  history: {hist}")
    assert "export_001" in hist, hist
    client.capture_screenshot(ARTIFACTS_DIR / "phase11_B_history.png")
    print("  -> PASS")


def main():
    phase = sys.argv[sys.argv.index("--phase") + 1] if "--phase" in sys.argv else "A"
    print("================================================================================")
    print(f"PHASE 11 BROWSER ACCEPTANCE — PHASE {phase}")
    print("================================================================================")
    proc, client = launch()
    try:
        client.send_command("Page.navigate", {"url": "http://127.0.0.1:7860"})
        time.sleep(2)
        if phase.upper() == "A":
            phase_a(client)
        else:
            phase_b(client)
        print("\nALL BROWSER CHECKS PASSED (phase %s)." % phase.upper())
    finally:
        try:
            client.sock.close()
        except Exception:
            pass
        proc.terminate()


if __name__ == "__main__":
    main()
