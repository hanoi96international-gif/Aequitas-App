// Design-Tokens der App (Neubau 2026-09-30, docs/NEUBAU_ANALYSE.md 3.6).
//
// Ruhig und serioes wie eine gute Banking-App: neutrale Flaechen, ein
// Akzent (#5B8CFF, wie aequitas.digital), Signalfarben nur fuer Bedeutung.
// Bildschirme benutzen NUR semantische Namen (surface, textSecondary, ...),
// nie Farbwerte -- so bleiben hell und dunkel ohne Sonderfaelle gleich gut.
//
// Kontrast: jede Text-/Hintergrund-Paarung hier erfuellt WCAG AA (4,5:1 fuer
// Fliesstext); geprueft in src/ui/__tests__/tokens.test.ts.

export type ColorScheme = 'light' | 'dark';

export interface Palette {
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textOnAccent: string;
  accent: string;
  accentPressed: string;
  accentSoft: string;
  positive: string;
  positiveSoft: string;
  negative: string;
  negativeSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  focus: string;
  overlay: string;
}

export const palettes: Record<ColorScheme, Palette> = {
  light: {
    bg: '#F6F7F9',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceSunken: '#EEF0F4',
    border: '#E3E6EC',
    borderStrong: '#C9CED8',
    text: '#111827',
    textSecondary: '#4B5563',
    textTertiary: '#6B7280',
    textOnAccent: '#FFFFFF',
    accent: '#2F5FD0',
    accentPressed: '#244CAA',
    accentSoft: '#E8EEFB',
    positive: '#0F7B4B',
    positiveSoft: '#E4F4EC',
    negative: '#B42318',
    negativeSoft: '#FBEAE8',
    warning: '#8A5A00',
    warningSoft: '#FDF3DD',
    info: '#1F5FAD',
    infoSoft: '#E6EFFA',
    focus: '#2F5FD0',
    overlay: 'rgba(17,24,39,0.45)',
  },
  dark: {
    bg: '#0B0D12',
    surface: '#14171F',
    surfaceRaised: '#1A1E28',
    surfaceSunken: '#0F1117',
    border: '#252A36',
    borderStrong: '#343B4B',
    text: '#EEF0F4',
    textSecondary: '#B4BBC8',
    textTertiary: '#8B93A3',
    textOnAccent: '#0B0D12',
    accent: '#7AA2FF',
    accentPressed: '#5B8CFF',
    accentSoft: '#1B2640',
    positive: '#4CC38A',
    positiveSoft: '#12291F',
    negative: '#FF8A7F',
    negativeSoft: '#331A18',
    warning: '#F2B94B',
    warningSoft: '#2E2413',
    info: '#7FB0F5',
    infoSoft: '#15233A',
    focus: '#7AA2FF',
    overlay: 'rgba(0,0,0,0.6)',
  },
};

/** 4-pt-Raster. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** Schriftstufen. Betraege mit tabellarischen Ziffern (Amount-Baustein). */
export const type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '600' as const, letterSpacing: -0.5 },
  title1: { fontSize: 26, lineHeight: 32, fontWeight: '600' as const, letterSpacing: -0.3 },
  title2: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
  title3: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const, letterSpacing: 0.2 },
} as const;

export type TypeVariant = keyof typeof type;

/** Mindestgroesse fuer beruehrbare Flaechen (WCAG 2.5.5 / Plattformrichtlinien). */
export const minTouch = 44;

export const motion = {
  fast: 120,
  normal: 200,
} as const;
