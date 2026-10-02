import React from 'react';
import { interpolate } from 'remotion';
import { frameRangeForInterval } from '../runtime/time';
import type { CanvasSize, TextLayerDef } from '../runtime/types';
import type { VisualSystem } from '../theme/visual-system';

export interface TextLayerProps {
  layer: TextLayerDef;
  visualSystem: VisualSystem;
  fps: number;
  sceneFrame: number;
  sceneDurationFrames: number;
  canvas: CanvasSize;
}

const ENTER_EXIT_SECONDS = 0.35;
const SLIDE_DISTANCE_PX = 24;

export const TextLayer: React.FC<TextLayerProps> = ({
  layer,
  visualSystem,
  fps,
  sceneFrame,
  sceneDurationFrames,
  canvas,
}) => {
  void sceneDurationFrames;
  void canvas;
  const tokenSize =
    layer.typographyToken === 'title'
      ? visualSystem.titleSize
      : layer.typographyToken === 'caption'
        ? visualSystem.captionSize
        : visualSystem.bodySize;
  const fontSize = layer.fontSize ?? tokenSize;
  const defaultWeight =
    layer.typographyToken === 'title' ? 800 : layer.typographyToken === 'caption' ? 500 : 400;

  const range = frameRangeForInterval(layer.startMs, layer.endMs, fps);
  const layerFrames = Math.max(1, range.end - range.start);
  const localFrame = Math.min(
    Math.max(0, sceneFrame - range.start),
    Math.max(0, layerFrames - 1),
  );
  const animFrames = Math.max(1, Math.round(fps * ENTER_EXIT_SECONDS));

  let enterOpacity = 1;
  let enterY = 0;
  if (layer.enter === 'FADE') {
    enterOpacity = interpolate(localFrame, [0, animFrames], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  } else if (layer.enter === 'SLIDE_UP') {
    enterOpacity = interpolate(localFrame, [0, animFrames], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    enterY = interpolate(localFrame, [0, animFrames], [SLIDE_DISTANCE_PX, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  }

  let exitOpacity = 1;
  let exitY = 0;
  const exitStart = Math.max(0, layerFrames - animFrames);
  if (layer.exit === 'FADE') {
    exitOpacity = interpolate(localFrame, [exitStart, layerFrames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  } else if (layer.exit === 'SLIDE_UP') {
    exitOpacity = interpolate(localFrame, [exitStart, layerFrames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    exitY = interpolate(localFrame, [exitStart, layerFrames], [0, -SLIDE_DISTANCE_PX], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  }

  const opacity = (layer.opacity ?? 1) * enterOpacity * exitOpacity;
  const translateY = enterY + exitY;
  // position.xPct is the horizontal CENTER anchor: offset by half width so
  // centered text never overflows the right canvas edge.
  const translateX = '-50%';
  const transformParts = [`translateX(${translateX})`];
  if (translateY !== 0) {
    transformParts.push(`translateY(${translateY}px)`);
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: `${layer.position.xPct}%`,
        top: `${layer.position.yPct}%`,
        width: layer.widthPct !== undefined ? `${layer.widthPct}%` : 'auto',
        textAlign: layer.align,
        color: layer.color ?? visualSystem.foreground,
        fontFamily: visualSystem.fontFamily,
        fontSize,
        fontWeight: layer.weight ?? defaultWeight,
        lineHeight: layer.lineHeight ?? 1.25,
        opacity,
        transform: transformParts.join(' '),
      }}
    >
      {layer.text}
    </div>
  );
};
