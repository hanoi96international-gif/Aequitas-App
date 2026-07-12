// Overridable via EXPO_PUBLIC_* env vars (e.g. an .env.staging loaded at
// build time) so a staging backend can be targeted without editing source.
// Unset in every build today, so production behavior is unchanged.
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'https://aequitas.digital/api';
export const WEBAPP = process.env.EXPO_PUBLIC_WEBAPP ?? 'https://aequitas.digital';
export const RPC_URL = process.env.EXPO_PUBLIC_RPC_URL ?? 'https://aequitas.digital/rpc';

export const CHAIN_ID_HEX = '0x786';
export const CHAIN_ID_DEC = 1926;
export const V7_CONTRACT = '0x20D271028f32577FCd07b4583A8e0E4eBBdB4F78';

export const NATIVE_CURRENCY = { name: 'Aequitas', symbol: 'AEQ', decimals: 18 } as const;

export const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
