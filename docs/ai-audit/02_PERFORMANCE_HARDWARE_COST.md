# PROMPT 02 — PERFORMANCE, HARDWARE & COST AUDIT

> Dùng file này để audit performance sau khi Product/Workflow đã được hiểu.
> Không tối ưu mù quáng. Đo trước, tối ưu sau.

## 37. Performance Audit

Profile:

- initial load
- route navigation
- bundle
- project loading
- Scene/Shot render
- asset grid
- audio waveform
- transcript
- autosave
- dependency calculation
- history
- local AI
- export
- search/filter
- rerender/state ownership

Không thêm memo/cache/lazy loading chỉ vì "best practice".

## 38. Large Project Scalability

Test representative project:

- 80+ Scenes
- 250–500+ Shots
- 250+ assets
- 100+ audio segments
- 1000+ transcript/timestamp rows
- nhiều history versions

Không:

- fetch all
- render all
- load 4K original vào grid
- mount hundreds of heavy editors

Ưu tiên:

- selective fetch
- lazy load
- pagination
- virtualization/windowing
- thumbnail
- proxy/preview
- incremental compute

## 39. Functional Simplification

Feature không cần page riêng nếu có thể thành:

- inline action
- side panel
- contextual action
- computed metadata
- deterministic automation
- submodule

## 40. Performance Regression

Baseline trước và sau.

Critical journey:

`Open Project → Story → Voice → Visual → Shot Editing → Export`

## 41. Hardware-Aware Performance Without Quality Loss

Detect/benchmark máy:

- OS
- CPU
- cores/threads
- RAM
- GPU
- VRAM
- CUDA/GPU acceleration
- storage/I/O/free space
- browser/runtime
- Python
- FFmpeg
- local AI runtime

Không assume.

### Không được giảm master/final quality

Không tự giảm:

- original image/video quality
- final resolution
- master audio quality
- timestamp accuracy
- dependency correctness
- export quality
- selected generated asset
- history integrity

### Được tối ưu working representation

- thumbnails
- proxy media
- preview resolution
- waveform density
- number of mounted DOM nodes
- concurrent workers
- background precompute

Nếu máy không đủ realtime:

`QUEUE / WAIT / BACKGROUND / SLOWER`

ưu tiên hơn:

`QUALITY DOWNGRADE`

## 42. Local Resource Scheduler

Heavy job phải qua scheduler.

Monitor:

- CPU
- RAM
- VRAM
- GPU
- disk I/O
- running jobs
- foreground activity

States:

- QUEUED
- RUNNING
- PAUSED
- COMPLETED
- FAILED
- CANCELLED

Priority:

1. UI responsiveness
2. Data safety/autosave
3. Playback/editing
4. Dependency/validation
5. User-requested generation
6. Background analysis
7. Cache/precompute

## Cache Rule

Cache key phải xét:

```text
effective input content
+ dependency versions/hashes
+ provider
+ model version
+ model settings
+ seed if applicable
+ prompt/workflow/schema version
```

Không regenerate nếu effective inputs không đổi.

## Local AI

Core dùng abstraction:

```text
TTSProvider
STTProvider
LLMProvider
ImageGenerationProvider
VideoGenerationProvider
```

Kokoro/Whisper/local LLM chỉ là adapter.

Không hard-code model trước khi biết hardware.

## Media Strategy

```text
Original / Master
        │
        ├── Thumbnail
        ├── Preview
        └── Proxy
```

Editing/workbench có thể dùng proxy.
Export mặc định dùng master/current accepted artifact.

## Web UI Performance Rules

- route-level lazy loading
- heavy libraries chỉ load khi cần
- image thumbnail + lazy loading
- prevent global rerender khi edit một Shot
- virtualize long lists khi có evidence
- expensive compute ra worker/process nếu phù hợp
- autosave debounce
- autosave != version
- dependency invalidation không chạy mỗi keystroke nếu không cần

## Performance Quality Gate

Audit phải trả lời:

- bottleneck ở đâu?
- đo bằng gì?
- project lớn có chịu được không?
- edit 1 Shot có rerender cả page không?
- load 1 Scene có fetch toàn Project không?
- background AI có làm UI lag không?
- asset grid có load originals không?
- export có khóa UI không?
- scheduler có tránh OOM/resource contention không?
- cache có reuse đúng và không reuse sai không?

## Output

1. Hardware & Runtime Baseline
2. Performance Baseline
3. Bottleneck Map
4. Resource Contention Map
5. Large Project Scalability Findings
6. Cache Strategy
7. Scheduler Strategy
8. Media Proxy Strategy
9. Performance Backlog
10. Regression Test Plan

**Không implement trong audit phase.**
