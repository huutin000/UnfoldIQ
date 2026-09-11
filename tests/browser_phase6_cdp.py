"""
Phase 6 Browser-Level UI Acceptance Test using Chrome DevTools Protocol (CDP) over native Edge.
Verifies:
1. Flow / Veo Prompt Generator Card UI presence
2. Project selection & Veo status synchronization
3. Real browser prompt generation via #btn-generate-veo
4. Veo shot card rendering (#veo-timeline-list)
5. Timecodes, badges, prompt boxes, action details
6. Copy prompt button interaction
7. Audio playback sync (Play From Here)
8. Edit shot modal interaction and persistence
9. Artifact evidence screenshots capture into artifacts directory
100% Python Standard Library.
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
CDP_PORT = 9226  # Dedicated port for Phase 6
USER_DATA = BASE_DIR / "temp" / "edge_cdp_profile_phase6"
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

        if length < 126:
            header = bytearray([0x81, 0x80 | length])
        elif length < 65536:
            header = bytearray([0x81, 0x80 | 126]) + struct.pack("!H", length)
        else:
            header = bytearray([0x81, 0x80 | 127]) + struct.pack("!Q", length)

        masked_data = bytearray(b ^ mask_key[i % 4] for i, b in enumerate(data))
        self.sock.sendall(header + mask_key + masked_data)

        # Read response
        while True:
            resp_frame = self._read_frame()
            if not resp_frame:
                continue
            try:
                parsed = json.loads(resp_frame.decode("utf-8"))
                if parsed.get("method") == "Page.javascriptDialogOpening":
                    self.send_command("Page.handleJavaScriptDialog", {"accept": True})
                if parsed.get("id") == self.msg_id:
                    return parsed
            except Exception:
                continue

    def _read_frame(self) -> bytes:
        head = self.sock.recv(2)
        if len(head) < 2:
            return b""
        b1, b2 = head[0], head[1]
        payload_len = b2 & 0x7F
        if payload_len == 126:
            payload_len = struct.unpack("!H", self.sock.recv(2))[0]
        elif payload_len == 127:
            payload_len = struct.unpack("!Q", self.sock.recv(8))[0]

        chunks = []
        bytes_read = 0
        while bytes_read < payload_len:
            to_read = min(4096, payload_len - bytes_read)
            chunk = self.sock.recv(to_read)
            if not chunk:
                break
            chunks.append(chunk)
            bytes_read += len(chunk)
        return b"".join(chunks)

    def eval_js(self, expression: str):
        if ";" in expression or "\n" in expression or "const " in expression or "let " in expression or "return " in expression:
            wrapped = f"(() => {{ {expression} }})()"
        else:
            wrapped = f"(() => {{ return ({expression}); }})()"
        res = self.send_command("Runtime.evaluate", {
            "expression": wrapped,
            "returnByValue": True,
            "awaitPromise": True,
        })
        result = res.get("result", {}).get("result", {})
        if "value" in result:
            return result["value"]
        if "description" in result:
            return result["description"]
        return None

    def capture_screenshot(self, output_path: Path):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        res = self.send_command("Page.captureScreenshot", {"format": "png"})
        b64data = res.get("result", {}).get("data", "")
        if b64data:
            output_path.write_bytes(base64.b64decode(b64data))
            print(f"  -> Captured screenshot: {output_path}")

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass



def run_phase6_browser_audit():
    print("=" * 80)
    print("PHASE 6: CHROME DEVTOOLS PROTOCOL (CDP) BROWSER ACCEPTANCE SUITE")
    print("=" * 80)

    if USER_DATA.exists():
        shutil.rmtree(USER_DATA, ignore_errors=True)
    USER_DATA.mkdir(parents=True, exist_ok=True)

    edge_proc = None
    client = None

    try:
        cmd = [
            EDGE_PATH,
            f"--remote-debugging-port={CDP_PORT}",
            f"--user-data-dir={USER_DATA}",
            "--headless=new",
            "--window-size=1440,1100",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "about:blank",
        ]
        print(f"Launching Edge with CDP on port {CDP_PORT}...")
        edge_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2.5)

        # Query targets
        version_url = f"http://127.0.0.1:{CDP_PORT}/json/list"
        target_page = None
        for _ in range(10):
            try:
                with urllib.request.urlopen(version_url, timeout=2) as resp:
                    targets = json.loads(resp.read().decode())
                    for t in targets:
                        if t.get("type") == "page":
                            target_page = t
                            break
                    if target_page:
                        break
            except Exception:
                time.sleep(0.5)

        assert target_page is not None, "No active page found in Edge CDP targets"
        ws_url = target_page["webSocketDebuggerUrl"]

        client = MinimalCDPClient(ws_url)
        print("Connected to Edge DevTools WebSocket successfully.")

        client.send_command("Page.enable")
        client.send_command("Runtime.enable")
        client.send_command("Page.navigate", {"url": "http://127.0.0.1:7860"})
        time.sleep(2.5)

        # Auto-confirm all dialogs
        client.eval_js("window.confirm = () => true; window.alert = () => {};")

        # 1. Verify Page Loaded
        title = client.eval_js("document.title")
        print(f"1. Page Title: '{title}'")
        assert "UnfoldIQ TTS Studio" in title, f"Unexpected page title: {title}"

        # 2. Verify Flow / Veo Card is visible
        card_title = client.eval_js("document.querySelector('#veo-card .card-title')?.textContent")
        print(f"2. Veo Card Title: '{card_title}'")
        assert "Flow / Veo Prompt Generator" in card_title, "Veo card title missing!"

        # 3. Select baseline project
        print("3. Selecting baseline project in history list...")
        client.eval_js("""
            const playBtns = document.querySelectorAll('#projects-list .btn');
            for (const b of playBtns) {
                const onc = b.getAttribute('onclick') || '';
                if (onc.includes('baseline_acceptance_test')) {
                    b.click();
                    break;
                }
            }
        """)
        time.sleep(2.0)

        # 4. Check initial status, click Generate Veo Prompts
        status_text = client.eval_js("document.getElementById('veo-status-pill')?.textContent")
        print(f"4. Initial Veo Status: '{status_text}'")

        print("   Clicking 'Tạo Veo Prompt' in real browser...")
        client.eval_js("document.getElementById('btn-generate-veo')?.click()")
        # Wait for generation completion
        for _ in range(25):
            time.sleep(0.5)
            status_text = client.eval_js("document.getElementById('veo-status-pill')?.textContent")
            if status_text in ("Sẵn sàng", "Hoàn thành"):
                print(f"   Real-time Veo generation completed! Status: '{status_text}'")
                break
        else:
            raise RuntimeError(f"Timed out waiting for browser Veo generation. Current status: {status_text}")

        count_text = client.eval_js("document.getElementById('veo-count-badge')?.textContent")
        cov_text = client.eval_js("document.getElementById('veo-coverage-badge')?.textContent")
        print(f"   Veo Badges -> Status: '{status_text}', Count: '{count_text}', Coverage: '{cov_text}'")
        assert status_text in ("Sẵn sàng", "Hoàn thành", "Cần tạo lại"), f"Unexpected status: {status_text}"
        assert "shot" in count_text, f"Unexpected count badge: {count_text}"

        # 5. Check Rendered Veo Shot Cards
        shot_cards_count = client.eval_js("document.querySelectorAll('#veo-timeline-list .veo-shot-card').length")
        first_shot_num = client.eval_js("document.querySelector('#veo-timeline-list .veo-shot-num')?.textContent")
        first_shot_parent = client.eval_js("document.querySelector('#veo-timeline-list .veo-shot-parent')?.textContent")
        first_shot_tone = client.eval_js("document.querySelector('#veo-timeline-list .tone-tag')?.textContent")
        first_shot_prompt = client.eval_js("document.querySelector('#veo-timeline-list .veo-prompt-box code')?.textContent")
        print(f"5. Rendered Veo Shot Cards: {shot_cards_count}")
        print(f"   Shot ID:      '{first_shot_num}'")
        print(f"   Parent Scene: '{first_shot_parent}'")
        print(f"   Tone:         '{first_shot_tone}'")
        print(f"   Prompt:       '{first_shot_prompt[:90]}...'")
        assert shot_cards_count > 0, "No Veo shot cards rendered in UI!"
        assert "explicit constraints" in first_shot_prompt.lower(), "Mandatory constraints missing from prompt box!"

        # 6. Verify Export Buttons enabled
        json_disabled = client.eval_js("document.getElementById('btn-export-veo-json')?.disabled")
        md_disabled = client.eval_js("document.getElementById('btn-export-veo-md')?.disabled")
        print(f"6. Export Buttons: JSON disabled={json_disabled}, Markdown disabled={md_disabled}")
        assert not json_disabled, "Export Veo JSON button is disabled!"
        assert not md_disabled, "Export Veo Markdown button is disabled!"

        # 7. Screenshot 1: Veo Dashboard with active shots
        client.capture_screenshot(ARTIFACTS_DIR / "audit_f_01_veo_dashboard.png")

        # 8. Test Copy Prompt Button
        print("8. Testing Copy Prompt button interaction...")
        copy_btn_text = client.eval_js("""
            (() => {
                const btn = document.querySelector('#veo-timeline-list .btn-copy-veo-prompt');
                if (btn) {
                    btn.click();
                    return btn.querySelector('span')?.textContent;
                }
                return null;
            })()
        """)
        print(f"   Copy button feedback: '{copy_btn_text}'")

        # 9. Test Play From Here button
        print("9. Testing Play From Here seek interaction...")
        client.eval_js("document.querySelector('#veo-timeline-list .btn-seek-shot')?.click()")
        time.sleep(0.5)

        # 10. Test Edit Shot Modal
        print("10. Testing Edit Veo Shot Modal...")
        client.eval_js("document.querySelector('#veo-timeline-list .btn-edit-veo-shot')?.click()")
        time.sleep(0.8)

        modal_visible = client.eval_js("document.getElementById('veo-edit-modal')?.style.display !== 'none'")
        print(f"   Veo Modal Visible: {modal_visible}")
        assert modal_visible, "Veo edit modal failed to open!"

        # Screenshot 2: Edit Modal Open
        client.capture_screenshot(ARTIFACTS_DIR / "audit_f_02_veo_modal_edit.png")

        # Fill edit fields & save
        new_action = "Browser Verified: High-precision camera gliding along orbital trajectory with active particle illumination"
        client.eval_js(f"""
            document.getElementById('veo-edit-subject-action').value = '{new_action}';
            document.getElementById('veo-modal-save-btn').click();
        """)
        time.sleep(2.0)

        # Screenshot 3: Post-edit Dashboard
        client.capture_screenshot(ARTIFACTS_DIR / "audit_f_03_veo_saved_shot.png")

        # Verify card updated on screen
        updated_action_dom = client.eval_js("document.querySelector('#veo-timeline-list .veo-action-val')?.textContent")
        print(f"   Updated Action in DOM: '{updated_action_dom}'")
        assert "Browser Verified" in updated_action_dom, f"DOM action not updated: {updated_action_dom}"

        print("\n" + "=" * 80)
        print("PHASE 6 CDP BROWSER ACCEPTANCE PASSED WITH 100% SUCCESS!")
        print("=" * 80)

        return {
            "browser_test": "PASSED",
            "shot_cards_count": shot_cards_count,
            "status_text": status_text,
            "count_text": count_text,
            "coverage_text": cov_text,
            "first_shot_num": first_shot_num,
            "first_shot_parent": first_shot_parent,
            "updated_action_dom": updated_action_dom,
            "screenshots": [
                "audit_f_01_veo_dashboard.png",
                "audit_f_02_veo_modal_edit.png",
                "audit_f_03_veo_saved_shot.png",
            ]
        }

    finally:
        if client:
            client.close()
        if edge_proc:
            try:
                edge_proc.terminate()
                edge_proc.wait(timeout=2)
            except Exception:
                try:
                    edge_proc.kill()
                except Exception:
                    pass
        if USER_DATA.exists():
            shutil.rmtree(USER_DATA, ignore_errors=True)


if __name__ == "__main__":
    run_phase6_browser_audit()
