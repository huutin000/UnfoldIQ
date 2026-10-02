import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { durationMsToFrames, frameRangeForInterval } from '../runtime/time';
import { LayerSwitch } from '../layers/LayerSwitch';
import type { AssetsMap, CanvasSize, SceneDef } from '../runtime/types';
import type { VisualSystem } from '../theme/visual-system';

export interface SceneProps {
  scene: SceneDef;
  assets: AssetsMap;
  visualSystem: VisualSystem;
  fps: number;
  canvas: CanvasSize;
}

export const Scene: React.FC<SceneProps> = ({ scene, assets, visualSystem, fps, canvas }) => {
  const sceneFrame = useCurrentFrame();
  const sceneDurationMs = scene.durationMs ?? scene.endMs - scene.startMs;
  const sceneLen = Math.max(1, durationMsToFrames(sceneDurationMs, fps));

  const transition = scene.transition;
  const transitionMs = transition?.durationMs ?? 0;
  const transitionFrames =
    transitionMs > 0 ? Math.max(1, durationMsToFrames(transitionMs, fps)) : 0;

  let opacity = 1;
  let transform: string | undefined;
  if (transition?.type === 'FADE' && transitionFrames > 0) {
    const span = Math.min(transitionFrames, sceneLen);
    opacity = interpolate(sceneFrame, [0, span], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  } else if (transition?.type === 'SLIDE' && transitionFrames > 0) {
    const span = Math.min(transitionFrames, sceneLen);
    opacity = interpolate(sceneFrame, [0, span], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const x = interpolate(sceneFrame, [0, span], [canvas.width * 0.08, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    transform = `translateX(${x}px)`;
  }
  // CUT (or zero-duration transition): no opacity/transform treatment.

  return (
    <AbsoluteFill
      style={{
        background: scene.background,
        overflow: 'hidden',
        opacity,
        ...(transform !== undefined ? { transform } : {}),
      }}
    >
      {scene.layers.map((layer, index) => {
        const range = frameRangeForInterval(layer.startMs, layer.endMs, fps);
        return (
          <Sequence
            key={layer.layerId}
            from={range.start}
            durationInFrames={Math.max(1, range.end - range.start)}
            name={layer.layerId}
          >
            <div style={{ position: 'absolute', inset: 0, zIndex: index }}>
              <LayerSwitch
                layer={layer}
                assets={assets}
                visualSystem={visualSystem}
                fps={fps}
                sceneFrame={sceneFrame}
                sceneDurationFrames={sceneLen}
                canvas={canvas}
              />
            </div>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
