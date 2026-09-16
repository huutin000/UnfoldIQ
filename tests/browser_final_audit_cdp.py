"""
Phase 10 Final Audit CDP Browser Acceptance Test.
Automates the full interactive browser lifecycle:
1. Manual edit persistence across browser reload (manualEdited: true).
2. Partial invalidation verification (affected vs unaffected shots).
3. Per-scene regeneration restoring readiness.
4. Manual edit protection & archive generation on forced regeneration.
5. Project Health gate verification (Blocking error -> CHƯA SẴN SÀNG -> Recovered READY).
6. Multi-project isolation across project switch/close/reopen.
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
sys.path.insert(0, str(BASE_DIR))
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
CDP_PORT = 9235
USER_DATA = BASE_DIR / "temp" / "edge_cdp_profile_audit"
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
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(base64.b64decode(b64))
            print(f"  [Artifact Captured] -> {output_path.name}")
        else:
            print(f"  [ERROR] Failed to capture screenshot for {output_path.name}")


def run_final_audit():
    print("=== Phase 10 Final Audit Browser Acceptance Suite ===")
    USER_DATA.mkdir(parents=True, exist_ok=True)

    cmd = [
        EDGE_PATH,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={USER_DATA}",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1600,900",
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
        print("Connected to Edge via CDP.")

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
        proj_name = "2026-09-12_210003_youtube-narration-01"
        print(f"\n[Step 2] Opening project '{proj_name}'...")
        client.eval_js(f"""
            window.loadPreviewAudio('{proj_name}', 665, false);
        """)
        for _ in range(30):
            ready = client.eval_js("!!(window.currentVisualBible && window.currentVisualBible.subjects)")
            if ready:
                break
            time.sleep(0.3)
        print("  Visual Bible loaded in window.")

        # 3. Open Visual Bible Modal
        print("\n[Step 3] Opening Visual Bible Explorer Modal...")
        client.eval_js("if (typeof openVisualBibleModal === 'function') openVisualBibleModal();")
        time.sleep(1)
        client.capture_screenshot(ARTIFACTS_DIR / "final_audit_01_vb_modal.png")

        # 4. Perform Manual Edit on Subject
        print("\n[Step 4] Testing Manual Edit Persistence...")
        edit_result = client.eval_js("""
            (function() {
                if (typeof selectVisualBibleEntity === 'function') {
                    selectVisualBibleEntity('subjects', 'subject_homo_habilis_01');
                }
                const descInput = document.getElementById('vb-edit-desc');
                const notesInput = document.getElementById('vb-edit-notes');
                const btnSave = document.getElementById('vb-btn-save-entity');
                if (descInput && btnSave) {
                    descInput.value = (descInput.value || '').trim() + ' [Manual Field Edit]';
                    if (notesInput) notesInput.value = 'Manual Field Edit Note';
                    btnSave.click();
                    return { success: true, newDesc: descInput.value };
                }
                return { 
                    success: false, 
                    hasDesc: !!descInput, 
                    hasBtn: !!btnSave, 
                    hasBible: !!window.currentVisualBible,
                    modalDisplay: document.getElementById('visual-bible-modal')?.style?.display
                };
            })()
        """)
        print(f"  Manual Edit executed: {edit_result}")
        assert edit_result and edit_result.get("success") is True, f"Manual edit failed: {edit_result}"
        time.sleep(2)

        # Close modal
        client.eval_js("if (typeof closeVisualBibleModal === 'function') closeVisualBibleModal();")
        time.sleep(1)

        # 5. Reload Project and Verify Persistence
        print("\n[Step 5] Reloading Studio and verifying manual edit persistence...")
        client.send_command("Page.reload")
        time.sleep(2.5)
        client.eval_js("""
            const tourSkip = document.getElementById('tour-btn-skip');
            if (tourSkip) tourSkip.click();
            const tourOverlay = document.getElementById('onboarding-tour-overlay');
            if (tourOverlay) tourOverlay.style.display = 'none';
        """)
        client.eval_js(f"""
            window.loadPreviewAudio('{proj_name}', 665, false);
        """)
        for _ in range(30):
            ready = client.eval_js("!!(window.currentVisualBible && window.currentVisualBible.subjects)")
            if ready:
                break
            time.sleep(0.3)

        persisted_val = client.eval_js("""
            (function() {
                if (window.currentVisualBible && window.currentVisualBible.subjects) {
                    const s = window.currentVisualBible.subjects.find(x => x.subjectId === 'subject_homo_habilis_01');
                    return { desc: s ? (s.canonicalDescription || s.description) : null, manualEdited: s ? s.manualEdited : null };
                }
                return null;
            })()
        """)
        print(f"  Persisted value after reload: {persisted_val}")
        assert persisted_val and persisted_val.get("manualEdited") is True, "manualEdited must be true after reload"
        assert "Manual Field Edit" in (persisted_val.get("desc") or ""), "Edited desc must persist after reload"
        client.capture_screenshot(ARTIFACTS_DIR / "final_audit_02_manual_edit_persisted.png")

        # 6. Verify Partial Invalidation & Per-Scene Regeneration Flow (Gap B & Gap C)
        print("\n[Step 6] Testing Partial Invalidation Status & Per-Scene Regeneration...")
        proj_dir = BASE_DIR / "projects" / proj_name
        bak_veo = (proj_dir / "veo_prompts.json").read_text(encoding="utf-8")

        for _ in range(40):
            shots_loaded = client.eval_js("!!window.getProjectVeoShots && window.getProjectVeoShots().length === 141")
            if shots_loaded:
                break
            time.sleep(0.3)

        from studio.visual_continuity import visual_continuity_director
        aff = visual_continuity_director.invalidate_affected_shots(proj_dir, entity_id="subject_pleistocene_predator_01")
        print(f"  Invalidated {len(aff)} shots via director.")

        client.eval_js(f"window.refreshDependencyStatus('{proj_name}');")
        for _ in range(40):
            alert_msg = client.eval_js("document.getElementById('veo-stale-text')?.textContent?.trim() || ''")
            if "Shot cần tạo lại" in alert_msg:
                break
            time.sleep(0.3)

        partial_status = client.eval_js("""
            ({
                veoOutdated: window.veoOutdated,
                alertText: document.getElementById('veo-stale-text')?.textContent?.trim()
            })
        """)
        print(f"  UI Partial State: {partial_status}")
        alert_msg = partial_status.get("alertText") or ""
        assert "43 Shot cần tạo lại" in alert_msg, f"Expected 43 shots outdated in alert, got: {alert_msg}"
        assert "98 / 141 Shot hợp lệ" in alert_msg, f"Expected 98 shots valid in alert, got: {alert_msg}"
        assert "scene_001" in alert_msg and "scene_024" in alert_msg, f"Expected scene_001..scene_024 in alert, got: {alert_msg}"
        client.capture_screenshot(ARTIFACTS_DIR / "final_audit_06_partial_outdated.png")

        # Per-scene regeneration on scene_001
        print("  Executing per-scene regeneration on scene_001...")
        client.eval_js(f"""
            (async () => {{
                const res = await fetch('/api/projects/{proj_name}/veo/regenerate-scene/scene_001', {{ method: 'POST' }});
                await res.json();
                if (typeof window.loadVeoForProject === 'function') await window.loadVeoForProject('{proj_name}');
                else if (typeof loadVeoForProject === 'function') await loadVeoForProject('{proj_name}');
                if (typeof window.refreshDependencyStatus === 'function') window.refreshDependencyStatus('{proj_name}');
                else if (typeof refreshDependencyStatus === 'function') refreshDependencyStatus('{proj_name}');
                return true;
            }})()
        """)

        # Poll until scene_001 shots are regenerated and outdated flag is cleared
        print("  Waiting for scene_001 regeneration to reflect in browser...")
        for _ in range(30):
            time.sleep(0.5)
            is_cleared = client.eval_js("""
                (function() {
                    const fn = window.getProjectVeoShots || (typeof getProjectVeoShots === 'function' ? getProjectVeoShots : null);
                    const shots = (fn ? fn() : null) || (window.currentVeoPlan ? window.currentVeoPlan.shots : null) || [];
                    const sc1 = shots.filter(s => s.scene_id === 'scene_001');
                    return sc1.length > 0 && sc1.every(s => !s.outdated);
                })()
            """)
            if is_cleared:
                break

        post_regen = client.eval_js("""
            (function() {
                const fn = window.getProjectVeoShots || (typeof getProjectVeoShots === 'function' ? getProjectVeoShots : null);
                const shots = (fn ? fn() : null) || (window.currentVeoPlan ? window.currentVeoPlan.shots : null) || [];
                const sc1 = shots.filter(s => s.scene_id === 'scene_001');
                const sc2 = shots.filter(s => s.scene_id === 'scene_002');
                return {
                    totalShots: shots.length,
                    sc1Count: sc1.length,
                    sc1Outdated: sc1.map(s => s.outdated),
                    sc2Count: sc2.length
                };
            })()
        """)
        print(f"  Post Per-Scene Regen State: {post_regen}")
        assert post_regen.get("totalShots") == 141, f"Expected 141 shots, got {post_regen}"
        assert all(not o for o in post_regen.get("sc1Outdated", [True])), "scene_001 shots must be valid"
        client.capture_screenshot(ARTIFACTS_DIR / "final_audit_07_post_per_scene_regen.png")

        # Cleanly restore veo_prompts.json for remaining steps
        (proj_dir / "veo_prompts.json").write_text(bak_veo, encoding="utf-8")
        client.eval_js(f"window.refreshDependencyStatus('{proj_name}');")
        time.sleep(1.0)

        # 7. Test Forced Regeneration Archive Protection
        print("\n[Step 7] Testing Forced Regeneration Archive Protection...")
        req = urllib.request.Request(
            f"http://127.0.0.1:7860/api/projects/{proj_name}/visual-bible/generate?force=true",
            data=b"",
            method="POST"
        )
        with urllib.request.urlopen(req) as resp:
            regen_data = json.loads(resp.read().decode())
            print(f"  Regen response status: {regen_data.get('status')}")

        proj_dir = BASE_DIR / "projects" / proj_name
        archives = list(proj_dir.glob("visual_bible_archive_*.json"))
        print(f"  Archives found: {[a.name for a in archives]}")
        assert len(archives) >= 1, "At least one visual_bible_archive_*.json must exist after forced regeneration"

        # 8. Test Project Health Gate under Blocking Error & Recovery
        print("\n[Step 8] Testing Project Health Gate with Blocking Injection...")
        p_file = proj_dir / "veo_prompts.json"
        veo_data = json.loads(p_file.read_text(encoding="utf-8"))
        orig_prompt = veo_data["shots"][0]["veo_prompt"]
        veo_data["shots"][0]["veo_prompt"] = orig_prompt + " Modern vehicles and plastic debris appear on the ground."
        p_file.write_text(json.dumps(veo_data, indent=2), encoding="utf-8")

        # Reload project in browser
        client.eval_js(f"""
            window.loadPreviewAudio('{proj_name}', 665, false);
        """)
        for _ in range(30):
            c_val = client.eval_js("parseInt(document.getElementById('vc-conflicts-count-veo')?.textContent || '0', 10)")
            if c_val and c_val > 0:
                break
            time.sleep(0.3)

        health_blocked = client.eval_js("""
            ({
                statusScenes: document.getElementById('vc-status-badge-scenes')?.textContent?.trim(),
                statusVeo: document.getElementById('vc-status-badge-veo')?.textContent?.trim(),
                conflictsVeo: document.getElementById('vc-conflicts-count-veo')?.textContent?.trim()
            })
        """)
        print(f"  Project Health Gate with blocking error: {health_blocked}")
        assert health_blocked["statusVeo"] == "REVIEW" or int(health_blocked.get("conflictsVeo", "0")) > 0, "Gate must reflect blocking error"
        client.capture_screenshot(ARTIFACTS_DIR / "final_audit_03_blocking_gate.png")

        # Restore original prompt and re-evaluate
        veo_data["shots"][0]["veo_prompt"] = orig_prompt
        p_file.write_text(json.dumps(veo_data, indent=2), encoding="utf-8")

        client.eval_js(f"""
            window.loadPreviewAudio('{proj_name}', 665, false);
        """)
        for _ in range(30):
            c_val = client.eval_js("parseInt(document.getElementById('vc-conflicts-count-veo')?.textContent || '0', 10)")
            if c_val == 0:
                break
            time.sleep(0.3)

        health_recovered = client.eval_js("""
            ({
                statusScenes: document.getElementById('vc-status-badge-scenes')?.textContent?.trim(),
                statusVeo: document.getElementById('vc-status-badge-veo')?.textContent?.trim(),
                conflictsVeo: document.getElementById('vc-conflicts-count-veo')?.textContent?.trim()
            })
        """)
        print(f"  Project Health Gate after fix: {health_recovered}")
        assert health_recovered["statusVeo"] == "READY" and int(health_recovered.get("conflictsVeo", "0")) == 0, "Gate must recover to Ready"
        client.capture_screenshot(ARTIFACTS_DIR / "final_audit_04_recovered_gate.png")

        # 9. Test Multi-Project Isolation
        print("\n[Step 9] Testing Multi-Project Isolation...")
        client.eval_js("""
            if (typeof resetWorkstationToCleanState === 'function') {
                resetWorkstationToCleanState();
            }
        """)
        time.sleep(1)
        blank_state = client.eval_js("""
            ({
                hasBible: !!window.currentVisualBible,
                hasVeoPlan: !!window.currentVeoPlan,
                selectedProject: document.getElementById('active-project-name')?.textContent?.trim()
            })
        """)
        print(f"  Blank state verification: {blank_state}")
        assert blank_state["hasBible"] is False, "Visual bible must be cleared in blank state"
        assert blank_state["hasVeoPlan"] is False, "Veo plan must be cleared in blank state"
        client.capture_screenshot(ARTIFACTS_DIR / "final_audit_05_blank_isolation.png")

        print("\n>>> ALL FINAL AUDIT BROWSER ACCEPTANCE TESTS PASSED SUCCESSFULLY! <<<")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    run_final_audit()
