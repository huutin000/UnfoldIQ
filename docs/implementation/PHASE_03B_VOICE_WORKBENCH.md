# Subphase 3B: Voice Workbench Architecture & Reference

## Overview
Subphase 3B implements the canonical 3-Column **Voice Workbench** (`#ws-voice`) in UnfoldIQ Studio, establishing an integrated environment for audio transport, transcript synchronization, word cue seeking, Kokoro TTS generation, Faster-Whisper alignment, Voice QA metrics, and pronunciation dictionary management.

---

## 3-Column Architectural Breakdown

### Column 1: Voice Navigator (`#voice-navigator`)
- **Container**: `#voice-chunks-container` with listbox semantics and roving tabindex.
- **Header**: Title "Đoạn giọng" + Chunk count badge.
- **Search & Filter**: Realtime text filtering and status selector (`Tất cả`, `Sẵn sàng`, `Cần cập nhật`, `Chưa tạo`).
- **Items (`.voice-chunk-item`)**:
  - Displays Chunk Index (`#c_01`), duration (`00:04.2`), status pill, and text snippet.
  - Keyboard navigation via ArrowUp / ArrowDown.
  - QA issue badge when quality warnings exist on that chunk.

### Column 2: Voice Workspace (`#voice-workspace`)
- **Card 1: Audio Transport**:
  - Play / Pause toggle with synchronized audio element.
  - Current time / Total duration counter (`#voice-cur-time` / `#voice-tot-dur`).
  - Native scrubber slider (`input[type="range"]`) with ARIA role slider.
  - Skip -5s / +5s buttons.
  - Independent **Preview Playback Rate Selector** (`#voice-playback-rate`: 0.5x, 0.75x, 1.0x, 1.25x, 1.5x, 2.0x). Manipulates HTML5 audio element in memory; strictly separated from TTS generation speed.
  - Download dropdown menu (`.wav`, `.mp3`, `.srt`, `.json`).
- **Card 2: Interactive Transcript & Word Cues**:
  - STT alignment progress banner (`#voice-stt-progress`).
  - Rich word cues container (`#voice-cues-container`).
  - Renders 1,400+ interactive word tokens (`.word-cue`).
  - **Zero-network highlight synchronization**: Updates active word tokens on `timeupdate` in <0.2ms via binary search index.
  - **Click-to-seek**: Clicking any word cue seeks the audio player to its exact start timestamp.

### Column 3: Voice Inspector (`#voice-inspector`)
- **Card 1: Voice Settings**:
  - Kokoro model selector (`#voice-select-model`: `af_heart`, `af_bella`, `am_adam`, etc.).
  - TTS speed factor slider (`#voice-tts-speed`: 0.5x - 2.0x) with realtime value readout.
  - Action buttons: "Tạo giọng đoạn đang chọn" (single chunk) and "Tạo lại toàn bộ giọng đọc" (SSE pipeline).
- **Card 2: Voice QA**:
  - Status verdict badge (`Đạt chuẩn`, `Cần xem lại`, `Chưa đạt`).
  - Quality metrics: Transcript Match %, WER %, WPM, Total Issues.
  - Action: "Chạy kiểm tra Voice QA".
  - Scrollable issues list with click-to-seek to issue timestamps.
- **Card 3: Pronunciation Dictionary**:
  - Quick-add form: Original word + Spoken phonetics.
  - List of active replacements with impact detection.
  - Direct pronunciation test audio playback button.
- **Card 4: Lock & Revisions**:
  - Chunk lock toggle to safeguard approved audio from accidental re-renders.
  - Revision history list with one-click restore.

---

## API Endpoints Reference

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/projects/{dir}/v2/voice` | Primary voice slice payload (chunks, word cues, QA summary, pronunciation count) |
| `GET` | `/api/projects/{dir}/voice` | Backward-compatibility alias for v2 voice slice |
| `GET` | `/api/projects/{dir}/chunks/{id}/audio` | High-speed single chunk audio streaming endpoint |
| `POST`| `/api/projects/{dir}/voice-qa/rerender-chunk/{index}` | Re-renders single chunk audio via Kokoro |
| `POST`| `/api/projects/{dir}/timestamps` | Triggers Faster-Whisper alignment worker |
| `GET` | `/api/projects/{dir}/timestamps/status` | Polls alignment progress (0-100%) |
| `POST`| `/api/projects/{dir}/timestamps/cancel` | Safely cancels ongoing alignment worker |
