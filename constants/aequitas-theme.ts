// Design tokens mirroring aequitas.digital's actual web explorer
// (x/humanity/keeper/assets/explorer.css in the chain repo) — the app should
// read as a mini version of that site, not a separate "gold luxury" look.
export const theme = {
  bg: '#0C0E16',
  card: '#131620',
  card2: '#1A1D2B',
  border: 'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.14)',

  purple: '#9B72F6',
  teal: '#22D3EE',
  neon: '#34D399',
  gold: '#F0B429',
  red: '#F87171',
  blue: '#60A5FA',

  text: '#E8EDF5',
  muted: '#8892A4',

  gradient: ['#9B72F6', '#22D3EE'] as const,
  gradientAngle: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },

  radius: 16,
  radiusSm: 10,

  fontMono: 'monospace',
} as const;

export const purpleTint = 'rgba(155,114,246,0.08)';
export const purpleTintBorder = 'rgba(155,114,246,0.25)';
export const tealTint = 'rgba(34,211,238,0.08)';
export const tealTintBorder = 'rgba(34,211,238,0.2)';
export const neonTint = 'rgba(52,211,153,0.08)';
export const neonTintBorder = 'rgba(52,211,153,0.25)';
export const goldTint = 'rgba(240,180,41,0.08)';
export const goldTintBorder = 'rgba(240,180,41,0.3)';
export const redTint = 'rgba(248,113,113,0.08)';
export const redTintBorder = 'rgba(248,113,113,0.3)';
