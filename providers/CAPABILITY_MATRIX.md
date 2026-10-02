# UNFOLDIQ Capability Matrix (STEP-10C Branch C)

Live availability is NOT_VERIFIED_BY_DEFAULT: the provider doctor verifies at
runtime; this table makes no static eternal availability claims.

| Provider | Capability | Implementation | Live availability | Cost class | Approval | Notes |
|---|---|---|---|---|---|---|
| existing | image | READY | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Reuse project artifact; fingerprint-gated |
| existing | video | READY | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Reuse project artifact; fingerprint-gated |
| existing | tts | READY | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Reuse project artifact; fingerprint-gated |
| existing | stt | READY | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Reuse project artifact; fingerprint-gated |
| existing | music | READY | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Reuse project artifact; fingerprint-gated |
| existing | sfx | READY | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Reuse project artifact; fingerprint-gated |
| existing-timestamps | stt | PLANNED | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Reuse existing timestamped transcript slot |
| approved-local | image | READY | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Pre-cleared library; UNKNOWN/UNVERIFIED rights never READY |
| approved-local | video | READY | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Pre-cleared library; UNKNOWN/UNVERIFIED rights never READY |
| approved-local | music | READY | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Pre-cleared library; rights-gated |
| approved-local | sfx | READY | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Pre-cleared library; rights-gated |
| agent-native-image | image | PLANNED | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Per-capability slot; generic agent-native bridge is READY but BRIDGE_NOT_CONFIGURED by default |
| agent-native-video | video | PLANNED | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Per-capability slot; do not assume native video |
| agent-native-tts | tts | PLANNED | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Per-capability slot; bridge-injected only |
| agent-native-stt | stt | PLANNED | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Per-capability slot; bridge-injected only |
| flow-web | image | READY | NOT_VERIFIED_BY_DEFAULT | INCLUDED_SUBSCRIPTION | Yes | Human-in-the-loop Flow; AWAITING_USER_APPROVAL or MANUAL_ASSIST handoff; subscription/credits consumed, never zero-cost |
| flow-web | video | READY | NOT_VERIFIED_BY_DEFAULT | INCLUDED_SUBSCRIPTION | Yes | Human-in-the-loop Flow; distinct from direct google-veo API |
| local-comfyui-image | image | PLANNED | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Requires running local ComfyUI instance |
| local-comfyui-video | video | PLANNED | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | Policy | Heavy local video avoided by default per hardwarePolicy |
| local-kokoro | tts | PLANNED | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Multi-language local TTS; language list verified at runtime |
| local-whisper | stt | PLANNED | NOT_VERIFIED_BY_DEFAULT | ZERO_LOCAL | No | Local STT; timing artifacts under timing/ |
| openai-image | image | READY | NOT_VERIFIED_BY_DEFAULT | PAID | Yes | Double opt-in (request allowPaidCloud + ctx.enableCloud); OPENAI_API_KEY env-only |
| google-veo | video | READY | NOT_VERIFIED_BY_DEFAULT | PAID | Yes | Double opt-in; GEMINI_API_KEY (or GOOGLE_API_KEY) env-only; render hints never feed Stage duration contract |
| elevenlabs-tts | tts | READY | NOT_VERIFIED_BY_DEFAULT | PAID | Yes | Double opt-in; ELEVENLABS_API_KEY env-only |
| elevenlabs-stt | stt | READY | NOT_VERIFIED_BY_DEFAULT | PAID | Yes | Double opt-in; timing artifact under timing/ |
| configured-cloud-image | image | READY | NOT_VERIFIED_BY_DEFAULT | UNKNOWN | Yes | Operator endpoint+key; cost UNKNOWN, never FREE_TIER claim |
| configured-cloud-video | video | READY | NOT_VERIFIED_BY_DEFAULT | UNKNOWN | Yes | Operator endpoint+key; cost UNKNOWN, never FREE_TIER claim |
| configured-cloud-tts | tts | READY | NOT_VERIFIED_BY_DEFAULT | UNKNOWN | Yes | Operator endpoint+key; cost UNKNOWN, never FREE_TIER claim |
| configured-cloud-stt | stt | READY | NOT_VERIFIED_BY_DEFAULT | UNKNOWN | Yes | Operator endpoint+key; cost UNKNOWN, never FREE_TIER claim |
| remote-mcp-video | video | PLANNED | NOT_VERIFIED_BY_DEFAULT | UNKNOWN | Yes | Remote MCP video slot; planned |
| external-handoff | image | READY | NOT_VERIFIED_BY_DEFAULT | UNKNOWN | Manual | Terminal fallback; persists handoff JSON |
| external-handoff | video | READY | NOT_VERIFIED_BY_DEFAULT | UNKNOWN | Manual | Terminal fallback; persists handoff JSON |
| external-handoff | tts | READY | NOT_VERIFIED_BY_DEFAULT | UNKNOWN | Manual | Terminal fallback; persists handoff JSON |
| external-handoff | stt | READY | NOT_VERIFIED_BY_DEFAULT | UNKNOWN | Manual | Terminal fallback; persists handoff JSON |
| external-handoff | music | READY | NOT_VERIFIED_BY_DEFAULT | UNKNOWN | Manual | Terminal fallback; persists handoff JSON |
| external-handoff | sfx | READY | NOT_VERIFIED_BY_DEFAULT | UNKNOWN | Manual | Terminal fallback; persists handoff JSON |
