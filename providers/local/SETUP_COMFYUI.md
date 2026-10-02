# SETUP — ComfyUI (manual, Windows)

Repo root in these examples: `D:\Project\UNFOLDIQ`.

Official source: https://github.com/comfyanon/ComfyUI (check the repo README for current install steps).

## 1. Install (manual — UNFOLDIQ never auto-installs)

```powershell
cd D:\Project\UNFOLDIQ
git clone https://github.com/comfyanon/ComfyUI ..\ComfyUI
# Follow the official ComfyUI README to create its venv / install deps inside ..\ComfyUI.
# UNFOLDIQ will NOT pip install, clone, or download models for you.
```

## 2. Models (manual)

- Place checkpoint files where your ComfyUI install expects them (its own `models\checkpoints` folder).
- The registry `providers\local\comfyui\workflow-registry.yaml` references **example** paths only (e.g. `models/checkpoints/sdxl-example.safetensors`) — these are NOT bundled and are DISABLED by default.
- Only the TEST-ONLY `mock-image-test` workflow is enabled and it needs no real model.

## 3. Env vars

| Var | Purpose | Example |
|-----|---------|---------|
| `COMFYUI_CMD` | Command used to launch ComfyUI manually | `D:\ComfyUI\run.bat` or `python D:\ComfyUI\main.py` |

## 4. Run (loopback only)

```powershell
# From your ComfyUI folder, bind loopback only:
python main.py --listen 127.0.0.1 --port 8188
```

WARNING: never expose ComfyUI to the network (`--listen 0.0.0.0`); UNFOLDIQ clients connect to `127.0.0.1:8188` only and reject non-loopback hosts.

## 5. Verify (inspection only — no generation, no download)

```powershell
cd D:\Project\UNFOLDIQ
node scripts/diagnostics/local-media-doctor.js
```

Look at the `comfyui` section: server reachability (`http://127.0.0.1:8188/system_stats`), registry workflow count, referenced-model existence, image/video capability.
