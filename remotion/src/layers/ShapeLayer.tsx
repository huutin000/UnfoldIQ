import React from 'react';
import type { CanvasSize, ShapeFill, ShapeLayerDef } from '../runtime/types';

export interface ShapeLayerProps {
  layer: ShapeLayerDef;
  canvas: CanvasSize;
}

export function shapeFillToCss(fill: ShapeFill | string): string {
  if (typeof fill === 'string') {
    return fill;
  }
  if (fill.kind === 'gradient') {
    return `linear-gradient(${fill.angle ?? 90}deg, ${fill.from}, ${fill.to})`;
  }
  return fill.color;
}

export const ShapeLayer: React.FC<ShapeLayerProps> = ({ layer, canvas }) => {
  const background = shapeFillToCss(layer.fill);
  const opacity = layer.opacity ?? 1;

  if (layer.shape === 'line') {
    const scale = canvas.height / 1080;
    return (
      <div
        style={{
          position: 'absolute',
          left: `${layer.xPct}%`,
          top: `${layer.yPct}%`,
          width: `${layer.wPct}%`,
          height: `${2 * scale}px`,
          background,
          borderRadius: 1,
          opacity,
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: `${layer.xPct}%`,
        top: `${layer.yPct}%`,
        width: `${layer.wPct}%`,
        height: `${layer.hPct}%`,
        background,
        borderRadius: layer.shape === 'circle' ? '50%' : (layer.cornerRadius ?? 0),
        opacity,
      }}
    />
  );
};
