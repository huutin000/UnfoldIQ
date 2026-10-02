# SETUP — whisper.cpp STT (manual, Windows)

Repo root in these examples: `D:\Project\UNFOLDIQ`.

Official source: https://github.com/ggml-org/whisper.cpp (check the repo README / releases for current builds and models).

## 1. Install (manual — UNFOLDIQ never auto-installs)

```powershell
cd D:\Project\UNFOLDIQ
# Download a whisper.cpp Windows build + model from https://github.com/ggml-org/whisper.cpp manually.
# UNFOLDIQ will NOT download binaries or models for you.
```

## 2. Models (manual)

- Place the `.bin` model where you want, e.g. `D:\models\whisper\ggml-base.en.bin`.
- Point `WHISPER_CPP_MODEL` at it (see below).

## 3. Env vars

| Var | Purpose | Example |
|-----|---------|---------|
| `WHISPER_CPP_BIN` | Full path to whisper binary | `D:\tools\whisper.cpp\whisper-cli.exe` |
| `WHISPER_CPP_MODEL` | Full path to model file | `D:\models\whisper\ggml-base.en.bin` |
| `WHISPER_CPP_SERVER_URL` | Optional local server URL (loopback only) | `http://127.0.0.1:8080` |

## 4. Run

- Invoke the binary manually per whisper.cpp docs. Keep any server on loopback (`127.0.0.1`) only.
- WARNING: never expose the server beyond loopback.

## 5. Verify (inspection only — no transcription)

```powershell
cd D:\Project\UNFOLDIQ
node scripts/diagnostics/local-media-doctor.js
```

Look at the `whisper` section: binary on PATH / `WHISPER_CPP_BIN` existence, model path existence, optional server reachability. The doctor never transcribes audio.
