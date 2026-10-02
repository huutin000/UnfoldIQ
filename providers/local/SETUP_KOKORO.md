# SETUP — Kokoro TTS (manual, Windows)

Repo root in these examples: `D:\Project\UNFOLDIQ`.

Official source: https://github.com/hexgrad/kokoro (check the repo README / docs for current install steps).

## 1. Install (manual — UNFOLDIQ never auto-installs)

```powershell
cd D:\Project\UNFOLDIQ
# Follow https://github.com/hexgrad/kokoro to install Python + kokoro + voices manually.
# UNFOLDIQ will NOT pip install, clone, download, or launch models for you.
```

## 2. Voices / models (manual)

- Download voices/models only from the official kokoro source above.
- UNFOLDIQ never auto-downloads voices.

## 3. Env vars

| Var | Purpose | Example |
|-----|---------|---------|
| `KOKORO_VOICES` | Voice list / path hint | `af_heart` |
| `KOKORO_LANGS` | Enabled language codes | `en` |
| `KOKORO_MODEL` | Optional model path hint | `D:\models\kokoro\model.onnx` |

## 4. Run

- Run kokoro per its own docs. Keep any server binding on loopback (`127.0.0.1`) only.

## 5. Verify (inspection only — no audio generation)

```powershell
cd D:\Project\UNFOLDIQ
node scripts/diagnostics/local-media-doctor.js
```

Look at the `kokoro` section: python availability, `kokoro` package import check, env vars, supported languages from adapter metadata. The doctor never synthesizes audio.
