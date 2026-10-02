import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { frameRangeForInterval } from '../runtime/time';
import type { CanvasSize, CaptionItemDef, CaptionPlan } from '../runtime/types';
import type { VisualSystem } from '../theme/visual-system';

export interface CaptionTrackProps {
  captions: CaptionPlan;
  visualSystem: VisualSystem;
  fps: number;
  canvas: CanvasSize;
}

const DEFAULT_SAFE_ZONE_BOTTOM_PCT = 12;

function renderItemText(
  item: CaptionItemDef,
  frame: number,
  fps: number,
  accent: string,
): React.ReactNode {
  // Word emphasis only when measured word timings exist; otherwise the plain
  // sentence/phrase text is shown. Words are never interpolated.
  if (item.words && item.words.length > 0) {
    const words = item.words;
    return words.map((word, index) => {
      const wordRange = frameRangeForInterval(word.startMs, word.endMs, fps);
      const isActive = frame >= wordRange.start && frame < wordRange.end;
      const label = word.text ?? word.word ?? '';
      return (
        <span
          key={`${item.captionId}-w-${index}`}
          style={isActive ? { color: accent, fontWeight: 800 } : undefined}
        >
          {label}
          {index < words.length - 1 ? ' ' : ''}
        </span>
      );
    });
  }
  return item.text;
}

export const CaptionTrack: React.FC<CaptionTrackProps> = ({ captions, visualSystem, fps, canvas }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // SIDECAR captions are delivered as a sidecar file, never burned in.
  if (!captions || captions.mode === 'NONE' || captions.mode === 'SIDECAR') {
    return null;
  }
  if (frame < 0 || frame >= durationInFrames) {
    return null;
  }

  const active = captions.items.filter((item) => {
    const range = frameRangeForInterval(item.startMs, item.endMs, fps);
    return frame >= range.start && frame < range.end;
  });
  if (active.length === 0) {
    return null;
  }
  // Sentence/phrase style: show at most the two most recent active items,
  // stacked deterministically (no text measurement).
  const visible = active.slice(-2);

  const bottomPct = captions.safeZone?.bottomPct ?? DEFAULT_SAFE_ZONE_BOTTOM_PCT;
  const bottomPx = (bottomPct / 100) * canvas.height;
  const isTikTok = captions.styleGroup === 'tiktok';

  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: bottomPx,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        textAlign: 'center',
        pointerEvents: 'none',
      }}
    >
      {visible.map((item) =>
        isTikTok ? (
          <div
            key={item.captionId}
            style={{
              color: visualSystem.foreground,
              fontFamily: visualSystem.fontFamily,
              fontSize: Math.round(visualSystem.captionSize * 1.3),
              fontWeight: 800,
              lineHeight: 1.25,
              textShadow: '0 2px 12px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)',
            }}
          >
            {renderItemText(item, frame, fps, visualSystem.accent)}
          </div>
        ) : (
          <div
            key={item.captionId}
            style={{
              color: visualSystem.foreground,
              fontFamily: visualSystem.fontFamily,
              fontSize: visualSystem.captionSize,
              fontWeight: 500,
              lineHeight: 1.3,
              backgroundColor: `rgba(0, 0, 0, ${visualSystem.overlayOpacity})`,
              padding: `${visualSystem.spacing / 2}px ${visualSystem.spacing}px`,
              borderRadius: visualSystem.cornerRadius,
            }}
          >
            {renderItemText(item, frame, fps, visualSystem.accent)}
          </div>
        ),
      )}
    </div>
  );
};
