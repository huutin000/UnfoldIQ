import React from 'react';
import { AbsoluteFill } from 'remotion';
import { resolveVisualSystem } from './theme/visual-system';
import { SceneTimeline } from './scenes/SceneTimeline';
import { CaptionTrack } from './captions/CaptionTrack';
import { AudioTrack } from './audio/AudioTrack';
import { DebugOverlay } from './debug/DebugOverlay';
import type { UnfoldiqRenderInput } from './runtime/types';

// Single reusable composition. Props are the full render input built by the
// Node branch.
export const UnfoldiqVideo: React.FC<UnfoldiqRenderInput> = (input) => {
  const { composition, scenes, assets, audio, captions, status } = input;

  if (
    !composition ||
    !Number.isFinite(composition.width) ||
    composition.width <= 0 ||
    !Number.isFinite(composition.height) ||
    composition.height <= 0 ||
    !Number.isFinite(composition.fps) ||
    composition.fps <= 0
  ) {
    throw new Error('RENDER_PROP_INVALID: composition width/height/fps must be numbers > 0');
  }
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('RENDER_PROP_INVALID: scenes must be a non-empty array');
  }
  if (status !== 'READY') {
    throw new Error(`RENDER_PROP_INVALID: status must be READY (got ${String(status)})`);
  }

  const visualSystem = resolveVisualSystem(input);
  const canvas = { width: composition.width, height: composition.height };
  const fps = composition.fps;

  return (
    <AbsoluteFill style={{ background: composition.background }}>
      <SceneTimeline
        scenes={scenes}
        assets={assets ?? {}}
        visualSystem={visualSystem}
        fps={fps}
        canvas={canvas}
      />
      <CaptionTrack
        captions={captions}
        visualSystem={visualSystem}
        fps={fps}
        canvas={canvas}
      />
      <AudioTrack audio={audio} assets={assets ?? {}} fps={fps} />
      {input.debug === true ? (
        <DebugOverlay
          scenes={scenes}
          fps={fps}
          safeZoneBottomPct={captions?.safeZone?.bottomPct}
          projectId={input.projectId}
        />
      ) : null}
    </AbsoluteFill>
  );
};
