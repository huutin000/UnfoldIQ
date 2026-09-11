"""
Section 42 Acceptance Test:
Proper-Noun Practical Test.
Script: 'At Olduvai Gorge in Tanzania, researchers re-examined two fossils belonging to Homo habilis.'
1. Generates TTS audio.
2. Runs Phase 4 timestamp pipeline.
3. Records raw Whisper text vs final SRT text.
4. Verifies 'Olduvai Gorge' and 'Homo habilis' are preserved exactly in timestamps.srt.
"""

import json
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


def run_acceptance():
    print("=" * 60)
    print("PHASE 4 SECTION 42: PROPER-NOUN PRACTICAL TEST")
    print("=" * 60)

    script = "At Olduvai Gorge in Tanzania, researchers re-examined two fossils belonging to Homo habilis."
    print(f"Source Script:\n  '{script}'\n")

    # 1. Generate TTS audio
    print("1. Submitting TTS narration job...")
    job_resp = http_post(f"{STUDIO_URL}/api/jobs", {
        "script": script,
        "project_name": "phase4_proper_noun_test",
        "voice": "af_heart",
        "speed": 1.0,
        "export_mp3": False
    })
    job_id = job_resp["job_id"]
    print(f"  -> Job started: {job_id}. Waiting for completion...")

    for _ in range(30):
        time.sleep(0.5)
        status = http_get(f"{STUDIO_URL}/api/jobs/{job_id}")
        if status["state"] in ("completed", "failed", "cancelled"):
            break

    assert status["state"] == "completed", f"TTS job failed: {status.get('error_message')}"
    project_name = status["project_name"]
    project_dir = BASE_DIR / "projects" / project_name
    print(f"  -> Project created at: {project_name} (Duration: {status.get('final_duration_seconds')}s)")

    # 2. Trigger Timestamps
    print("\n2. Triggering Phase 4 timestamp generation...")
    ts_start = http_post(f"{STUDIO_URL}/api/projects/{project_name}/timestamps", {})
    
    for _ in range(30):
        time.sleep(0.5)
        ts_status = http_get(f"{STUDIO_URL}/api/projects/{project_name}/timestamps/status")
        if ts_status["state"] in ("completed", "failed", "cancelled"):
            break

    assert ts_status["state"] == "completed", f"Timestamp generation failed: {ts_status.get('error')}"
    print(f"  -> Timestamps completed! Coverage: {ts_status.get('coverage_pct')}%")

    # 3. Read raw vs final artifacts
    raw_ts = json.loads((project_dir / "transcription_raw.json").read_text(encoding="utf-8"))
    raw_text = " ".join(s["text"] for s in raw_ts["segments"]).strip()
    
    srt_content = (project_dir / "timestamps.srt").read_text(encoding="utf-8").strip()
    ts_json = json.loads((project_dir / "timestamps.json").read_text(encoding="utf-8"))
    seg = ts_json["segments"][0]

    print("\n--- RESULTS RECORD ---")
    print(f"Raw Whisper Text: '{raw_text}'")
    print(f"Source-Script Text: '{script}'")
    print(f"Match/Alignment Coverage: {ts_status.get('coverage_pct')}%")
    print(f"Final Timing: {seg['start']}s --> {seg['end']}s")
    print(f"Final SRT Cue:\n{srt_content}")
    print("----------------------\n")

    # Assert proper nouns preserved in SRT
    assert "Olduvai Gorge" in srt_content, "CRITICAL: 'Olduvai Gorge' missing or altered in SRT!"
    assert "Homo habilis" in srt_content, "CRITICAL: 'Homo habilis' missing or altered in SRT!"
    assert seg["start"] >= 0.0
    assert seg["end"] > seg["start"]
    assert seg["end"] <= ts_json["audio_duration"] + 0.1

    print("[PASSED] Proper-Noun Practical Test Passed 100%!")


if __name__ == "__main__":
    run_acceptance()
