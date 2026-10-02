# UNFOLDIQ Platform Router

## Supported Platforms

| Platform ID | Aliases |
|-------------|---------|
| `youtube` | `YouTube`, `youtube`, `YT` |
| `tiktok` | `TikTok`, `tiktok`, `TT` |

## Resolution Rules

1. **Explicit user input always overrides** platform defaults.
2. **Unsupported platforms**: Do not assume nearest profile. Return `BLOCKED` and require valid platform.
3. **Ambiguous/unresolvable platform**: Return `BLOCKED` and request valid platform.
4. **Single-profile loading**: Agent loads only the profile for the requested platform; do not load all profiles into task context.
5. **Profile scope**: Platform profiles contain only technical/output defaults for video generation. They do NOT contain policy, research prompts, or provider implementations.

## Profile Routes

| Platform ID | Profile Path |
|-------------|--------------|
| `youtube` | `platforms/youtube/PROFILE.yaml` |
| `tiktok` | `platforms/tiktok/PROFILE.yaml` |

## Merge Precedence

When resolving final video spec, apply in order (highest wins):

```
Explicit User Input
        ↓ overrides
Platform Project Defaults (from PROFILE.yaml)
        ↓
Core Technical Fallback (if defined in future)
```