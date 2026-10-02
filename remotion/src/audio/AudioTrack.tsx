import React from 'react';
import { Audio, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { durationMsToFrames, frameRangeForInterval, msToFrameStart } from '../runtime/time';
import { resolveAudioPath } from '../runtime/assets';
import { dbToLinearGain } from '../theme/visual-system';
import type { AssetsMap, AudioClipDef, DuckingDef } from '../runtime/types';

export interface AudioTrackProps {
  audio: {
    voice: AudioClipDef[];
    music: AudioClipDef[];
    sfx: AudioClipDef[];
    ducking?: DuckingDef;
    generatedClipAudioPolicy?: string;
  };
  assets: AssetsMap;
  fps: number;
}

function clipDurationFrames(clip: AudioClipDef, fps: number): number {
  // Play range: [trimStartMs, trimEndMs] when an explicit trim end exists,
  // otherwise [trimStartMs, durationMs] (full source). Never silent 1-frame clips.
  const start = Math.max(0, clip.trimStartMs ?? 0);
  const explicitEnd = clip.trimEndMs > 0 ? clip.trimEndMs : clip.durationMs;
  if (!(explicitEnd > start)) {
    throw new Error(
      `RENDER_PROP_INVALID: audio clip ${clip.clipId} has no playable range (trimEndMs=${clip.trimEndMs}, durationMs=${clip.durationMs})`
    );
  }
  const end = explicitEnd;
  return Math.max(1, durationMsToFrames(end - start, fps));
}

interface RenderedClipProps {
  clip: AudioClipDef;
  assets: AssetsMap;
  fps: number;
  ducking?: DuckingDef;
  fromFrame: number;
  totalFrames: number;
}

const RenderedClip: React.FC<RenderedClipProps> = ({
  clip,
  assets,
  fps,
  ducking,
  fromFrame,
  totalFrames,
}) => {
  // Clip-local frame (this component always renders inside its Sequence).
  const frame = useCurrentFrame();
  const src = resolveAudioPath(clip.path, assets);

  const base = dbToLinearGain(clip.gainDb ?? 0);

  const fadeInMs = clip.fadeInMs ?? 0;
  const fadeInFrames = fadeInMs > 0 ? Math.max(1, durationMsToFrames(fadeInMs, fps)) : 0;
  const fadeIn =
    fadeInFrames > 0
      ? interpolate(frame, [0, fadeInFrames], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;

  const fadeOutMs = clip.fadeOutMs ?? 0;
  const fadeOutFrames = fadeOutMs > 0 ? Math.max(1, durationMsToFrames(fadeOutMs, fps)) : 0;
  const fadeOut =
    fadeOutFrames > 0
      ? interpolate(frame, [Math.max(0, totalFrames - fadeOutFrames), totalFrames], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;

  // Ducking uses measured plan ranges only; no speech detection.
  let duck = 1;
  if (ducking?.enabled && ducking.ranges) {
    const globalFrame = frame + fromFrame;
    const inside = ducking.ranges.some((range) => {
      const start = msToFrameStart(range.fromMs, fps);
      const end = frameRangeForInterval(range.fromMs, range.toMs, fps).end;
      return globalFrame >= start && globalFrame < end;
    });
    if (inside) {
      duck = dbToLinearGain(-Math.abs(ducking.reductionDb));
    }
  }

  const trimStart = msToFrameStart(clip.trimStartMs, fps);
  // Remotion requires positive trim values; omit trims when playing the full file.
  // trimAfter = frames cut off the END of the source = sourceFrames - trimEndFrames.
  const trimProps: { trimBefore?: number; trimAfter?: number } = {};
  if (trimStart > 0) {
    trimProps.trimBefore = trimStart;
  }
  if (clip.trimEndMs > 0 && clip.durationMs > clip.trimEndMs) {
    trimProps.trimAfter = Math.max(1, durationMsToFrames(clip.durationMs - clip.trimEndMs, fps));
  }

  return (
    <Audio
      src={src}
      {...trimProps}
      volume={base * fadeIn * fadeOut * duck}
      playbackRate={clip.playbackRate ?? 1}
      {...(clip.loop === true ? { loop: true } : {})}
    />
  );
};

export const AudioTrack: React.FC<AudioTrackProps> = ({ audio, assets, fps }) => {
  if (!audio) {
    return null;
  }
  const groups: { clips: AudioClipDef[]; ducking?: DuckingDef }[] = [
    { clips: audio.voice ?? [] },
    // Ducking applies to the music bed only.
    { clips: audio.music ?? [], ducking: audio.ducking },
    { clips: audio.sfx ?? [] },
  ];
  return (
    <>
      {groups.flatMap((group) =>
        group.clips.map((clip) => {
          const fromFrame = msToFrameStart(clip.fromMs, fps);
          const totalFrames = clipDurationFrames(clip, fps);
          return (
            <Sequence
              key={clip.clipId}
              from={fromFrame}
              durationInFrames={totalFrames}
              name={clip.clipId}
            >
              <RenderedClip
                clip={clip}
                assets={assets}
                fps={fps}
                ducking={group.ducking}
                fromFrame={fromFrame}
                totalFrames={totalFrames}
              />
            </Sequence>
          );
        }),
      )}
    </>
  );
};
