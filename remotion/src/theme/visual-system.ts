// Visual system: tokens, defaults, and shared helpers for UNFOLDIQVideo.

export interface VisualSystem {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  fontFamily: string;
  titleSize: number;
  bodySize: number;
  captionSize: number;
  cornerRadius: number;
  spacing: number;
  overlayOpacity: number;
}

export const DEFAULT_VISUAL_SYSTEM: VisualSystem = {
  background: '#0b0e14',
  foreground: '#f5f7fa',
  muted: '#8a93a6',
  accent: '#4da3ff',
  fontFamily: 'system-ui, sans-serif',
  titleSize: 64,
  bodySize: 36,
  captionSize: 34,
  cornerRadius: 12,
  spacing: 24,
  overlayOpacity: 0.55,
};

// Merge caller-provided tokens over the defaults. Unknown/missing keys keep
// their default values.
export function resolveVisualSystem(
  input?: { visualSystem?: Partial<VisualSystem> } | null,
): VisualSystem {
  return { ...DEFAULT_VISUAL_SYSTEM, ...(input?.visualSystem ?? {}) };
}

// Single central dB -> linear gain helper. Input is clamped to [-60, 12] dB
// so extreme plan values can never blow out the mix or go fully denormal.
export function dbToLinearGain(db: number): number {
  if (!Number.isFinite(db)) {
    throw new Error(`RENDER_PROP_INVALID: gainDb must be finite, got ${String(db)}`);
  }
  const clamped = Math.min(12, Math.max(-60, db));
  return Math.pow(10, clamped / 20);
}

// System-only font stack. Render workers must NOT download webfonts: all
// text renders with locally available system fonts for deterministic output.
export function fontStack(): string {
  return 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
}
