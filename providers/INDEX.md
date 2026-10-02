# UNFOLDIQ Provider Router

## Supported Capabilities

| Capability | Description |
|------------|-------------|
| `image` | Generate or edit images |
| `video` | Generate video clips |
| `tts` | Text-to-speech synthesis |
| `stt` | Speech-to-text / timestamp extraction |
| `music` | Background music selection/licensing |
| `sfx` | Sound effects |

## Routing Rules

1. **Prefer Existing Assets**: Agent MUST first check for valid existing assets in the project that satisfy scene requirements before generating new ones.
2. **No Unnecessary Regeneration**: Do not regenerate an asset solely because a provider is available.
3. **Capability-Based Selection**: Provider selection is based on actual capability availability and current configuration, not assumptions.
4. **No False Availability**: Do not claim a provider/tool is available unless it is actually callable and can produce persistent artifacts in the workspace.
5. **Secret Handling**: If a provider requires a secret that is not present in the environment:
   - Do not log the secret
   - Do not write the secret to any report
   - Mark the provider as unavailable for the current run
6. **Remotion-Native Fallback**: If a visual requirement can be satisfied by deterministic Remotion-native graphics, text, or shapes without violating creative intent, this fallback MAY be used.
7. **Blocking on Missing Required Capability**: If a required asset cannot be generated/retrieved and no valid fallback exists, the stage status is `BLOCKED` with the missing capability documented.
8. **No Hardcoded Provider Details**: Specific API models, versions, or parameters are NOT hardcoded in the core workflow. They are resolved at runtime via provider configuration.
9. **Persistent Artifacts**: All provider outputs must be saved as referenceable files/artifacts in the project workspace, not just transient chat results.
10. **Provenance Required**: Every generated asset must have minimum provenance recorded before being used in final render.

## Provider Logical IDs

| ID | Type |
|----|------|
| `existing` | Reuse asset already in project |
| `existing-timestamps` | Reuse existing timestamped transcript |
| `approved-local` | User-provided or pre-cleared local asset library |
| `agent-native` | Tool exposed by current agent runtime (if any) |
| `openai-image` | OpenAI image generation API |
| `google-veo` | Google Veo video generation API |
| `elevenlabs` | ElevenLabs TTS/STT API |

## Resolution Flow

```
Scene Requirement
       │
       ▼
Check Existing Assets (existing, existing-timestamps, approved-local)
       │
       ├─► Found valid? ──► Use it
       │
       ▼
Check Agent-Native Tools (agent-native)
       │
       ├─► Capable? ──► Use it
       │
       ▼
Check Configured API Providers (openai-image, google-veo, elevenlabs)
       │       │
       │       ├─► Available + secrets present? ──► Use it
       │       │
       │       └─► Unavailable? ──► Try next in preferredOrder
       │
       ▼
Check Remotion-Native Visual Fallback (if visual)
       │
       ├─► Sufficient? ──► Use it
       │
       ▼
BLOCKED — document missing capability
```

Configuration details in `providers/CONFIG.yaml`.
Contract details in `providers/PROVIDER_CONTRACT.md`.
Provider notes in `providers/PROVIDERS.md`.