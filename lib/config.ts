// Overridable via EXPO_PUBLIC_* env vars (e.g. an .env.staging loaded at
// build time) so a staging backend can be targeted without editing source.
// Unset in every build today, so production behavior is unchanged.
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'https://aequitas.digital/api';
export const WEBAPP = process.env.EXPO_PUBLIC_WEBAPP ?? 'https://aequitas.digital';
export const RPC_URL = process.env.EXPO_PUBLIC_RPC_URL ?? 'https://aequitas.digital/rpc';

// Proof-of-Personhood-Coordinator (aequitas-biometric-beta). Getrennt von
// API_BASE, weil es ein eigener Dienst ist, der nicht zwingend hinter
// derselben Domain liegt.
//
// Leer bedeutet: es gibt keinen erreichbaren Coordinator, und der biometrische
// Registrierungsweg wird in der App gar nicht erst angeboten. Bewusst so
// herum — ein Button, der zu einer nicht existierenden Gegenstelle führt,
// erzeugt nur Fehlermeldungen, die niemand einordnen kann.
export const COORDINATOR_BASE = process.env.EXPO_PUBLIC_COORDINATOR_BASE ?? '';
export const HAS_COORDINATOR = COORDINATOR_BASE.length > 0;

export const CHAIN_ID_HEX = '0x786';
export const CHAIN_ID_DEC = 1926;
export const V7_CONTRACT = '0x20D271028f32577FCd07b4583A8e0E4eBBdB4F78';

export const NATIVE_CURRENCY = { name: 'Aequitas', symbol: 'AEQ', decimals: 18 } as const;

export const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
