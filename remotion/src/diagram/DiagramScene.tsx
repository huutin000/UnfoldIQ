// Data-driven SVG diagram scene: one component renders any DiagramSpec (JSON),
// so new explainer scenes are specs, not new React components.
// Original illustration; no external media.

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { isVisible, Track, valueAt } from './track';

type Common = { id: string; show?: [number, number?]; opacity?: Track };
type Stroke = { stroke?: string; strokeWidth?: Track; dash?: boolean; draw?: Track };

export type DiagramElement =
  | (Common & Stroke & { type: 'circle'; cx: Track; cy: Track; r: Track; fill?: string })
  | (Common & Stroke & { type: 'line'; x1: Track; y1: Track; x2: Track; y2: Track })
  | (Common & Stroke & { type: 'rect'; x: Track; y: Track; w: Track; h: Track; rx?: number; fill?: string })
  | (Common & Stroke & { type: 'path'; d: string; fill?: string })
  | (Common & { type: 'text'; x: Track; y: Track; text: string; size?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number });

export type DiagramSpec = {
  version: 1;
  durationSec: number;
  background?: string;
  palette?: Record<string, string>;
  elements: DiagramElement[];
};

export type DiagramSceneProps = { spec: DiagramSpec };

const W = 1920;
const H = 1080;
const FONT = '"Segoe UI", system-ui, sans-serif';

export const DiagramScene: React.FC<DiagramSceneProps> = ({ spec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const col = (c?: string) => (c && spec.palette?.[c]) || c;
  const v = (x: Track | undefined, d = 0) => (x === undefined ? d : valueAt(x, t));

  return (
    <AbsoluteFill style={{ background: col(spec.background) ?? '#0b1424' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }}>
        {spec.elements.map((el) => {
          if (!isVisible(el.show, t)) return null;
          const opacity = v(el.opacity, 1);
          const common = { key: el.id, opacity } as const;
          if (el.type === 'text') {
            return (
              <text {...common} x={v(el.x)} y={v(el.y)} fill={col(el.fill) ?? '#f5f7fa'} fontSize={el.size ?? 40}
                fontFamily={FONT} fontWeight={el.weight ?? 600} textAnchor={el.anchor ?? 'start'}>
                {el.text}
              </text>
            );
          }
          const draw = el.draw === undefined ? 1 : valueAt(el.draw, t);
          const stroke = {
            stroke: col(el.stroke) ?? 'none',
            strokeWidth: v(el.strokeWidth, 3),
            strokeLinecap: 'round' as const,
            pathLength: 1,
            strokeDasharray: el.draw === undefined ? (el.dash ? '0.02 0.02' : undefined) : `${draw} 1`,
          };
          const fill = 'fill' in el ? (col(el.fill) ?? 'none') : 'none';
          switch (el.type) {
            case 'circle':
              return <circle {...common} cx={v(el.cx)} cy={v(el.cy)} r={Math.max(0, v(el.r))} fill={fill} {...stroke} />;
            case 'line':
              return <line {...common} x1={v(el.x1)} y1={v(el.y1)} x2={v(el.x2)} y2={v(el.y2)} {...stroke} />;
            case 'rect':
              return <rect {...common} x={v(el.x)} y={v(el.y)} width={Math.max(0, v(el.w))} height={Math.max(0, v(el.h))} rx={el.rx ?? 0} fill={fill} {...stroke} />;
            case 'path':
              return <path {...common} d={el.d} fill={fill} {...stroke} />;
            default:
              return null;
          }
        })}
      </svg>
    </AbsoluteFill>
  );
};
