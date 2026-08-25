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

// TEMPORARY — REVERT ON 2026-08-18. See docs/ENDPOINTS.md.
//
// aequitas.digital does not belong to this project yet; it arrives on
// 2026-08-18. Measured 2026-08-16, that name resolves to a host serving a
// DIFFERENT chain: height ~50, 0 humans, unknown node id, while the real
// network is past 3.8 million blocks with 15 humans. An app pointed there
// shows an empty chain, a zero balance and a zero supply, and any
// registration it completed would land on a chain nobody else follows.
//
// RESOLVED 2026-08-22. aequitas.digital now serves the primary over HTTPS:
// /api/status reports height 4,511,424 and commit 7bf2db9, identical to the
// node at 173.249.37.118, /rpc answers eth_chainId with 0x786, and the
// certificate verifies. So the temporary IP default and the cleartext
// permission that went with it are both gone -- config.test.ts had been red
// since the 18th demanding exactly this, which is what that test is for.
//
// Both halves of the revert matter. Leaving usesCleartextTraffic enabled in a
// shipped app is a downgrade nobody would notice, and a hardcoded IP is one
// server move away from an app that shows nothing.
const PRIMARY_NODE = 'https://aequitas.digital';

export const API_BASE = orDefault(process.env.EXPO_PUBLIC_API_BASE, PRIMARY_NODE + '/api');
export const WEBAPP = orDefault(process.env.EXPO_PUBLIC_WEBAPP, PRIMARY_NODE);
export const RPC_URL = orDefault(process.env.EXPO_PUBLIC_RPC_URL, PRIMARY_NODE + '/rpc');

export const CHAIN_ID_HEX = '0x786';
export const CHAIN_ID_DEC = 1926;
export const V7_CONTRACT = '0x20D271028f32577FCd07b4583A8e0E4eBBdB4F78';

export const NATIVE_CURRENCY = { name: 'Aequitas', symbol: 'AEQ', decimals: 18 } as const;

export const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

// Biometrischer Menschlichkeitsnachweis (Gesichtsvergleich, siehe
// aequitas-biometric-beta).
//
// STAND 25.08.2026: EINGESCHALTET. Die Repository-Variable
// EXPO_PUBLIC_BIOMETRIC_ENABLED steht seit dem 23.08.2026 auf true, und
// v1.6.0 ist damit gebaut. Der frueher hier stehende Satz "unset in every
// build today" stimmte nicht mehr.
//
// Die urspruengliche Auflage lautete: nicht einschalten, bevor die
// Phase-2-Rechtspruefung durch ist. Die steht weiterhin AUS. Was heute
// schuetzt, ist der serverseitige Riegel -- ALLOW_REAL_BIOMETRIC_DATA=false
// und SERVICE_MODE=test beim Coordinator --, nicht dieser Schalter. Wer die
// Rechtslage bewertet, sollte das wissen: es werden echte Gesichter
// verarbeitet, sie landen nur in der Testtabelle.
//
// Ist der Schalter AUS, registriert die App nicht mehr ueber den alten
// Geraetegeheimnis-Weg, sondern bleibt mit einer Meldung stehen -- siehe
// identity.tsx, proveHumanity(). Jener Weg prueft keinen Menschen, und seit
// die Proof-Server BIO_ATTESTATION_MODE=required fahren, kaeme er ohnehin
// nicht mehr durch.
export const BIOMETRIC_ENABLED = process.env.EXPO_PUBLIC_BIOMETRIC_ENABLED === 'true';
export const COORDINATOR_BASE = process.env.EXPO_PUBLIC_COORDINATOR_BASE ?? '';
