import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { durationMsToFrames, frameToMs, msToFrameStart } from '../runtime/time';
import type { SceneDef } from '../runtime/types';

export interface DebugOverlayProps {
  scenes: SceneDef[];
  fps: number;
  safeZoneBottomPct?: number;
  projectId?: string;
}

// Rendered ONLY when the render input sets debug === true. Never enabled by
// the render CLI defaultProps.
export const DebugOverlay: React.FC<DebugOverlayProps> = ({
  scenes,
  fps,
  safeZoneBottomPct = 12,
  projectId,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const timeMs = frameToMs(frame, fps);

  const activeScene = scenes.find((scene) => {
    const from = msToFrameStart(Math.max(0, scene.startMs - (scene.overlapMs ?? 0)), fps);
    const durationMs = scene.durationMs ?? scene.endMs - scene.startMs;
    const duration = Math.max(1, durationMsToFrames(durationMs, fps));
    return frame >= from && frame < from + duration;
  });

  const layerIds = activeScene ? activeScene.layers.map((layer) => layer.layerId) : [];
  const safeZoneHeight = (safeZoneBottomPct / 100) * height;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: safeZoneHeight,
          borderTop: '2px dashed rgba(77, 163, 255, 0.8)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          padding: '8px 12px',
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          color: '#f5f7fa',
          fontFamily: 'monospace',
          fontSize: 16,
          lineHeight: 1.4,
          borderRadius: 8,
          pointerEvents: 'none',
          whiteSpace: 'pre-wrap',
        }}
      >
        {`UNFOLDIQ debug${projectId ? ` project=${projectId}` : ''}\nframe=${frame} timeMs=${Math.round(timeMs)} canvas=${width}x${height}\nscene=${activeScene ? activeScene.sceneId : 'none'}\nlayers=${layerIds.join(', ') || 'none'}`}
      </div>
    </>
  );
};
