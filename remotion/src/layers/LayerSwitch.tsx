import React from 'react';
import { Sequence } from 'remotion';
import { frameRangeForInterval } from '../runtime/time';
import { ImageLayer } from './ImageLayer';
import { VideoLayer } from './VideoLayer';
import { TextLayer } from './TextLayer';
import { ShapeLayer, shapeFillToCss } from './ShapeLayer';
import type { AssetsMap, CanvasSize, LayerDef, LayerKind } from '../runtime/types';
import type { VisualSystem } from '../theme/visual-system';

export type { LayerKind };

export interface LayerSwitchProps {
  layer: LayerDef;
  assets: AssetsMap;
  visualSystem: VisualSystem;
  fps: number;
  sceneFrame: number;
  sceneDurationFrames: number;
  canvas: CanvasSize;
}

export const LayerSwitch: React.FC<LayerSwitchProps> = ({
  layer,
  assets,
  visualSystem,
  fps,
  sceneFrame,
  sceneDurationFrames,
  canvas,
}) => {
  switch (layer.kind) {
    case 'IMAGE':
      return (
        <ImageLayer
          layer={layer}
          assets={assets}
          fps={fps}
          sceneFrame={sceneFrame}
          sceneDurationFrames={sceneDurationFrames}
          canvas={canvas}
        />
      );
    case 'VIDEO':
      return (
        <VideoLayer
          layer={layer}
          assets={assets}
          fps={fps}
          sceneFrame={sceneFrame}
          sceneDurationFrames={sceneDurationFrames}
          canvas={canvas}
        />
      );
    case 'TEXT':
      return (
        <TextLayer
          layer={layer}
          visualSystem={visualSystem}
          fps={fps}
          sceneFrame={sceneFrame}
          sceneDurationFrames={sceneDurationFrames}
          canvas={canvas}
        />
      );
    case 'SHAPE':
      return <ShapeLayer layer={layer} canvas={canvas} />;
    case 'BACKGROUND':
      return (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: shapeFillToCss(layer.fill),
          }}
        />
      );
    case 'GROUP':
      return (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: layer.opacity ?? 1,
          }}
        >
          {layer.children.map((child) => {
            const childRange = frameRangeForInterval(child.startMs, child.endMs, fps);
            return (
              <Sequence
                key={child.layerId}
                from={childRange.start}
                durationInFrames={Math.max(1, childRange.end - childRange.start)}
                name={child.layerId}
              >
                <LayerSwitch
                  layer={child}
                  assets={assets}
                  visualSystem={visualSystem}
                  fps={fps}
                  sceneFrame={sceneFrame}
                  sceneDurationFrames={sceneDurationFrames}
                  canvas={canvas}
                />
              </Sequence>
            );
          })}
        </div>
      );
    default: {
      const unknownId = (layer as { layerId?: unknown }).layerId;
      throw new Error(
        `RENDER_PROP_INVALID: unknown layer kind for layer '${String(unknownId)}'`,
      );
    }
  }
};
