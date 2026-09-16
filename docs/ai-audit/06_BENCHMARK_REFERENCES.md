# PROMPT 06 — BENCHMARK & REFERENCE NOTES

> Đây là tài liệu tham khảo để agent hiểu pattern nên nghiên cứu.
> Không dùng làm lý do copy feature/UI.

## Runway Workflows

Học:
- workflow/node orchestration
- run individual node vs whole workflow
- generation as explicit operation
- execution/output history

Official:
https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows

## ElevenLabs Studio

Học:
- paragraph/selection-level regeneration
- Generation History
- restore previous generation
- lock approved paragraph
- timeline/media workflow

Official:
https://elevenlabs.io/docs/help-center/product/studio/studio/what-is-studio
https://elevenlabs.io/docs/help-center/product/studio/studio/what-is-generation-history-in-studio
https://elevenlabs.io/docs/help-center/product/studio/studio/what-does-the-lock-icon-mean-in-studio
https://elevenlabs.io/docs/help-center/product/studio/studio/can-i-regenerate-individual-words-in-studio

## Descript

Học:
- transcript ↔ media editing
- contextual editing
- giảm context switching

Agent phải research official docs hiện tại trước khi kết luận.

## LTX Studio

Học:
- Scene/Shot-centered planning
- character/location/reference consistency
- visual production workflow

Agent phải research official docs/product hiện tại trước khi kết luận.

## ComfyUI

Học:
- local-first graph execution
- node dependency
- caching/incremental execution
- only re-execute affected work khi có thể

Official:
https://docs.comfy.org/

## W3C WCAG 2.2

Học:
- Reflow
- Focus visibility
- Keyboard
- Dragging alternatives
- Target Size (Minimum)

Official:
https://www.w3.org/TR/WCAG22/

## Next.js

Chỉ áp dụng nếu current stack thực sự là Next.js.

Học:
- lazy loading
- dynamic imports
- image sizing
- lazy image loading

Official:
https://nextjs.org/docs/app/guides/lazy-loading
https://nextjs.org/docs/app/api-reference/components/image

## web.dev

Học:
- list virtualization/windowing
- long-list rendering performance
- main-thread responsiveness

Official:
https://web.dev/articles/virtualize-long-lists-react-window

## Adobe Premiere Proxies

Học:
- low-resolution proxy để edit nhẹ hơn
- giữ high-resolution master
- export mặc định từ full-resolution source

Official:
https://helpx.adobe.com/premiere/desktop/organize-media/ingest-proxy-workflow/create-proxies.html
https://helpx.adobe.com/premiere/desktop/organize-media/ingest-proxy-workflow/export-proxies.html

## OpenAI Whisper

Học:
- model có nhu cầu VRAM khác nhau
- hardware requirement phải benchmark thực tế
- không hard-code model khi chưa biết máy

Official:
https://github.com/openai/whisper/blob/main/README.md

## Benchmark Rules

1. Research official/current source.
2. Ghi ngày kiểm tra.
3. Chỉ lấy pattern giải quyết vấn đề.
4. Không copy UI.
5. Không thêm feature vì competitor có.
6. Mọi recommendation phải quay lại constraints:
   - solo-first
   - local/free-first
   - paid AI optional
   - hardware-aware
   - no final quality loss
   - workflow simplification
   - performance
   - accessibility
