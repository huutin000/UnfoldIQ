# UNFOLDIQ Provider Notes

This document records known provider capabilities and official documentation references. It is NOT an implementation.

---

## OpenAI Image

**Logical ID**: `openai-image`

**Capabilities**:
- Generate image from text prompt
- Edit image (when implementation supports)

**Official Documentation**:
- https://developers.openai.com/api/docs/guides/image-generation

**Notes**:
- Specific model IDs (e.g., `gpt-image-1`, `dall-e-3`) may change over time.
- Implementation MUST verify current documentation at implementation time.
- Output MUST be saved as a file in the project workspace before use in Remotion.
- API key required: `OPENAI_API_KEY` from environment.

---

## Google Veo

**Logical ID**: `google-veo`

**Capabilities**:
- Generate video from text prompt

**Official Documentation**:
- https://ai.google.dev/gemini-api/docs/veo

**Notes**:
- Model/version may change.
- Implementation MUST verify current documentation at implementation time.
- Generated video MUST be downloaded and saved as a file in the project workspace before Remotion can use it.
- API key required: `GEMINI_API_KEY` from environment.

---

## ElevenLabs

**Logical ID**: `elevenlabs`

**Capabilities**:
- Text-to-Speech (TTS)
- Speech-to-Text / Timestamps (when implementation supports)

**Official Documentation**:
- TTS: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- STT: https://elevenlabs.io/docs/api-reference/speech-to-text/convert

**Notes**:
- TTS output MUST be saved as an audio file (e.g., MP3, WAV) in the project workspace.
- STT/timestamps output MUST be saved as a structured timing artifact (e.g., JSON with word-level timestamps).
- API key required: `ELEVENLABS_API_KEY` from environment/secret store.
- Voice selection, model, and parameters to be configured at implementation time.

---

## Agent-Native

**Logical ID**: `agent-native`

**Capabilities**:
- Any capability natively exposed by the current agent runtime as a tool

**Notes**:
- This is NOT tied to a specific vendor.
- Capability is ONLY considered available if the agent runtime actually exposes the corresponding tool AND can create persistent artifacts in the workspace.
- Do NOT assume all agents (Codex, OpenCode, Antigravity, ChatGPT, etc.) have the same native capabilities.
- Verify at runtime: `tool exists && can write file to workspace`.

---

## Approved Local

**Logical ID**: `approved-local`

**Capabilities**:
- Music from pre-cleared local library
- SFX from pre-cleared local library
- User-provided assets (images, video, audio)
- Assets with verified provenance and sufficient rights

**Notes**:
- Do NOT auto-download music/video/images from the web just because a public URL is accessible.
- Every asset used via `approved-local` MUST have documented provenance and rights status.
- Intended for assets already in the project or explicitly provided by the user with clearance.