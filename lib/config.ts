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
// NUR HTTPS (Beta-Pruefung 14.10.2026): Biometrie, Salz und Schluessel-
// Signaturen gehen an diese Adressen. Eine Umgebungsvariable mit http:// in
// einem Release-Build waere ein stiller Abstieg auf Klartext -- sie zaehlt
// dann nicht. Nur im Entwicklungsbuild (__DEV__) gilt http fuer lokale
// Adressen (localhost, 127.0.0.1, 10.0.2.2 = Android-Emulator).
const LOKAL = /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?(\/|$)/;

// ABGESCHALTETE SERVER (24.10.2026): proof2.aequitas.digital war C2
// (194.163.188.71), 173.249.37.118 der erste Contabo1. Beide Server sind aus,
// ihre IPs neu vergeben. v1.12.3 wurde mit proof2 in EXPO_PUBLIC_*_FALLBACKS
// gebaut: antwortete proof1 nicht, gingen Gesichtsaufnahmen, API- und
// RPC-Anfragen dorthin -- und wer die Adresse uebernimmt, kann ein gueltiges
// Zertifikat fuer den Namen holen. Darum zaehlen diese Hosts nie, egal was
// beim Bau in den Variablen steht (auch Unterdomains, Gross/Klein, Port,
// Benutzerteil, Punkt am Ende).
//
// Fail-closed: der URL-Parser von fetch (WHATWG) liest manches anders als ein
// einfacher Textvergleich -- \ als /, %2E als Punkt, Unicode-Zeichen, die zu
// ASCII werden, 3265571911 oder 0xc2.163.188.71 als 194.163.188.71, IPv6 mit
// eingebetteter IPv4. Ein Host, der nicht aus ASCII-Buchstaben, Ziffern,
// Punkt und Bindestrich besteht, oder eine IPv4 in nicht-kanonischer Form
// zaehlt darum ebenfalls nie.
const ABGESCHALTET = ['proof2.aequitas.digital', '194.163.188.71', '173.249.37.118'];
const IPV4_KANONISCH = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
export function abgeschaltet(url: string): boolean {
  const autoritaet = (url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#\\]*)/i) ?? [])[1];
  if (autoritaet === undefined) return false;
  const host = autoritaet
    .slice(autoritaet.lastIndexOf('@') + 1)
    .replace(/:\d*$/, '')
    .replace(/\.+$/, '')
    .toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) return true;
  const letztes = host.slice(host.lastIndexOf('.') + 1);
  if (/^(0x[0-9a-f]*|\d+)$/.test(letztes) && !IPV4_KANONISCH.test(host)) return true;
  return ABGESCHALTET.some((a) => host === a || host.endsWith('.' + a));
}

export function sichereAdresse(raw: string | undefined, dev: boolean): string | null {
  const v = (raw ?? '').trim();
  if (v === '') return null;
  if (abgeschaltet(v)) return null;
  if (/^https:\/\/[^\s/]+/.test(v)) return v;
  if (dev && LOKAL.test(v)) return v;
  return null;
}
const istDev = typeof __DEV__ !== 'undefined' && __DEV__;
const orDefault = (value: string | undefined, fallback: string) =>
  sichereAdresse(value, istDev) ?? fallback;

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
// node at 173.249.37.118, /rpc answers eth_chainId with 0x786 (then), and the
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
// Ausweichadressen (kommagetrennt) fuer einen zweiten eigenen Knoten. Seit
// dem 03.10.2026 gibt es keinen: C2 (proof2) ist abgeschaltet, seine Adressen
// zaehlen nie (ABGESCHALTET oben). Auswahl und Wechsel: lib/api.ts (apiBase)
// und lib/wallet.ts (FallbackProvider).
function liste(raw: string | undefined): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s: string) => sichereAdresse(s.trim().replace(/\/+$/, ''), istDev))
    .filter((s): s is string => Boolean(s));
}
export const API_FALLBACKS: string[] = liste(process.env.EXPO_PUBLIC_API_FALLBACKS);
export const RPC_FALLBACKS: string[] = liste(process.env.EXPO_PUBLIC_RPC_FALLBACKS);

// EVM-Chain-ID (Chain-Repo docs/CHAIN_ID_WECHSEL.md): die Kette wechselt zu
// einem Stichtag von 1926 auf 19260930. Zum Signieren gilt NIE eine feste
// Zahl, sondern die ID, die der Knoten live meldet -- und nur, wenn sie in
// dieser Liste steht (lib/kette.ts, lib/ketteLive.ts). Alles andere: nicht
// signieren.
export const CHAIN_ID_ALT = 1926; // 0x786, bis zum Stichtag
export const CHAIN_ID_NEU = 19260930; // 0x125E602, ab dem Stichtag
export const AEQUITAS_CHAIN_IDS: readonly number[] = Object.freeze([CHAIN_ID_ALT, CHAIN_ID_NEU]);
// EINGEFROREN: die Chain-ID der V8-Genesis in der Netzkennung
// "aequitas-1926-<genesis>" (NETZ_SALT im V8-Vertrag ist immutable). Sie
// bleibt 1926, auch nach dem Wechsel -- nie fuer eine EVM-Signatur nutzen.
export const NETZ_KENNUNG_CHAIN_ID = 1926;
export const V7_CONTRACT = '0x20D271028f32577FCd07b4583A8e0E4eBBdB4F78';

export const NATIVE_CURRENCY = { name: 'Aequitas', symbol: 'AEQ', decimals: 18 } as const;

export const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

// Biometrischer Menschlichkeitsnachweis (Gesichtsvergleich, siehe
// aequitas-biometric-beta).
//
// Phase 0 launch (2026-09): default OFF. When true, Identity routes to
// /biometric-capture and registerBiometric() REQUIRES COORDINATOR_BASE;
// do not ship true without a live coordinator.
//
// When BIOMETRIC_ENABLED is false, registration is NOT a silent fallback to
// the device-secret path. It runs only if ALLOW_DEVICE_SECRET_REGISTER is
// explicitly true (build-time EXPO_PUBLIC_ALLOW_DEVICE_SECRET_REGISTER=true);
// otherwise Identity fail-closes with identity.biometricDisabled.
// Device-secret uniqueness is per-device, not per-face — intentional for the
// Phase 0 launch window without face/coordinator.
//
// v1.6.0 was built with the repo variable set true (23.08.2026) while public
// docs later removed the coordinator URL — that combination cannot register.
// Phase 0 APK builds should leave BIOMETRIC unset/false and set ALLOW=true.
//
// Server note (not changed here): device-secret proofs omit bioAttestation.
// That works when proof servers run BIO_ATTESTATION_MODE=off|optional; if
// mode=required, Phase 0 registration will 403 until mode is relaxed or a
// coordinator is restored (Contabo / proof-server out of scope for this PR).
export const BIOMETRIC_ENABLED = process.env.EXPO_PUBLIC_BIOMETRIC_ENABLED === 'true';
export const ALLOW_DEVICE_SECRET_REGISTER = process.env.EXPO_PUBLIC_ALLOW_DEVICE_SECRET_REGISTER === 'true';
export const COORDINATOR_BASE = sichereAdresse(process.env.EXPO_PUBLIC_COORDINATOR_BASE, istDev) ?? '';
// Weitere Coordinatoren, kommagetrennt (eigene, unabhaengige Betreiber; proof2
// ist abgeschaltet und zaehlt nie). Der erste erreichbare gewinnt -- und bleibt fuer den
// ganzen Ablauf derselbe: ein Challenge-Nonce gilt nur bei dem Coordinator,
// der ihn ausgegeben hat (coordinator/app/main.py, _pending_challenges liegt
// im Arbeitsspeicher). Siehe lib/biometricIdentity.ts, coordinatorBase().
export const COORDINATOR_FALLBACKS: string[] = liste(process.env.EXPO_PUBLIC_COORDINATOR_FALLBACKS);
