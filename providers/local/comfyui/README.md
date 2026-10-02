# ComfyUI local adapter (generic, registry-driven)

- Generic adapter: no model names hard-coded in code. All workflows come from `workflow-registry.yaml`.
- Registry-driven: `workflow-loader.js` loads/validates the registry; `parameter-mapper.js` maps requests via `parameterBindings`; `client.js` talks HTTP to loopback only.
- Loopback only: `client.js` constructor rejects any host other than `127.0.0.1` / `localhost`. Default server `127.0.0.1:8188`.
- No model hard-coding: example heavy workflows are `enabled: false` and reference example model paths that are NOT bundled.
- No auto-download: the adapter never pip/npm installs, clones, downloads, or fetches models. Missing models surface as `MODEL_MISSING`.
- Test workflow: `mock-image-test` (`enabled: true`) is TEST-ONLY and uses no real model.
