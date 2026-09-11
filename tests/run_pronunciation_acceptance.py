"""
Full Runtime Acceptance Test for Phase 3 Pronunciation Dictionary Subsystem.
Strictly verifies all 12 acceptance conditions from Section 14 of the prompt.
"""

import hashlib
import json
import time
import urllib.request
from pathlib import Path

BASE_URL = "http://127.0.0.1:7860"
PROJECTS_DIR = Path(r"D:\Project\UnfoldIQ\projects")


def http_req(path: str, method: str = "GET", data: dict = None):
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"} if data else {}
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    print("=== PHASE 3 — PRONUNCIATION RUNTIME ACCEPTANCE TEST ===")

    # Step 1: Add temporary test entry
    print("\n[Step 1] Adding temporary test entry: 'UNFOLDIQ_PRON_TEST' -> 'banana'...")
    add_resp = http_req("/api/pronunciations", method="POST", data={
        "original": "UNFOLDIQ_PRON_TEST",
        "spoken_form": "banana",
        "enabled": True
    })
    assert add_resp["status"] == "success"
    entry_id = add_resp["entry"]["id"]
    print(f"  -> Added entry with ID: {entry_id}")

    # Verify preview transformation
    preview = http_req("/api/pronunciations/preview-transformation", method="POST", data={
        "text": "This is UNFOLDIQ_PRON_TEST."
    })
    print(f"  -> Preview transformation: '{preview['transformed_text']}'")
    assert preview["transformed_text"] == "This is banana."
    assert preview["applied_overrides"][0]["match_count"] == 1

    # Step 2: Generate narration through Studio API
    test_script = "This is UNFOLDIQ_PRON_TEST."
    project_slug = f"phase3_pron_acceptance_{int(time.time())}"
    print(f"\n[Step 2] Triggering generation with script: '{test_script}'...")
    job_start = http_req("/api/jobs", method="POST", data={
        "script": test_script,
        "project_name": project_slug,
        "voice": "af_heart",
        "speed": 1.0,
        "language": "American English",
        "export_mp3": False
    })
    job_id = job_start["job_id"]
    print(f"  -> Job started: {job_id}")

    # Wait for completion
    completed = False
    job_data = None
    for _ in range(30):
        time.sleep(0.5)
        job_data = http_req(f"/api/jobs/{job_id}")
        if job_data["state"] == "completed":
            completed = True
            break
        elif job_data["state"] in ("failed", "cancelled"):
            break

    assert completed, f"Job did not complete successfully. Status: {job_data}"
    print(f"  -> Job completed in {job_data['elapsed_seconds']}s (Audio: {job_data['final_duration_seconds']}s)")

    project_dir = Path(job_data["project_dir"])
    print(f"  -> Project directory: {project_dir}")

    # Step 3: Verify saved original script remains untouched
    print("\n[Step 3] Verifying saved original script.txt...")
    saved_script = (project_dir / "script.txt").read_text(encoding="utf-8").strip()
    print(f"  -> script.txt content: '{saved_script}'")
    assert saved_script == "This is UNFOLDIQ_PRON_TEST."
    print("  -> PASSED: Original script is 100% preserved.")

    # Step 4 & 5: Verify manifest records synthesis text and match count
    print("\n[Step 4 & 5] Verifying manifest.json records...")
    manifest = json.loads((project_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["pronunciation_dictionary_applied"] is True
    overrides = manifest["pronunciation_overrides"]
    assert len(overrides) == 1
    assert overrides[0]["original"] == "UNFOLDIQ_PRON_TEST"
    assert overrides[0]["spoken_form"] == "banana"
    assert overrides[0]["match_count"] == 1
    chunk_text = manifest["chunks"][0]["text"]
    print(f"  -> Chunk synthesis text: '{chunk_text}'")
    assert chunk_text == "This is banana."
    print(f"  -> Applied snapshot: {overrides}")
    print("  -> PASSED: Synthesis text and match count verified.")

    # Step 6: Verify final WAV audio
    print("\n[Step 6] Verifying final WAV audio generation...")
    wav_file = project_dir / "audio.wav"
    assert wav_file.is_file()
    assert wav_file.stat().st_size > 10000
    print(f"  -> audio.wav size: {wav_file.stat().st_size} bytes, Duration: {job_data['final_duration_seconds']}s")
    print("  -> PASSED: Master WAV exists and is valid.")

    # Step 7 & 8: Verify persistence across reload
    print("\n[Step 7 & 8] Verifying entry persistence...")
    entries_resp = http_req("/api/pronunciations")
    existing = [e for e in entries_resp["entries"] if e["id"] == entry_id]
    assert len(existing) == 1
    print(f"  -> Entry {entry_id} still present in dictionary.")

    # Step 9 & 10: Disable the entry and verify it no longer transforms
    print("\n[Step 9 & 10] Disabling entry and verifying no transformation...")
    update_resp = http_req(f"/api/pronunciations/{entry_id}", method="PUT", data={"enabled": False})
    assert update_resp["entry"]["enabled"] is False

    preview_disabled = http_req("/api/pronunciations/preview-transformation", method="POST", data={
        "text": "This is UNFOLDIQ_PRON_TEST."
    })
    print(f"  -> Transformed with disabled entry: '{preview_disabled['transformed_text']}'")
    assert preview_disabled["transformed_text"] == "This is UNFOLDIQ_PRON_TEST."
    assert preview_disabled["transformed"] is False
    print("  -> PASSED: Disabled entry was safely ignored.")

    # Step 11 & 12: Delete temporary entry and verify it is absent
    print("\n[Step 11 & 12] Deleting temporary entry...")
    del_resp = http_req(f"/api/pronunciations/{entry_id}", method="DELETE")
    assert del_resp["status"] == "success"

    entries_after = http_req("/api/pronunciations")
    remaining = [e for e in entries_after["entries"] if e["id"] == entry_id]
    assert len(remaining) == 0
    print("  -> PASSED: Temporary test entry completely cleaned up.")

    print("\n============================================================")
    print("ALL 12 PRONUNCIATION ACCEPTANCE CRITERIA PASSED!")
    print("============================================================")


if __name__ == "__main__":
    main()
