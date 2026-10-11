// Pure timeline math for the data-driven diagram engine. No React, no Remotion:
// the same file is imported by the renderer and by node tests.

// A number is constant; an array is [seconds, value] keyframes eased with smoothstep.
export type Track = number | Array<[number, number]>;

export function valueAt(track: Track, t: number): number {
  if (typeof track === 'number') return track;
  if (track.length === 0) return 0;
  if (t <= track[0][0]) return track[0][1];
  for (let i = 1; i < track.length; i += 1) {
    if (t <= track[i][0]) {
      const [t0, a] = track[i - 1];
      const [t1, b] = track[i];
      const k = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      return a + (b - a) * (k * k * (3 - 2 * k));
    }
  }
  return track[track.length - 1][1];
}

export function isVisible(show: [number, number?] | undefined, t: number): boolean {
  if (!show) return true;
  return t >= show[0] && (show[1] === undefined || t < show[1]);
}
