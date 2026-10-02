# Mock workflow fixture

`mock-image-test.json` is a minimal TEST-ONLY ComfyUI prompt fixture.

- Node `6`: text input (`inputs.text`).
- Node `3`: size/seed (`inputs.width`, `inputs.height`, `inputs.seed`).
- Node `9`: output node.

No real model is referenced or required. Used by `mock-image-test` registry entry and by unit tests via injected `ctx.comfyuiTransport` mocks (never a live server).
