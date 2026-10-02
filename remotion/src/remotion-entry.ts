import { durationMsToFrames } from './runtime/time';
import type { UnfoldiqRenderInput } from './runtime/types';

export interface UnfoldiqMetadata {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  outputName: string;
}

// Documented platform fallback fps (the only place a default fps lives);
// all frame arithmetic elsewhere always uses the resolved fps param.
const FALLBACK_FPS = 30;
const FALLBACK_DURATION_MS = 5000;

export function platformFallbackDims(platform?: string): { width: number; height: number } {
  if (platform === 'tiktok') {
    return { width: 1080, height: 1920 };
  }
  return { width: 1920, height: 1080 };
}

// Resolve composition metadata for Root.calculateMetadata. Duration comes
// from the composition when present, else from timeline.actualTimelineEndMs,
// else from the scenes' max endMs. Never from script text.
export function calculateUnfoldiqMetadata(
  inputProps: Partial<UnfoldiqRenderInput>,
): UnfoldiqMetadata {
  const props = inputProps ?? {};
  const fallback = platformFallbackDims(props.platform);
  const comp = props.composition;

  const width =
    comp && Number.isFinite(comp.width) && comp.width > 0 ? comp.width : fallback.width;
  const height =
    comp && Number.isFinite(comp.height) && comp.height > 0 ? comp.height : fallback.height;
  const fps = comp && Number.isFinite(comp.fps) && comp.fps > 0 ? comp.fps : FALLBACK_FPS;

  let durationInFrames: number | undefined;
  if (comp && Number.isFinite(comp.durationInFrames) && (comp.durationInFrames as number) > 0) {
    durationInFrames = Math.round(comp.durationInFrames as number);
  } else {
    const endMs = props.timeline?.actualTimelineEndMs;
    if (Number.isFinite(endMs) && (endMs as number) > 0) {
      durationInFrames = Math.max(1, durationMsToFrames(endMs as number, fps));
    } else if (Array.isArray(props.scenes) && props.scenes.length > 0) {
      const maxEnd = Math.max(...props.scenes.map((scene) => scene.endMs));
      if (Number.isFinite(maxEnd) && maxEnd > 0) {
        durationInFrames = Math.max(1, durationMsToFrames(maxEnd, fps));
      }
    }
    if (durationInFrames === undefined) {
      if (comp && Number.isFinite(comp.durationMs) && (comp.durationMs as number) > 0) {
        durationInFrames = Math.max(1, durationMsToFrames(comp.durationMs as number, fps));
      } else {
        durationInFrames = Math.max(1, durationMsToFrames(FALLBACK_DURATION_MS, fps));
      }
    }
  }

  const outputName = comp?.outputName ?? `${props.platform ?? 'unfoldiq'}-video.mp4`;
  return { width, height, fps, durationInFrames, outputName };
}
