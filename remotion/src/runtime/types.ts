// Shared render-input types for UNFOLDIQVideo (STEP-12 Branch B / Remotion TSX).
// Mirrors the render-input prop shape built by the Node branch.
// Scene-local timing: every layer's startMs/endMs are relative to its scene.

import type { VisualSystem } from '../theme/visual-system';

export type { VisualSystem };

export type FitMode = 'cover' | 'contain';

export type MotionPreset =
  | 'NONE'
  | 'SLOW_ZOOM_IN'
  | 'SLOW_ZOOM_OUT'
  | 'PAN_LEFT'
  | 'PAN_RIGHT'
  | 'PAN_UP'
  | 'PAN_DOWN'
  | 'CUSTOM';

export type TransitionType = 'CUT' | 'FADE' | 'SLIDE';

export type LayerKind =
  | 'IMAGE'
  | 'VIDEO'
  | 'TEXT'
  | 'SHAPE'
  | 'BACKGROUND'
  | 'GROUP';

export interface FocalPoint {
  x: number;
  y: number;
}

export interface TranslatePx {
  x: number;
  y: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface ImageLayerDef {
  layerId: string;
  kind: 'IMAGE';
  assetId: string;
  fit: FitMode;
  position: FocalPoint;
  opacity: number;
  scale?: number;
  translate?: TranslatePx;
  rotation?: number;
  motion: MotionPreset;
  motionParams?: { from: number; to: number; axis?: 'x' | 'y' | 'both' };
  treatment?: { backgroundFill?: boolean };
  startMs: number;
  endMs: number;
}

export interface VideoLayerDef {
  layerId: string;
  kind: 'VIDEO';
  assetId: string;
  fit: FitMode;
  position: FocalPoint;
  opacity: number;
  trimStartMs: number;
  trimEndMs: number;
  muted: boolean;
  audioPolicy: string;
  playbackRate?: number;
  loop?: boolean;
  startMs: number;
  endMs: number;
}

export type TypographyToken = 'title' | 'body' | 'caption';
export type TextEnterExit = 'NONE' | 'FADE' | 'SLIDE_UP';

export interface TextLayerDef {
  layerId: string;
  kind: 'TEXT';
  text: string;
  position: { xPct: number; yPct: number };
  widthPct?: number;
  align: 'left' | 'center' | 'right';
  typographyToken?: TypographyToken;
  fontSize?: number;
  weight?: number | string;
  lineHeight?: number | string;
  color?: string;
  opacity?: number;
  enter?: TextEnterExit;
  exit?: TextEnterExit;
  startMs: number;
  endMs: number;
}

export type ShapeFill =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle?: number };

export interface ShapeLayerDef {
  layerId: string;
  kind: 'SHAPE';
  shape: 'rect' | 'circle' | 'line';
  fill: ShapeFill;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  cornerRadius?: number;
  opacity?: number;
  startMs: number;
  endMs: number;
}

export interface BackgroundLayerDef {
  layerId: string;
  kind: 'BACKGROUND';
  fill: ShapeFill | string;
  startMs: number;
  endMs: number;
}

export interface GroupLayerDef {
  layerId: string;
  kind: 'GROUP';
  children: LayerDef[];
  opacity?: number;
  startMs: number;
  endMs: number;
}

export type LayerDef =
  | ImageLayerDef
  | VideoLayerDef
  | TextLayerDef
  | ShapeLayerDef
  | BackgroundLayerDef
  | GroupLayerDef;

export interface AssetEntry {
  assetId: string;
  type: 'image' | 'video' | 'audio';
  stagedPath: string;
  staticFilePath?: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export type AssetsMap = Record<string, AssetEntry>;

export interface AudioClipDef {
  clipId: string;
  path: string;
  fromMs: number;
  trimStartMs: number;
  trimEndMs: number;
  gainDb?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  loop?: boolean;
  playbackRate?: number;
}

export interface DuckingRange {
  fromMs: number;
  toMs: number;
}

export interface DuckingDef {
  enabled: boolean;
  targetAudioId?: string;
  reductionDb: number;
  ranges: DuckingRange[];
}

export interface AudioPlan {
  voice: AudioClipDef[];
  music: AudioClipDef[];
  sfx: AudioClipDef[];
  ducking?: DuckingDef;
  generatedClipAudioPolicy?: string;
}

export interface CaptionWordDef {
  text?: string;
  word?: string;
  startMs: number;
  endMs: number;
}

export interface CaptionItemDef {
  captionId: string;
  startMs: number;
  endMs: number;
  text: string;
  words?: CaptionWordDef[];
}

export interface CaptionPlan {
  mode: 'NONE' | 'SIDECAR' | 'BURNED_IN' | 'BOTH';
  items: CaptionItemDef[];
  safeZone?: { bottomPct?: number; topPct?: number };
  styleGroup?: string;
}

export interface SceneTransition {
  type: TransitionType;
  durationMs?: number;
}

export interface SceneDef {
  sceneId: string;
  startMs: number;
  endMs: number;
  durationMs?: number;
  background: string;
  layers: LayerDef[];
  transition: SceneTransition;
  overlapMs?: number;
}

export interface CompositionDef {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationMs?: number;
  durationInFrames?: number;
  background: string;
  outputName?: string;
}

export interface TimelineDef {
  actualTimelineEndMs: number;
  sources: unknown[];
}

export interface UnfoldiqRenderInput {
  version?: string;
  projectId: string;
  platform: string;
  composition: CompositionDef;
  timeline: TimelineDef;
  scenes: SceneDef[];
  assets: AssetsMap;
  audio: AudioPlan;
  captions: CaptionPlan;
  visualSystem?: Partial<VisualSystem>;
  provenance?: Record<string, unknown>;
  status: string;
  debug?: boolean;
}
