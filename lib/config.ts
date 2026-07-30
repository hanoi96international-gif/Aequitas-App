// Overridable via EXPO_PUBLIC_* env vars (e.g. an .env.staging loaded at
// build time) so a staging backend can be targeted without editing source.
// Unset in every build today, so production behavior is unchanged.
// `??` is deliberately NOT used here. It falls back only on null/undefined,
// and the value that actually arrives is neither: the APK workflow maps every
// EXPO_PUBLIC_* secret into the job env, so a secret nobody has set arrives as
// an empty string. babel-preset-expo then inlines that empty string into this
// module at transform time, `??` sees a defined value, and the app ships with
// API_BASE === '' -- every request going to a relative empty base. An empty
// URL is never a meaningful override, so treat it as absent.
const orDefault = (value: string | undefined, fallback: string) =>
  value && value.trim() !== '' ? value : fallback;

export const API_BASE = orDefault(process.env.EXPO_PUBLIC_API_BASE, 'https://aequitas.digital/api');
export const WEBAPP = orDefault(process.env.EXPO_PUBLIC_WEBAPP, 'https://aequitas.digital');
export const RPC_URL = orDefault(process.env.EXPO_PUBLIC_RPC_URL, 'https://aequitas.digital/rpc');

export const CHAIN_ID_HEX = '0x786';
export const CHAIN_ID_DEC = 1926;
export const V7_CONTRACT = '0x20D271028f32577FCd07b4583A8e0E4eBBdB4F78';

export const NATIVE_CURRENCY = { name: 'Aequitas', symbol: 'AEQ', decimals: 18 } as const;

export const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

// Phase 0 biometric proof-of-personhood (palm+face matching, see
// aequitas-biometric-beta). Defaults OFF/empty -- unset in every build
// today, so the Identity tab's existing device-secret flow (and its "your
// biometric data never leaves this device" copy, which is true for THAT
// flow) is completely unchanged unless this is explicitly turned on. Do
// not enable before Phase 0 accuracy validation and Phase 2 legal review
// are actually done, not just this code being merged.
export const BIOMETRIC_ENABLED = process.env.EXPO_PUBLIC_BIOMETRIC_ENABLED === 'true';
export const COORDINATOR_BASE = process.env.EXPO_PUBLIC_COORDINATOR_BASE ?? '';
