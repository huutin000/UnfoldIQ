import React from 'react';
import { Sequence } from 'remotion';
import { durationMsToFrames, msToFrameStart } from '../runtime/time';
import { Scene } from './Scene';
import type { AssetsMap, CanvasSize, SceneDef } from '../runtime/types';
import type { VisualSystem } from '../theme/visual-system';

export interface SceneTimelineProps {
  scenes: SceneDef[];
  assets: AssetsMap;
  visualSystem: VisualSystem;
  fps: number;
  canvas: CanvasSize;
}

export const SceneTimeline: React.FC<SceneTimelineProps> = ({
  scenes,
  assets,
  visualSystem,
  fps,
  canvas,
}) => {
  return (
    <>
      {scenes.map((scene) => {
        const durationMs = scene.durationMs ?? scene.endMs - scene.startMs;
        // Total duration is unchanged by overlaps: it always comes from the
        // scene's own duration. An explicit overlapMs only shifts the start
        // earlier so the incoming transition can crossfade over the outgoing
        // scene.
        const durationInFrames = Math.max(1, durationMsToFrames(durationMs, fps));
        const from = msToFrameStart(Math.max(0, scene.startMs - (scene.overlapMs ?? 0)), fps);
        return (
          <Sequence
            key={scene.sceneId}
            from={from}
            durationInFrames={durationInFrames}
            name={scene.sceneId}
          >
            <Scene
              scene={scene}
              assets={assets}
              visualSystem={visualSystem}
              fps={fps}
              canvas={canvas}
            />
          </Sequence>
        );
      })}
    </>
  );
};
