// Central time-conversion module for UNFOLDIQVideo.
// Mirrors the root render-time semantics: starts round DOWN (floor),
// ends and durations round UP (ceil). A non-zero interval whose start
// and end land on the same frame is widened to end = start + 1 so that
// no audible/visible item collapses to zero frames.
// No other module may define its own ms<->frame conversion: import from here.

export const ROUNDING_SEMANTICS = {
  start: 'floor',
  end: 'ceil',
  duration: 'ceil',
  equalFramesRule: 'end=start+1 when endMs>startMs',
} as const;

function assertValidTimeArgs(ms: number, fps: number): void {
  if (!Number.isFinite(ms) || !Number.isFinite(fps) || ms < 0 || fps <= 0) {
    throw new Error(
      `INVALID_TIME: ms must be finite and >= 0 and fps must be finite and > 0 (got ms=${String(
        ms,
      )}, fps=${String(fps)})`,
    );
  }
}

// First frame in which the given millisecond is visible.
export function msToFrameStart(ms: number, fps: number): number {
  assertValidTimeArgs(ms, fps);
  return Math.floor((ms / 1000) * fps);
}

// First frame AFTER the given millisecond (exclusive end).
export function msToFrameEnd(ms: number, fps: number): number {
  assertValidTimeArgs(ms, fps);
  return Math.ceil((ms / 1000) * fps);
}

// Frame count covering a duration.
export function durationMsToFrames(durationMs: number, fps: number): number {
  assertValidTimeArgs(durationMs, fps);
  return Math.ceil((durationMs / 1000) * fps);
}

// Timestamp of a frame boundary.
export function frameToMs(frame: number, fps: number): number {
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || frame < 0 || fps <= 0) {
    throw new Error(
      `INVALID_TIME: frame must be finite and >= 0 and fps must be finite and > 0 (got frame=${String(
        frame,
      )}, fps=${String(fps)})`,
    );
  }
  return (frame / fps) * 1000;
}

// Half-open frame range [start, end) for a millisecond interval, applying
// the non-zero-span rule: endMs > startMs but equal frames -> end = start + 1.
export function frameRangeForInterval(
  startMs: number,
  endMs: number,
  fps: number,
): { start: number; end: number } {
  const start = msToFrameStart(startMs, fps);
  let end = msToFrameEnd(endMs, fps);
  if (endMs > startMs && end <= start) {
    end = start + 1;
  }
  return { start, end };
}
