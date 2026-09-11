"""
Step 18: Cancellation Acceptance Test
Verify that stopping a running job halts future chunks, marks project as Cancelled,
leaves Kokoro healthy, and allows immediate subsequent synthesis.
"""

import sys
sys.path.insert(0, r"D:\Project\UnfoldIQ")

import json
import time
import urllib.request
from pathlib import Path
from studio.audio_service import KokoroClient

BASE_URL = "http://127.0.0.1:7860"

print("=== STEP 18: CANCELLATION TEST ===")

# 1. Prepare multi-chunk script
script_text = (
    "This is chunk number one. Early hominids explored the vast African savannah beneath an unyielding sky. "
    "They observed the cycles of drought and flood, and the quiet ruthlessness of apex predators.\n\n"
    "This is chunk number two. As group sizes expanded beyond fifty individuals, physical grooming became mathematically unsustainable. "
    "Language therefore emerged as an evolutionary necessity to maintain social bonds.\n\n"
    "This is chunk number three. Roughly seventy thousand years ago, small bands of Homo sapiens began crossing the Bab-el-Mandeb strait. "
    "They ventured into the uncharted expanses of Eurasia and met other archaic human species.\n\n"
    "This is chunk number four. In the caves of Lascaux and Chauvet, artists blew charcoal dust through hollowed bird bones. "
    "They immortalized surging bison, horses, and hand stencils upon damp limestone walls.\n\n"
    "This is chunk number five. Around twelve thousand years ago, human societies in the Fertile Crescent initiated agriculture. "
    "Sedentary villages burgeoned into the world's first true urban centers."
)

payload = {
    "script": script_text,
    "project_name": "cancellation_acceptance_test",
    "voice": "af_heart",
    "speed": 1.0,
    "language": "American English",
    "export_mp3": False
}

# Start job
req = urllib.request.Request(
    f"{BASE_URL}/api/jobs",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(req) as resp:
    start_resp = json.loads(resp.read().decode("utf-8"))

job_id = start_resp["job_id"]
print(f"Launched job to cancel: {job_id}")

# Wait until chunk 1 is in progress
time.sleep(0.3)

# Trigger cancellation
cancel_req = urllib.request.Request(
    f"{BASE_URL}/api/jobs/{job_id}/cancel",
    data=b"",
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(cancel_req) as resp:
    cancel_resp = json.loads(resp.read().decode("utf-8"))

print(f"Cancellation requested: {cancel_resp}")

# Poll until job state changes
start_wait = time.time()
while time.time() - start_wait < 10:
    time.sleep(0.4)
    with urllib.request.urlopen(f"{BASE_URL}/api/jobs/{job_id}") as resp:
        job = json.loads(resp.read().decode("utf-8"))
    print(f"Polling state: {job['state']} | Chunks completed: {job.get('current_chunk', 0)}/{job.get('total_chunks', 0)}")
    if job["state"] in ("cancelled", "failed", "completed"):
        break

assert job["state"] == "cancelled", f"Expected state 'cancelled', got '{job['state']}'"
print("SUCCESS: Job successfully transitioned to 'cancelled' state.")

# Verify no master audio.wav was generated for cancelled job
project_dir = Path(job["project_dir"])
master_wav = project_dir / "audio.wav"
print(f"Master WAV exists in cancelled project: {master_wav.is_file()} (Expected: False)")
assert not master_wav.is_file(), "Master WAV should not exist for cancelled job!"

# Verify settings.json reflects cancelled status
settings_file = project_dir / "settings.json"
if settings_file.is_file():
    with open(settings_file, "r") as f:
        meta = json.load(f)
    print(f"Settings.json status: {meta.get('status')} (Expected: 'cancelled')")
    assert meta.get("status") == "cancelled"

# Verify Kokoro service health on port 8880
client = KokoroClient()
import asyncio
health = asyncio.run(client.check_health())
print(f"Kokoro Health after cancellation: {health} (Expected: healthy=True)")
assert health.get("healthy") is True

# Verify a subsequent job succeeds immediately
print("\nVerifying subsequent new job starts and completes cleanly...")
subsequent_payload = {
    "script": "Subsequent job test after cancellation. Everything continues working smoothly.",
    "project_name": "subsequent_after_cancel",
    "voice": "af_heart",
    "speed": 1.0,
    "language": "American English",
    "export_mp3": False
}
req2 = urllib.request.Request(
    f"{BASE_URL}/api/jobs",
    data=json.dumps(subsequent_payload).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(req2) as resp:
    sub_resp = json.loads(resp.read().decode("utf-8"))

sub_job_id = sub_resp["job_id"]
print(f"Subsequent Job ID: {sub_job_id}")

while True:
    time.sleep(0.5)
    with urllib.request.urlopen(f"{BASE_URL}/api/jobs/{sub_job_id}") as resp:
        sub_job = json.loads(resp.read().decode("utf-8"))
    if sub_job["state"] in ("completed", "failed", "cancelled"):
        break

print(f"Subsequent job final state: {sub_job['state']} (Final duration: {sub_job.get('final_duration_seconds')}s)")
assert sub_job["state"] == "completed", f"Subsequent job failed: {sub_job.get('error_message')}"
print("CANCELLATION ACCEPTANCE TEST: ALL CHECKS PASSED!")
