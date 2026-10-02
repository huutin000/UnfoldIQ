# Local providers — index

Manual setup guides (Windows-oriented, repo root `D:\Project\UNFOLDIQ`):

- `providers/local/SETUP_COMFYUI.md` — ComfyUI image/video (loopback `127.0.0.1:8188`), env `COMFYUI_CMD`.
- `providers/local/SETUP_KOKORO.md` — Kokoro TTS, env `KOKORO_VOICES`, `KOKORO_LANGS`. Official source: https://github.com/hexgrad/kokoro.
- `providers/local/SETUP_WHISPER.md` — whisper.cpp STT, env `WHISPER_CPP_BIN`, `WHISPER_CPP_MODEL`, `WHISPER_CPP_SERVER_URL`. Official source: https://github.com/ggml-org/whisper.cpp.

Verify with the inspection-only doctor (never installs, downloads, or launches models):

```powershell
node scripts/diagnostics/local-media-doctor.js
node scripts/diagnostics/local-media-doctor.js --json
```

Exit code is always 0; the doctor never fails the build.
