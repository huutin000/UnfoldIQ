// Explanatory light-physics diagrams for the "Why is the sky blue?" canonical pilot.
// Pure SVG driven by useCurrentFrame(): no external media, no network, no licences.
// Original illustration, not evidence imagery. Design: one memorable element (glowing light),
// everything else (glass panels, soft depth, system fonts) stays quiet.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export type SkyDiagramProps = { sceneId: 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06'; frames: number };

const W = 1920;
const H = 1080;
const SPEC = ['#5b3fe0', '#2f86ff', '#2fd17f', '#ffd23f', '#ff8a24', '#f0484a'];
const FONT = '"Segoe UI", system-ui, sans-serif';

const rnd = (i: number, k = 1) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const prog = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], clamp);

const Defs: React.FC = () => (
  <defs>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="7" result="b" />
      <feMerge>
        <feMergeNode in="b" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="16" />
    </filter>
    <radialGradient id="sunG">
      <stop offset="0" stopColor="#fffdf0" />
      <stop offset="0.6" stopColor="#ffe58a" />
      <stop offset="1" stopColor="#ffbd3c" />
    </radialGradient>
    <radialGradient id="halo">
      <stop offset="0" stopColor="#fff0b8" stopOpacity="0.8" />
      <stop offset="1" stopColor="#fff0b8" stopOpacity="0" />
    </radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.45" r="0.78">
      <stop offset="0.62" stopColor="#020a1c" stopOpacity="0" />
      <stop offset="1" stopColor="#020a1c" stopOpacity="0.5" />
    </radialGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#ffffff" stopOpacity="0.2" />
      <stop offset="1" stopColor="#ffffff" stopOpacity="0.06" />
    </linearGradient>
    <radialGradient id="molN" cx="0.35" cy="0.3">
      <stop offset="0" stopColor="#e6f1ff" />
      <stop offset="1" stopColor="#5f93de" />
    </radialGradient>
    <radialGradient id="molO" cx="0.35" cy="0.3">
      <stop offset="0" stopColor="#ffe4de" />
      <stop offset="1" stopColor="#e0685c" />
    </radialGradient>
    <linearGradient id="earthG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#2c7a53" />
      <stop offset="1" stopColor="#0f3322" />
    </linearGradient>
  </defs>
);

// Gradient sky + soft light bloom + drifting dust; drawn oversized so the framing transform never exposes edges.
const Backdrop: React.FC<{ id: string; top: string; bottom: string; f: number; glowX?: number; glowY?: number }> = ({ id, top, bottom, f, glowX = 0.18, glowY = 0.25 }) => (
  <g>
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={top} />
        <stop offset="1" stopColor={bottom} />
      </linearGradient>
    </defs>
    <rect x={-200} y={-300} width={W + 400} height={H + 700} fill={`url(#${id})`} />
    <circle cx={W * glowX} cy={H * glowY} r={760} fill="url(#halo)" opacity={0.3} />
    {Array.from({ length: 28 }, (_, i) => (
      <circle
        key={i}
        cx={rnd(i, 7) * W + 14 * Math.sin(f / 40 + i)}
        cy={rnd(i, 8) * 760 + 10 * Math.cos(f / 50 + i)}
        r={1.5 + rnd(i, 9) * 2.5}
        fill="#ffffff"
        opacity={0.12 + rnd(i, 10) * 0.2}
      />
    ))}
  </g>
);

const Glass: React.FC<{ x: number; y: number; w: number; h: number; opacity?: number }> = ({ x, y, w, h, opacity = 1 }) => (
  <g opacity={opacity}>
    <rect x={x} y={y + 10} width={w} height={h} rx={30} fill="#020a1c" opacity={0.28} filter="url(#soft)" />
    <rect x={x} y={y} width={w} height={h} rx={30} fill="url(#glass)" stroke="#ffffff" strokeOpacity={0.22} strokeWidth={2} />
  </g>
);

const Label: React.FC<{ x: number; y: number; text: string; size?: number; anchor?: 'start' | 'middle' | 'end'; fill?: string; opacity?: number; weight?: number; shadow?: boolean }> = ({
  x, y, text, size = 36, anchor = 'middle', fill = '#f5f9ff', opacity = 1, weight = 600, shadow = true,
}) => (
  <text
    x={x} y={y} fontSize={size} fontFamily={FONT} fontWeight={weight} fill={fill} textAnchor={anchor} opacity={opacity}
    stroke={shadow ? '#04102a' : 'none'} strokeOpacity={0.45} strokeWidth={shadow ? 7 : 0} strokeLinejoin="round" style={{ paintOrder: 'stroke' }}
  >
    {text}
  </text>
);

const Sun: React.FC<{ x: number; y: number; r: number; t: number }> = ({ x, y, r, t }) => (
  <g>
    <circle cx={x} cy={y} r={r * (3.2 + 0.1 * Math.sin(t / 14))} fill="url(#halo)" />
    <g transform={`rotate(${t * 0.25} ${x} ${y})`} opacity={0.5}>
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1={x + Math.cos((i * Math.PI) / 6) * r * 1.35} y1={y + Math.sin((i * Math.PI) / 6) * r * 1.35} x2={x + Math.cos((i * Math.PI) / 6) * r * (i % 2 ? 1.75 : 2.05)} y2={y + Math.sin((i * Math.PI) / 6) * r * (i % 2 ? 1.75 : 2.05)} stroke="#ffe9a8" strokeWidth={7} strokeLinecap="round" />
      ))}
    </g>
    <circle cx={x} cy={y} r={r} fill="url(#sunG)" filter="url(#glow)" />
  </g>
);

const Eye: React.FC<{ x: number; y: number; s?: number }> = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-76 0 Q0 -66 76 0 Q0 66 -76 0 Z" fill="#f5f9ff" filter="url(#glow)" />
    <circle cx={0} cy={0} r={28} fill="#2f86ff" />
    <circle cx={0} cy={0} r={12} fill="#06132e" />
    <circle cx={-8} cy={-9} r={5} fill="#ffffff" opacity={0.9} />
  </g>
);

// Travelling dashes along a line (light "pulses"), with a soft glow underlay.
const Beam: React.FC<{ x1: number; y1: number; x2: number; y2: number; color: string; w: number; t: number; p?: number; opacity?: number; speed?: number }> = ({
  x1, y1, x2, y2, color, w, t, p = 1, opacity = 1, speed = 1.6,
}) => {
  const ex = x1 + (x2 - x1) * p;
  const ey = y1 + (y2 - y1) * p;
  return (
    <g opacity={opacity}>
      <line x1={x1} y1={y1} x2={ex} y2={ey} stroke={color} strokeWidth={w * 2.4} strokeLinecap="round" opacity={0.28} filter="url(#glow)" />
      <line x1={x1} y1={y1} x2={ex} y2={ey} stroke={color} strokeWidth={w} strokeLinecap="round" strokeDasharray={`${w * 3} ${w * 2}`} strokeDashoffset={-t * speed} />
    </g>
  );
};

const Molecule: React.FC<{ x: number; y: number; kind: 'N2' | 'O2'; glow?: number; scale?: number }> = ({ x, y, kind, glow = 0, scale = 1 }) => {
  const g = kind === 'N2' ? 'url(#molN)' : 'url(#molO)';
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {glow > 0 && <circle r={46} fill="#6fc0ff" opacity={0.5 * glow} filter="url(#glow)" />}
      <circle cx={-10} cy={0} r={13} fill={g} />
      <circle cx={10} cy={0} r={13} fill={g} />
    </g>
  );
};

// ---- S01: hook -----------------------------------------------------------
const S01: React.FC<{ f: number; n: number }> = ({ f }) => {
  const rays = prog(f, 10, 70);
  const q = prog(f, 90, 130);
  return (
    <g>
      <Backdrop id="s1sky" top="#1458c8" bottom="#9bd6ff" f={f} glowX={0.17} glowY={0.2} />
      <path d={`M-200 650 Q 300 560 800 640 T 1700 600 T ${W + 200} 640 L ${W + 200} ${H + 400} L-200 ${H + 400} Z`} fill="#4a93a8" opacity={0.85} />
      <path d={`M-200 720 Q 400 640 900 710 T 1800 690 T ${W + 200} 720 L ${W + 200} ${H + 400} L-200 ${H + 400} Z`} fill="#2c8461" />
      <path d={`M-200 800 Q 500 740 1000 790 T ${W + 200} 780 L ${W + 200} ${H + 400} L-200 ${H + 400} Z`} fill="#1b5a42" />
      <Sun x={330} y={190} r={80} t={f} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Beam key={i} x1={400 + i * 8} y1={240 + i * 18} x2={1150 + i * 140} y2={640 - i * 10} color="#ffffff" w={9} t={f} p={rays} opacity={0.95} />
      ))}
      <Label x={760} y={120} text="Sunlight: white" size={46} weight={700} opacity={prog(f, 25, 55)} />
      <Label x={1380} y={150} text="Sky: blue" size={46} weight={700} fill="#0a2a66" shadow={false} opacity={prog(f, 60, 90)} />
      <text x={1380} y={480} fontSize={250} fontFamily={FONT} fontWeight={800} fill="#ffffff" textAnchor="middle" opacity={q} filter="url(#glow)" transform={`translate(0 ${(1 - q) * 30})`}>?</text>
    </g>
  );
};

// ---- S02: molecules ------------------------------------------------------
const S02: React.FC<{ f: number; n: number }> = ({ f }) => {
  const enter = prog(f, 0, 50);
  const mols = Array.from({ length: 34 }, (_, i) => {
    const bx = 680 + rnd(i, 1) * 1130;
    const by = 110 + rnd(i, 2) * 440;
    const ph = rnd(i, 3) * 6.28;
    return { x: bx + 10 * Math.sin(f / 14 + ph), y: by + 10 * Math.cos(f / 17 + ph), k: (i % 3 === 0 ? 'O2' : 'N2') as 'N2' | 'O2' };
  });
  const scaleCmp = prog(f, 110, 160);
  return (
    <g>
      <Backdrop id="s2sky" top="#0a2a64" bottom="#1a5ca8" f={f} glowX={0.1} glowY={0.35} />
      <Glass x={640} y={50} w={1170} h={560} />
      <Sun x={170} y={330} r={70} t={f} />
      {[0, 1, 2].map((i) => (
        <Beam key={i} x1={250} y1={300 + i * 36} x2={660} y2={300 + i * 36} color="#ffffff" w={9} t={f} p={enter} />
      ))}
      {mols.map((m, i) => (
        <Molecule key={i} x={m.x} y={m.y} kind={m.k} />
      ))}
      <Label x={1250} y={655} text="Nitrogen (N₂) and oxygen (O₂) molecules" size={36} opacity={prog(f, 30, 60)} />
      <g opacity={scaleCmp} transform="translate(130 540)">
        <path d={Array.from({ length: 90 }, (_, i) => `${i === 0 ? 'M' : 'L'}${i * 4} ${Math.sin(i / 5.2 + f / 8) * 28}`).join(' ')} stroke="#ffffff" strokeWidth={6} fill="none" strokeLinecap="round" filter="url(#glow)" />
        <Molecule x={470} y={0} kind="N2" scale={0.55} />
        <Label x={150} y={88} text="light wave" size={32} />
        <Label x={560} y={88} text="molecule: far smaller" size={32} />
      </g>
    </g>
  );
};

// ---- S03: scattering -----------------------------------------------------
const S03: React.FC<{ f: number; n: number }> = ({ f }) => {
  const hit = prog(f, 20, 70);
  const fan = prog(f, 70, 130);
  const eye = prog(f, 220, 290);
  const cx = 520;
  const cy = 330;
  const fanDirs = [-160, -120, -75, -30, 20, 70, 120, 165].map((d) => (d * Math.PI) / 180);
  return (
    <g>
      <Backdrop id="s3sky" top="#082256" bottom="#154a92" f={f} glowX={0.06} glowY={0.3} />
      <Sun x={110} y={cy} r={62} t={f} />
      <Beam x1={190} y1={cy - 10} x2={cx - 30} y2={cy} color="#ffffff" w={14} t={f} p={hit} />
      <Molecule x={cx} y={cy} kind="N2" glow={fan} scale={2} />
      <Beam x1={cx + 40} y1={cy + 8} x2={W - 460} y2={cy + 8} color="#f0484a" w={7} t={f} p={fan} opacity={0.9} />
      {fanDirs.map((a, i) => (
        <Beam key={i} x1={cx + Math.cos(a) * 44} y1={cy + Math.sin(a) * 44} x2={cx + Math.cos(a) * 330} y2={cy + Math.sin(a) * 330} color="#4cc3ff" w={9} t={f} p={fan} />
      ))}
      <Label x={cx} y={110} text="blue: scattered strongly, every direction" size={34} opacity={fan} fill="#c4e6ff" />
      <Label x={1140} y={cy + 66} text="red: passes mostly straight" size={32} opacity={fan} fill="#ffc0c0" />
      <g transform="translate(1000 500)" opacity={prog(f, 50, 90)}>
        {SPEC.map((c, i) => (
          <rect key={i} x={i * 100} y={0} width={100} height={50} fill={c} opacity={i === 1 ? 1 : 0.5} rx={i === 0 ? 14 : i === 5 ? 14 : 0} stroke={i === 1 ? '#ffffff' : 'none'} strokeWidth={5} filter={i === 1 ? 'url(#glow)' : undefined} />
        ))}
        <Label x={300} y={100} text="short wavelength  →  long wavelength" size={30} opacity={prog(f, 60, 100)} />
      </g>
      <g opacity={eye}>
        <Eye x={1590} y={170} s={1.2} />
        {[0, 1, 2, 3, 4].map((i) => (
          <Beam key={i} x1={1000 + i * 120} y1={50 + (i % 2) * 40} x2={1520} y2={160} color="#4cc3ff" w={7} t={f} p={eye} />
        ))}
        <Label x={1560} y={310} text="blue arrives from all over the sky" size={30} fill="#c4e6ff" />
      </g>
    </g>
  );
};

// ---- S04: why not violet -------------------------------------------------
const S04: React.FC<{ f: number; n: number }> = ({ f }) => {
  const bars = [
    { label: 'Violet in sunlight', v: 0.38, c: SPEC[0] },
    { label: 'Violet scattering', v: 1.0, c: '#8a5cff' },
    { label: 'Eye sensitivity to violet', v: 0.2, c: '#b9a8ff' },
  ];
  const specDim = prog(f, 20, 60);
  return (
    <g>
      <Backdrop id="s4sky" top="#0a2a64" bottom="#174f98" f={f} glowX={0.5} glowY={0.1} />
      <g transform="translate(260 70)">
        {SPEC.map((c, i) => (
          <rect key={i} x={i * 230} y={0} width={230} height={70} fill={c} opacity={i === 0 ? 1 - 0.55 * specDim : 1} rx={i === 0 || i === 5 ? 18 : 0} />
        ))}
        <Label x={115} y={118} text="violet" size={32} />
        <Label x={1265} y={118} text="red" size={32} />
      </g>
      <Eye x={1580} y={330} s={1.5} />
      <Glass x={200} y={210} w={1180} h={400} />
      {bars.map((b, i) => {
        const p = prog(f, 50 + i * 40, 100 + i * 40);
        return (
          <g key={i} transform={`translate(250 ${250 + i * 120})`}>
            <Label x={0} y={34} text={b.label} size={32} anchor="start" />
            <rect x={470} y={0} width={680} height={48} rx={24} fill="#06193d" opacity={0.8} />
            <rect x={470} y={0} width={Math.max(0.01, 680 * b.v * p)} height={48} rx={24} fill={b.c} filter="url(#glow)" />
          </g>
        );
      })}
      <Label x={950} y={690} text="more scattering, but less light and a weaker eye response" size={34} opacity={prog(f, 170, 210)} fill="#ffd96a" />
    </g>
  );
};

// ---- S05: sunset geometry ------------------------------------------------
const S05: React.FC<{ f: number; n: number }> = ({ f }) => {
  const ex = 960;
  const ey = 1500;
  const R = 900;
  const long = prog(f, 40, 150);
  const sunX = 250;
  const sunY = 520;
  const endX = 960;
  const endY = ey - R - 2;
  const px = (t: number) => sunX + (endX - sunX) * t;
  const py = (t: number) => sunY + (endY - sunY) * t;
  const pieces = Array.from({ length: 10 }, (_, i) => i / 9);
  return (
    <g>
      <defs>
        <linearGradient id="s5sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14306a" />
          <stop offset="0.55" stopColor="#c4527a" />
          <stop offset="0.8" stopColor="#ff7a3a" />
          <stop offset="1" stopColor="#ffc15a" />
        </linearGradient>
        <radialGradient id="atmo">
          <stop offset="0.9" stopColor="#7ec3ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#7ec3ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={-200} y={-300} width={W + 400} height={H + 700} fill="url(#s5sky)" />
      <circle cx={sunX} cy={sunY} r={620} fill="url(#halo)" opacity={0.5} />
      <circle cx={ex} cy={ey} r={R + 150} fill="url(#atmo)" />
      <circle cx={ex} cy={ey} r={R} fill="url(#earthG)" />
      <Sun x={sunX} y={sunY} r={58} t={f} />
      <g opacity={prog(f, 0, 30)}>
        <Beam x1={sunX + 70} y1={sunY + 10} x2={endX} y2={endY} color="#ffffff" w={10} t={f} p={long} />
      </g>
      {pieces.map((t, i) => {
        const vis = prog(f, 60 + i * 8, 100 + i * 8) * (1 - prog(f, 170 + i * 4, 210 + i * 4));
        return <circle key={i} cx={px(t) - 20 * rnd(i, 4)} cy={py(t) - 70 - 70 * rnd(i, 5) * vis} r={10} fill="#4cc3ff" opacity={vis} filter="url(#glow)" />;
      })}
      <Label x={600} y={330} text="long path through air" size={36} opacity={prog(f, 90, 130)} />
      <g opacity={prog(f, 180, 220)}>
        <line x1={1500} y1={100} x2={1500} y2={ey - R - 2 - 20} stroke="#ffffff" strokeWidth={8} strokeDasharray="22 14" strokeLinecap="round" />
        <Label x={1500} y={70} text="midday: short path" size={32} />
      </g>
      <Label x={1130} y={250} text="blue scattered away → reds & oranges remain" size={34} opacity={prog(f, 140, 190)} fill="#ffe6c0" />
    </g>
  );
};

// ---- S06: haze + payoff --------------------------------------------------
const S06: React.FC<{ f: number; n: number }> = ({ f, n }) => {
  const split = prog(f, 0, 40);
  const t0 = n * 0.58;
  const fadeOut = prog(f, t0, t0 + 12);
  const closing = prog(f, t0 + 12, t0 + 30); // sequential swap, no overlap ghosting
  const parts = Array.from({ length: 26 }, (_, i) => ({
    x: 240 + rnd(i, 1) * 560,
    y: 130 + rnd(i, 2) * 430,
    r: 16 + rnd(i, 3) * 18,
  }));
  return (
    <g>
      <Backdrop id="s6sky" top="#0a2a64" bottom="#1a5ca8" f={f} glowX={0.5} glowY={0.3} />
      <g opacity={1 - fadeOut}>
        <rect x={120} y={80} width={1680} height={540} rx={32} fill="#020a1c" opacity={0.25 * split} filter="url(#soft)" />
        <rect x={120} y={70} width={1680} height={540} rx={32} fill="#dbe7f3" opacity={0.88 * split} />
        {parts.map((p, i) => (
          <circle key={i} cx={p.x + 8 * Math.sin(f / 15 + i)} cy={p.y + 8 * Math.cos(f / 19 + i)} r={p.r} fill="#8c93a0" opacity={0.65 * split} />
        ))}
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Beam key={i} x1={150} y1={150 + i * 70} x2={800} y2={150 + i * 70} color={SPEC[i]} w={7} t={f} p={prog(f, 10, 60)} />
        ))}
        {parts.slice(0, 14).map((p, i) => (
          <line key={i} x1={p.x} y1={p.y} x2={p.x + 100 * Math.cos(i * 1.7)} y2={p.y + 100 * Math.sin(i * 1.7)} stroke="#ffffff" strokeWidth={4} opacity={0.7 * split} />
        ))}
        <Label x={1300} y={290} text="dust & pollution scatter all colors equally" size={38} fill="#14243a" shadow={false} opacity={prog(f, 40, 80)} />
        <Label x={1300} y={354} text="→ pale, white haze" size={38} fill="#14243a" shadow={false} opacity={prog(f, 70, 110)} />
      </g>
      <g opacity={closing}>
        <Sun x={300} y={320} r={70} t={f} />
        <Beam x1={380} y1={320} x2={900} y2={320} color="#ffffff" w={14} t={f} p={closing} />
        <rect x={900} y={110} width={200} height={420} rx={34} fill="url(#glass)" stroke="#9fd2ff" strokeOpacity={0.5} strokeWidth={2} />
        <Label x={1000} y={580} text="air" size={34} />
        {SPEC.map((c, i) => (
          <Beam key={i} x1={1100} y1={320 + (i - 2.5) * 6} x2={1700} y2={320 + (i - 2.5) * 70} color={c} w={9} t={f} p={closing} />
        ))}
        <Label x={1000} y={665} text="sunlight, rearranged by the air" size={42} fill="#ffd96a" />
      </g>
    </g>
  );
};

const SCENES = { S01, S02, S03, S04, S05, S06 } as const;

export const SkyDiagram: React.FC<SkyDiagramProps> = ({ sceneId }) => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const Scene = SCENES[sceneId];
  // slow push-in per visual-bible camera language; content sits in the optical centre above the caption zone
  const z = 1.06 + 0.04 * (f / durationInFrames);
  return (
    <AbsoluteFill style={{ background: '#0a2a64' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs />
        <g transform={`translate(${(W / 2) * (1 - z)} ${380 * (1 - z) + 90}) scale(${z})`}>
          <Scene f={f} n={durationInFrames} />
        </g>
        <rect width={W} height={H} fill="url(#vig)" />
      </svg>
    </AbsoluteFill>
  );
};
