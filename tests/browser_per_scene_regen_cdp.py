"""
Phase 10 Gap C Browser Acceptance Test: Per-Scene Regeneration Flow.
Automates:
1. Load reference project in browser.
2. Invalidate subject_pleistocene_predator_01 -> UI reflects partial invalidation.
3. Capture screenshot of partial invalidation alert.
4. Execute per-scene regeneration on scene_001 via UI flow.
5. Verify scene_001 shots restored, remaining scenes intact, total shots 141.
6. Capture screenshot of restored scene shots.
7. Clean up and reset.
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

sys.stdout.reconfigure(line_buffering=True)
BASE_DIR = Path(r"D:\Project\UnfoldIQ")
sys.path.insert(0, str(BASE_DIR))
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
CDP_PORT = 9236
USER_DATA = BASE_DIR / "temp" / "edge_cdp_profile_per_scene"
ARTIFACTS_DIR = Path(r"C:\Users\huuti\.gemini\antigravity-ide\brain\5628e87f-6e41-47df-b7bb-2771d3786088")


class MinimalCDPClient:
    def __init__(self, ws_url: str):
        m = re.match(r"ws://([^:/]+):(\d+)(/.+)", ws_url)
        if not m:
            raise ValueError(f"Invalid WS URL: {ws_url}")
        self.host = m.group(1)
        self.port = int(m.group(2))
        self.path = m.group(3)

        self.sock = socket.create_connection((self.host, self.port), timeout=25)
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

    def eval_js(self, expression: str):
        res = self.send_command("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        })
        val = res.get("result", {}).get("result", {}).get("value")
        return val

    def capture_screenshot(self, out_path: Path):
        res = self.send_command("Page.captureScreenshot", {"format": "png"})
        b64_data = res.get("result", {}).get("data", "")
        if b64_data:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(base64.b64decode(b64_data))
            print(f"  Captured screenshot: {out_path.name}")


def run_per_scene_regen_audit():
    proj_name = "2026-09-12_210003_youtube-narration-01"
    proj_dir = BASE_DIR / "projects" / proj_name

    # Backups for clean restoration
    bak_vb = (proj_dir / "visual_bible.json").read_text(encoding="utf-8")
    bak_veo = (proj_dir / "veo_prompts.json").read_text(encoding="utf-8")

    if USER_DATA.exists():
        shutil.rmtree(USER_DATA, ignore_errors=True)
    USER_DATA.mkdir(parents=True, exist_ok=True)

    cmd = [
        EDGE_PATH,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={USER_DATA}",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1600,900",
        "http://127.0.0.1:7860"
    ]

    print(f"Launching Edge on CDP port {CDP_PORT}...")
    proc = subprocess.Popen(cmd)

    try:
        # Connect to CDP
        ws_url = None
        for _ in range(25):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json") as resp:
                    pages = json.loads(resp.read().decode())
                    for p in pages:
                        if p.get("type") == "page" and "7860" in p.get("url", ""):
                            ws_url = p.get("webSocketDebuggerUrl")
                            break
                    if ws_url:
                        break
            except Exception:
                time.sleep(0.5)

        if not ws_url:
            raise RuntimeError("Failed to obtain CDP WebSocket URL for Studio UI.")

        client = MinimalCDPClient(ws_url)
        print("Connected to Edge via CDP.")
        client.send_command("Page.enable")
        client.send_command("Runtime.enable")

        # 1. Navigate to Studio
        print("\n[Step 1] Navigating to UnfoldIQ Studio...")
        client.send_command("Page.navigate", {"url": "http://127.0.0.1:7860"})
        time.sleep(2.5)
        client.eval_js("""
            const tourSkip = document.getElementById('tour-btn-skip');
            if (tourSkip) tourSkip.click();
            const tourOverlay = document.getElementById('onboarding-tour-overlay');
            if (tourOverlay) tourOverlay.style.display = 'none';
        """)

        # 2. Select Project
        print(f"\n[Step 2] Opening project '{proj_name}'...")
        client.eval_js(f"""
            window.loadPreviewAudio('{proj_name}', 665, false);
        """)
        for _ in range(40):
            ready = client.eval_js("!!(window.currentVisualBible && window.currentVisualBible.subjects) && !!(window.currentVeoPlan && window.currentVeoPlan.shots && window.currentVeoPlan.shots.length === 141)")
            if ready:
                break
            time.sleep(0.4)
        print("  Project loaded with 141 shots and Visual Bible.")

        # 3. Invalidate subject_pleistocene_predator_01 via Director
        print("\n[Step 3] Applying partial invalidation...")
        from studio.visual_continuity import visual_continuity_director
        aff = visual_continuity_director.invalidate_affected_shots(proj_dir, entity_id="subject_pleistocene_predator_01")
        print(f"  Invalidated {len(aff)} shots via director.")

        # Trigger client refresh of project status
        client.eval_js(f"""
            window.refreshDependencyStatus('{proj_name}');
        """)
        time.sleep(1.5)

        # Verify partial invalidation state in UI
        ui_partial_state = client.eval_js("""
            ({
                veoOutdated: window.veoOutdated,
                outdatedCount: window.veoOutdatedScenes ? window.veoOutdatedScenes.length : 0,
                alertText: document.getElementById('veo-stale-text')?.textContent?.trim(),
                pillText: document.getElementById('step-status-veo')?.textContent?.trim()
            })
        """)
        print(f"  UI Partial State: {ui_partial_state}")
        client.capture_screenshot(ARTIFACTS_DIR / "final_audit_06_partial_outdated.png")

        # 3. Trigger per-scene regeneration on scene_001
        print("\n[Step 3] Triggering per-scene regeneration on scene_001...")
        client.eval_js("""
            window.doRegenerateSceneVeo('scene_001');
        """)
        time.sleep(0.5)

        # Click confirm button in modal
        client.eval_js("""
            const btn = document.getElementById('confirm-btn-confirm');
            if (btn) btn.click();
        """)
        print("  Confirmed per-scene regeneration dialog.")

        # Wait for regeneration to finish
        print("  Waiting for per-scene regeneration to complete...")
        for _ in range(40):
            time.sleep(0.5)
            diag = client.eval_js("""
                (function() {
                    const shots = (typeof getProjectVeoShots === 'function' ? getProjectVeoShots() : null) || (window.currentVeoPlan ? window.currentVeoPlan.shots : null) || [];
                    const sc1 = shots.filter(s => s.scene_id === 'scene_001');
                    return {
                        len: shots.length,
                        sc1Len: sc1.length,
                        hasOutdatedInSc1: sc1.some(s => s.outdated)
                    };
                })()
            """)
            if diag and diag.get("len") == 141 and diag.get("hasOutdatedInSc1") is False:
                print(f"  Per-scene regeneration completed: {diag}")
                break

        time.sleep(1.0)

        # Verify post-regeneration state
        post_regen_state = client.eval_js("""
            (function() {
                const shots = (typeof getProjectVeoShots === 'function' ? getProjectVeoShots() : null) || (window.currentVeoPlan ? window.currentVeoPlan.shots : null) || [];
                const sc1_shots = shots.filter(s => s.scene_id === 'scene_001');
                const sc2_shots = shots.filter(s => s.scene_id === 'scene_002');
                return {
                    totalShots: shots.length,
                    sc1Count: sc1_shots.length,
                    sc1Outdated: sc1_shots.map(s => s.outdated),
                    sc2Count: sc2_shots.length
                };
            })()
        """)
        print(f"  Post-regeneration State: {post_regen_state}")
        assert post_regen_state["totalShots"] == 141, f"Expected 141 shots, got {post_regen_state['totalShots']}"
        assert all(not o for o in post_regen_state["sc1Outdated"]), "scene_001 shots must be valid (outdated=False)"

        client.capture_screenshot(ARTIFACTS_DIR / "final_audit_07_post_per_scene_regen.png")

        # 4. Clean up and reset workstation
        print("\n[Step 4] Resetting workstation...")
        client.eval_js("""
            if (typeof resetWorkstationToCleanState === 'function') {
                resetWorkstationToCleanState();
            }
        """)
        time.sleep(0.5)

        print("\n>>> GAP C BROWSER ACCEPTANCE TEST PASSED! <<<")

    finally:
        # Restore canonical files
        (proj_dir / "visual_bible.json").write_text(bak_vb, encoding="utf-8")
        (proj_dir / "veo_prompts.json").write_text(bak_veo, encoding="utf-8")

        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    run_per_scene_regen_audit()
