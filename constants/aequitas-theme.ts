// Design tokens mirroring aequitas.digital — the landing page's :root block
// (x/humanity/keeper/landing.go in the chain repo) and the explorer's
// (x/humanity/keeper/assets/explorer.css). The app should read as a mini
// version of that site, not a separate look.
//
// Seit dem Website-Relaunch (September 2026) ist die Seite einfarbig im
// Akzent: --accent, --purple, --teal und --blue sind dort alle #5B8CFF, der
// Verlauf geht von Blau nach Gruen. Die Schluessel purple/teal/blue bleiben
// hier bestehen, damit die Bildschirme unveraendert darauf zeigen koennen --
// sie tragen jetzt dieselben Werte wie die Website.
export const theme = {
  bg: '#0B0D14',
  card: '#12151F',
  card2: '#181C28',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',

  accent: '#5B8CFF',
  purple: '#5B8CFF',
  teal: '#5B8CFF',
  blue: '#5B8CFF',
  neon: '#3DDC97',
  gold: '#F5A524',
  red: '#FF6B6B',

  text: '#E8EAF0',
  muted: '#9AA3B5',

  gradient: ['#5B8CFF', '#3DDC97'] as const,
  // Hauptknoepfe wie .btn-primary der Website: Akzent Blau, kaum Verlauf.
  // Der Blau-Gruen-Verlauf bleibt Logo, Schrittkreisen und aktiven Chips.
  buttonGradient: ['#5B8CFF', '#4F7EF2'] as const,
  gradientAngle: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },

  radius: 16,
  radiusSm: 12,
  radiusPill: 999,

  fontMono: 'monospace',
} as const;

export const purpleTint = 'rgba(91,140,255,0.10)';
export const purpleTintBorder = 'rgba(91,140,255,0.32)';
export const tealTint = 'rgba(91,140,255,0.08)';
export const tealTintBorder = 'rgba(91,140,255,0.25)';
export const neonTint = 'rgba(61,220,151,0.10)';
export const neonTintBorder = 'rgba(61,220,151,0.30)';
export const goldTint = 'rgba(245,165,36,0.12)';
export const goldTintBorder = 'rgba(245,165,36,0.35)';
export const redTint = 'rgba(255,107,107,0.10)';
export const redTintBorder = 'rgba(255,107,107,0.35)';
