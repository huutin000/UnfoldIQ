import React from 'react';
import { Img, interpolate } from 'remotion';
import { frameRangeForInterval } from '../runtime/time';
import { resolveImageAsset } from '../runtime/assets';
import type { AssetsMap, CanvasSize, ImageLayerDef } from '../runtime/types';

export interface ImageLayerProps {
  layer: ImageLayerDef;
  assets: AssetsMap;
  fps: number;
  sceneFrame: number;
  sceneDurationFrames: number;
  canvas: CanvasSize;
}

// Pan amplitude as a fraction of canvas size (deterministic, fps-driven).
const PAN_FRACTION = 0.06;
const ZOOM_END_SCALE = 1.08;

export const ImageLayer: React.FC<ImageLayerProps> = ({
  layer,
  assets,
  fps,
  sceneFrame,
  sceneDurationFrames,
  canvas,
}) => {
  void sceneDurationFrames;
  const src = resolveImageAsset(assets[layer.assetId], assets);
  const range = frameRangeForInterval(layer.startMs, layer.endMs, fps);
  const layerFrames = Math.max(1, range.end - range.start);
  const localFrame = Math.min(
    Math.max(0, sceneFrame - range.start),
    Math.max(0, layerFrames - 1),
  );
  const progress = interpolate(localFrame, [0, Math.max(1, layerFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const baseScale = layer.scale ?? 1;
  let motionScale = 1;
  let motionX = 0;
  let motionY = 0;
  switch (layer.motion) {
    case 'SLOW_ZOOM_IN':
      motionScale = interpolate(progress, [0, 1], [1, ZOOM_END_SCALE]);
      break;
    case 'SLOW_ZOOM_OUT':
      motionScale = interpolate(progress, [0, 1], [ZOOM_END_SCALE, 1]);
      break;
    case 'PAN_LEFT':
      motionX = interpolate(progress, [0, 1], [0, -PAN_FRACTION * canvas.width]);
      break;
    case 'PAN_RIGHT':
      motionX = interpolate(progress, [0, 1], [0, PAN_FRACTION * canvas.width]);
      break;
    case 'PAN_UP':
      motionY = interpolate(progress, [0, 1], [0, -PAN_FRACTION * canvas.height]);
      break;
    case 'PAN_DOWN':
      motionY = interpolate(progress, [0, 1], [0, PAN_FRACTION * canvas.height]);
      break;
    case 'CUSTOM': {
      const params = layer.motionParams;
      if (params) {
        const axis = params.axis ?? 'both';
        if (axis === 'both') {
          motionScale = interpolate(progress, [0, 1], [params.from, params.to]);
        } else if (axis === 'x') {
          motionX = interpolate(progress, [0, 1], [params.from * canvas.width, params.to * canvas.width]);
        } else {
          motionY = interpolate(progress, [0, 1], [params.from * canvas.height, params.to * canvas.height]);
        }
      }
      break;
    }
    case 'NONE':
    default:
      break;
  }

  const scale = baseScale * motionScale;
  const tx = (layer.translate?.x ?? 0) + motionX;
  const ty = (layer.translate?.y ?? 0) + motionY;
  const rotation = layer.rotation ?? 0;
  const objectPosition = `${layer.position.x * 100}% ${layer.position.y * 100}%`;
  const withBackgroundFill = layer.fit === 'contain' && layer.treatment?.backgroundFill === true;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {withBackgroundFill ? (
        <Img
          src={src}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition,
            filter: 'blur(24px) brightness(0.6)',
            transform: 'scale(1.1)',
          }}
        />
      ) : null}
      <Img
        src={src}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: layer.fit,
          objectPosition,
          opacity: layer.opacity,
          transform: `translate(${tx}px, ${ty}px) scale(${scale}) rotate(${rotation}deg)`,
        }}
      />
    </div>
  );
};
