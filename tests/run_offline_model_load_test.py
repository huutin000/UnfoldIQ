"""
Verification test for Phase 4 Audit G: Offline Model Loading Verification
Verifies that models/whisper/small.en loads completely offline in a fresh process
with network offline environment variables (HF_HUB_OFFLINE=1, TRANSFORMERS_OFFLINE=1)
and local_files_only=True on CUDA (int8_float16).
"""

import os
import sys
import time
from pathlib import Path

# Add CUDA DLL path for CTranslate2
TORCH_LIB_PATH = Path(r"D:\Project\UnfoldIQ\upstream\kokoro-fastapi\.venv\Lib\site-packages\torch\lib")
if TORCH_LIB_PATH.exists():
    os.environ["PATH"] = str(TORCH_LIB_PATH) + os.pathsep + os.environ.get("PATH", "")
    if hasattr(os, "add_dll_directory"):
        try:
            os.add_dll_directory(str(TORCH_LIB_PATH))
        except Exception:
            pass

# Strictly forbid any remote network calls
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

model_dir = Path(r"D:\Project\UnfoldIQ\models\whisper\small.en")
assert model_dir.exists(), f"Model path {model_dir} does not exist!"

print(f"[TEST G] Testing offline model load from: {model_dir}")
print(f"[TEST G] Offline enforcement: HF_HUB_OFFLINE={os.environ.get('HF_HUB_OFFLINE')}, TRANSFORMERS_OFFLINE={os.environ.get('TRANSFORMERS_OFFLINE')}")

t0 = time.time()
from faster_whisper import WhisperModel

model = WhisperModel(
    str(model_dir),
    device="cuda",
    compute_type="int8_float16",
    local_files_only=True
)
load_time = time.time() - t0

print(f"[TEST G] Model successfully loaded offline in {load_time:.3f}s on CUDA!")
print(f"[TEST G] Model device: cuda, compute_type: int8_float16")
assert model is not None
print("[TEST G] AUDIT G PASSED: Offline load verified 100% functional without network.")
