import React from 'react';
import { OffthreadVideo } from 'remotion';
import { frameRangeForInterval, msToFrameStart } from '../runtime/time';
import { resolveVideoAsset } from '../runtime/assets';
import type { AssetsMap, CanvasSize, VideoLayerDef } from '../runtime/types';

export interface VideoLayerProps {
  layer: VideoLayerDef;
  assets: AssetsMap;
  fps: number;
  sceneFrame: number;
  sceneDurationFrames: number;
  canvas: CanvasSize;
}

export const VideoLayer: React.FC<VideoLayerProps> = ({
  layer,
  assets,
  fps,
  sceneFrame,
  sceneDurationFrames,
  canvas,
}) => {
  void sceneFrame;
  void sceneDurationFrames;
  void canvas;
  const src = resolveVideoAsset(assets[layer.assetId], assets);
  // Omit trims when playing the full file (startFrom/endAt must stay valid).
  const trimProps: { startFrom?: number; endAt?: number } = {};
  const trimStart = msToFrameStart(layer.trimStartMs, fps);
  if (trimStart > 0) {
    trimProps.startFrom = trimStart;
  }
  if (layer.trimEndMs > 0) {
    trimProps.endAt = frameRangeForInterval(layer.trimStartMs, layer.trimEndMs, fps).end;
  }
  const isMuted = layer.muted || layer.audioPolicy === 'MUTED';
  const tx = 0;
  const ty = 0;
  const rotation = 0;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <OffthreadVideo
        src={src}
        {...trimProps}
        volume={isMuted ? 0 : 1}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: layer.fit,
          objectPosition: `${layer.position.x * 100}% ${layer.position.y * 100}%`,
          opacity: layer.opacity,
          transform: `translate(${tx}px, ${ty}px) rotate(${rotation}deg)`,
        }}
        {...(layer.playbackRate !== undefined ? { playbackRate: layer.playbackRate } : {})}
        {...(layer.loop === true ? { loop: true } : {})}
      />
    </div>
  );
};
