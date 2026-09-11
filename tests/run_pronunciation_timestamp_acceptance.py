"""
Section 41 Acceptance Test:
Pronunciation-Override Alignment Acceptance Test.
1. Creates temporary pronunciation override: UNFOLDIQ_PRON_TEST -> banana
2. Generates TTS audio for 'This is UNFOLDIQ_PRON_TEST.'
3. Generates timestamps via Phase 4 pipeline.
4. Verifies timestamps.srt contains 'This is UNFOLDIQ_PRON_TEST.' and NOT 'banana'.
5. Verifies transcription_raw.json contains 'banana'.
6. Verifies alignment coverage and valid time ranges.
7. Deletes temporary pronunciation override.
"""

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STUDIO_URL = "http://127.0.0.1:7860"


def http_post(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_get(url: str) -> dict:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_delete(url: str) -> dict:
    req = urllib.request.Request(url, method="DELETE")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def run_acceptance():
    print("=" * 60)
    print("PHASE 4 SECTION 41: PRONUNCIATION-OVERRIDE ACCEPTANCE TEST")
    print("=" * 60)

    # 1. Create temporary pronunciation entry
    print("\n1. Creating temporary pronunciation override: 'UNFOLDIQ_PRON_TEST' -> 'banana'...")
    add_resp = http_post(f"{STUDIO_URL}/api/pronunciations", {
        "original": "UNFOLDIQ_PRON_TEST",
        "spoken_form": "banana",
        "enabled": True
    })
    entry_id = add_resp.get("entry", {}).get("id") or add_resp.get("id")
    print(f"  -> Created entry ID: {entry_id}")

    project_dir = None
    try:
        # 2. Generate narration audio via TTS
        print("\n2. Submitting TTS narration job for 'This is UNFOLDIQ_PRON_TEST.'...")
        job_resp = http_post(f"{STUDIO_URL}/api/jobs", {
            "script": "This is UNFOLDIQ_PRON_TEST.",
            "project_name": "phase4_pron_override_test",
            "voice": "af_heart",
            "speed": 1.0,
            "export_mp3": False
        })
        job_id = job_resp["job_id"]
        print(f"  -> Job started: {job_id}. Waiting for completion...")

        # Poll job completion
        for _ in range(30):
            time.sleep(0.5)
            status = http_get(f"{STUDIO_URL}/api/jobs/{job_id}")
            if status["state"] in ("completed", "failed", "cancelled"):
                break

        print(f"  -> TTS Job State: {status['state']}, Duration: {status.get('final_duration_seconds')}s")
        assert status["state"] == "completed", f"TTS job failed: {status.get('error_message')}"
        project_name = status["project_name"]
        project_dir = BASE_DIR / "projects" / project_name
        print(f"  -> Project created at: {project_name}")

        # Verify script.txt contains exact phrase
        script_text = (project_dir / "script.txt").read_text(encoding="utf-8").strip()
        print(f"  -> script.txt content: '{script_text}'")
        assert script_text == "This is UNFOLDIQ_PRON_TEST."

        # Verify manifest.json records override
        manifest = json.loads((project_dir / "manifest.json").read_text(encoding="utf-8"))
        print(f"  -> manifest chunks text: '{manifest['chunks'][0]['text']}'")
        assert "banana" in manifest["chunks"][0]["text"], "Spoken form 'banana' was not synthesized!"

        # 3. Generate Timestamps via Phase 4 pipeline
        print("\n3. Triggering Phase 4 timestamp generation...")
        ts_start = http_post(f"{STUDIO_URL}/api/projects/{project_name}/timestamps", {})
        print(f"  -> Timestamp worker spawned: {ts_start.get('job', {}).get('state')}")

        # Poll timestamp completion
        for _ in range(30):
            time.sleep(0.5)
            ts_status = http_get(f"{STUDIO_URL}/api/projects/{project_name}/timestamps/status")
            if ts_status["state"] in ("completed", "failed", "cancelled"):
                break

        print(f"  -> Timestamp Status: {ts_status['state']}")
        assert ts_status["state"] == "completed", f"Timestamp generation failed: {ts_status.get('error')}"

        # 4. Verify raw transcription diagnostic
        raw_ts = json.loads((project_dir / "transcription_raw.json").read_text(encoding="utf-8"))
        raw_text = " ".join(s["text"] for s in raw_ts["segments"]).lower()
        print(f"  -> Raw Whisper transcript: '{raw_text.strip()}'")
        assert "banana" in raw_text, "Whisper did not recognize spoken override 'banana'!"

        # 5. Verify final timestamps.srt and timestamps.json
        srt_content = (project_dir / "timestamps.srt").read_text(encoding="utf-8").strip()
        print(f"\n--- Final timestamps.srt ---\n{srt_content}\n----------------------------")

        # Crucial Quality Gates:
        assert "UNFOLDIQ_PRON_TEST" in srt_content, "CRITICAL: SRT does not preserve original script phrase UNFOLDIQ_PRON_TEST!"
        assert "banana" not in srt_content, "CRITICAL: Spoken form 'banana' leaked into final SRT!"

        ts_json = json.loads((project_dir / "timestamps.json").read_text(encoding="utf-8"))
        seg = ts_json["segments"][0]
        print(f"  -> Derived Timestamp: {seg['start']}s -> {seg['end']}s (Status: {seg['status']})")
        assert seg["start"] >= 0.0
        assert seg["end"] > seg["start"]
        assert seg["end"] <= ts_json["audio_duration"] + 0.1

        print("\n[PASSED] Pronunciation-Override Alignment Acceptance Test Passed 100%!")

    finally:
        # 6. Delete temporary pronunciation entry
        if entry_id:
            print(f"\n6. Deleting temporary pronunciation entry {entry_id}...")
            http_delete(f"{STUDIO_URL}/api/pronunciations/{entry_id}")
            print("  -> Cleaned up temporary dictionary entry.")


if __name__ == "__main__":
    run_acceptance()
