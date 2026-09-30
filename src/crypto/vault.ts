import { decryptKeystoreJson, encryptKeystoreJson, HDNodeWallet, Mnemonic, Wallet } from 'ethers';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { normalizePhrase } from './mnemonic';
import { withSystemPrompt } from './promptGuard';

// Schluesseltresor (Neubau, docs/NEUBAU_ANALYSE.md 3.7).
//
// WAS GESPEICHERT WIRD
//   Die Wiederherstellungsphrase (nicht nur der Private Key): nur so kann der
//   Mensch sein Backup spaeter noch einmal ansehen, und weitere Schluessel
//   (Unternehmen, HD-Index >= 1) lassen sich ableiten. Ein importierter roher
//   Private Key bleibt moeglich (kind 'privateKey', ohne Backup-Anzeige).
//
// WIE ER GESCHUETZT IST -- je nach Geraet, beim Anlegen festgelegt:
//   'biometric'  Biometrie eingerichtet. Das Keychain-Element verlangt sie
//                selbst (SecureStore requireAuthentication).
//   'device'     Nur Geraete-PIN/-Muster. SecureStore kann dort nicht
//                sperren (biometrie-only, siehe lib/wallet.ts), also
//                verlangt der Tresor vor JEDEM Lesen die Systemabfrage.
//   'pin'        Keine Bildschirmsperre. Frueher gab die App den Schluessel
//                dann OHNE jede Pruefung heraus (lib/wallet.ts, SecurityLevel.NONE
//                -> return). Jetzt ist eine App-PIN Pflicht; die Phrase liegt
//                mit scrypt/AES verschluesselt (JSON-Keystore), und falsche
//                PINs kosten wachsende Wartezeit.
//   Immer: WHEN_UNLOCKED_THIS_DEVICE_ONLY -- kein iCloud-/Backup-Export.
//
// WIE ER BENUTZT WIRD
//   withSigner() entschluesselt fuer genau EINEN Vorgang und verwirft den
//   Schluessel danach. Es gibt keinen dauerhaft entsperrten Signer im Speicher.
//   verifyAccess() prueft nur, dass der Mensch den Tresor oeffnen kann
//   (Sperrbildschirm) -- ohne etwas herauszugeben.

export type Protection = 'biometric' | 'device' | 'pin';
export type SecretKind = 'phrase' | 'privateKey';

export interface VaultMeta {
  version: 2;
  address: string;
  protection: Protection;
  kind: SecretKind;
  backedUp: boolean;
  createdAt: number;
}

export type VaultErrorReason =
  | 'noVault'
  | 'cancelled'
  | 'pinRequired'
  | 'pinWrong'
  | 'pinLocked'
  | 'pinWeak'
  | 'invalidSecret'
  | 'mismatch'
  | 'exists';

export class VaultError extends Error {
  constructor(
    readonly reason: VaultErrorReason,
    readonly waitMs?: number,
  ) {
    super(reason);
    this.name = 'VaultError';
  }
}

const META_KEY = 'aequitas.vault.v2.meta';
const SECRET_KEY = 'aequitas.vault.v2.secret';
const PIN_STATE_KEY = 'aequitas.vault.v2.pinstate';
// Speicher der alten App (lib/wallet.ts): nur Private Key, keine Phrase.
const LEGACY_SECRET_KEY = 'aequitas_wallet_secret_v1';
const LEGACY_ADDRESS_KEY = 'aequitas_wallet_address_v1';

export const DERIVATION_BASE = "m/44'/60'/0'/0";
const PIN_MIN_LENGTH = 6;
const PIN_FREE_ATTEMPTS = 5;
const PIN_MAX_WAIT_MS = 60 * 60 * 1000;
// 2^15: auf einem Mittelklasse-Telefon unter einer Sekunde, fuer einen
// Angreifer mit ausgelesenem Speicher pro PIN-Versuch spuerbar teuer.
const PIN_SCRYPT = { N: 1 << 15, r: 8, p: 1 };

// ---------------------------------------------------------------- Abhaengigkeiten

interface Deps {
  getItem(key: string, opts?: SecureStore.SecureStoreOptions): Promise<string | null>;
  setItem(key: string, value: string, opts?: SecureStore.SecureStoreOptions): Promise<void>;
  deleteItem(key: string): Promise<void>;
  canUseBiometric(): boolean;
  enrolledLevel(): Promise<LocalAuthentication.SecurityLevel>;
  authenticate(prompt: string): Promise<boolean>;
  now(): number;
}

// Alles, was eine Systemabfrage oeffnen kann, laeuft ueber withSystemPrompt
// (promptGuard.ts): sonst sperrt sich die Sitzung auf iOS beim Entsperren.
const realDeps: Deps = {
  getItem: (k, o) => (o?.requireAuthentication ? withSystemPrompt(() => SecureStore.getItemAsync(k, o)) : SecureStore.getItemAsync(k, o)),
  setItem: (k, v, o) =>
    o?.requireAuthentication ? withSystemPrompt(() => SecureStore.setItemAsync(k, v, o)) : SecureStore.setItemAsync(k, v, o),
  deleteItem: (k) => SecureStore.deleteItemAsync(k),
  canUseBiometric: () => SecureStore.canUseBiometricAuthentication(),
  enrolledLevel: () => LocalAuthentication.getEnrolledLevelAsync(),
  authenticate: (prompt) =>
    withSystemPrompt(async () => (await LocalAuthentication.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: false })).success),
  now: () => Date.now(),
};

let deps: Deps = realDeps;

/** Nur Tests. */
export function _setDepsForTest(d: Partial<Deps> | null): void {
  deps = d ? { ...realDeps, ...d } : realDeps;
}

const BASE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

// ---------------------------------------------------------------- Lesen

export async function getMeta(): Promise<VaultMeta | null> {
  const raw = await deps.getItem(META_KEY, BASE_OPTS);
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as VaultMeta;
    return m.version === 2 && typeof m.address === 'string' ? m : null;
  } catch {
    return null;
  }
}

/** Gibt es noch eine Wallet der alten App (nur Private Key, kein Backup moeglich)? */
export async function legacyAddress(): Promise<string | null> {
  return deps.getItem(LEGACY_ADDRESS_KEY);
}

/** Welcher Schutz ist auf diesem Geraet moeglich? */
export async function availableProtection(): Promise<Protection> {
  if (deps.canUseBiometric()) return 'biometric';
  const level = await deps.enrolledLevel();
  return level === LocalAuthentication.SecurityLevel.NONE ? 'pin' : 'device';
}

// ---------------------------------------------------------------- Anlegen

function walletFrom(kind: SecretKind, secret: string, index = 0): HDNodeWallet | Wallet {
  if (kind === 'phrase') {
    return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(secret), `${DERIVATION_BASE}/${index}`);
  }
  if (index !== 0) throw new VaultError('invalidSecret');
  return new Wallet(secret);
}

export function validPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_LENGTH},12}$`).test(pin) && !/^(\d)\1+$/.test(pin) && !'0123456789012'.includes(pin) && !'9876543210987'.includes(pin);
}

/**
 * Legt den Tresor an. Mit Schutz 'pin' ist eine gueltige PIN Pflicht.
 * Ueberschreibt nie einen bestehenden Tresor (erst wipe()).
 */
export async function createVault(input: { phrase: string } | { privateKey: string }, opts: { pin?: string; backedUp?: boolean } = {}): Promise<VaultMeta> {
  if (await getMeta()) throw new VaultError('exists');
  let kind: SecretKind;
  let secret: string;
  if ('phrase' in input) {
    kind = 'phrase';
    secret = normalizePhrase(input.phrase);
    if (!Mnemonic.isValidMnemonic(secret)) throw new VaultError('invalidSecret');
  } else {
    kind = 'privateKey';
    secret = normalizeKey(input.privateKey);
  }
  return storeVault(kind, secret, await availableProtection(), opts, false);
}

function normalizeKey(input: string): string {
  const k = input.trim();
  const secret = k.startsWith('0x') ? k : `0x${k}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(secret)) throw new VaultError('invalidSecret');
  return secret;
}

async function storeVault(
  kind: SecretKind,
  secret: string,
  protection: Protection,
  opts: { pin?: string; backedUp?: boolean },
  userJustAuthenticated: boolean,
): Promise<VaultMeta> {
  const wallet = walletFrom(kind, secret);

  if (protection === 'pin') {
    if (!opts.pin) throw new VaultError('pinRequired');
    if (!validPin(opts.pin)) throw new VaultError('pinWeak');
    const json = await encryptKeystoreJson(
      {
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonic: kind === 'phrase' ? { entropy: Mnemonic.fromPhrase(secret).entropy, path: `${DERIVATION_BASE}/0` } : undefined,
      },
      opts.pin,
      { scrypt: PIN_SCRYPT },
    );
    await deps.setItem(SECRET_KEY, json, BASE_OPTS);
  } else {
    if (protection === 'device' && !userJustAuthenticated && !(await deps.authenticate('Aequitas-Wallet sichern'))) {
      throw new VaultError('cancelled');
    }
    await deps.setItem(SECRET_KEY, `${kind}:${secret}`, {
      ...BASE_OPTS,
      requireAuthentication: protection === 'biometric',
      authenticationPrompt: 'Aequitas-Wallet sichern',
    });
  }

  const meta: VaultMeta = {
    version: 2,
    address: wallet.address,
    protection,
    kind,
    backedUp: kind === 'phrase' && !!opts.backedUp,
    createdAt: deps.now(),
  };
  await deps.setItem(META_KEY, JSON.stringify(meta), BASE_OPTS);
  return meta;
}

/**
 * Uebernimmt die Wallet der alten App in den Tresor (kind 'privateKey', ohne
 * Phrase -- ein Backup ist dafuer nicht moeglich). Gelesen wird genau wie in
 * lib/wallet.ts:unlockWallet, also nur nach Biometrie bzw. Geraete-PIN. Erst
 * wenn der neue Tresor steht, wird der alte Speicher geloescht -- dort lag der
 * Schluessel auf Geraeten ohne Bildschirmsperre ungeschuetzt.
 */
export async function importLegacy(prompt: string, opts: { pin?: string } = {}): Promise<VaultMeta> {
  if (await getMeta()) throw new VaultError('exists');
  const address = await legacyAddress();
  if (!address) throw new VaultError('noVault');
  const protection = await availableProtection();
  // Erst die PIN pruefen, dann den alten Schluessel anfassen.
  if (protection === 'pin') {
    if (!opts.pin) throw new VaultError('pinRequired');
    if (!validPin(opts.pin)) throw new VaultError('pinWeak');
  }
  if (protection === 'device' && !(await deps.authenticate(prompt))) throw new VaultError('cancelled');
  let raw: string | null;
  try {
    raw = await deps.getItem(LEGACY_SECRET_KEY, {
      requireAuthentication: protection === 'biometric',
      authenticationPrompt: prompt,
    });
  } catch {
    throw new VaultError('cancelled');
  }
  if (!raw) throw new VaultError('noVault');
  const secret = normalizeKey(raw);
  if (new Wallet(secret).address.toLowerCase() !== address.toLowerCase()) {
    // Alter Speicher passt nicht zu seiner Adresse -- nichts uebernehmen.
    throw new VaultError('invalidSecret');
  }
  const meta = await storeVault('privateKey', secret, protection, opts, true);
  await deps.deleteItem(LEGACY_SECRET_KEY);
  await deps.deleteItem(LEGACY_ADDRESS_KEY);
  return meta;
}

export async function markBackedUp(): Promise<void> {
  const m = await getMeta();
  if (!m) throw new VaultError('noVault');
  await deps.setItem(META_KEY, JSON.stringify({ ...m, backedUp: true }), BASE_OPTS);
}

// ---------------------------------------------------------------- PIN-Versuche

interface PinState {
  fails: number;
  lockedUntil: number;
}

async function pinState(): Promise<PinState> {
  const raw = await deps.getItem(PIN_STATE_KEY, BASE_OPTS);
  try {
    const s = raw ? (JSON.parse(raw) as PinState) : null;
    return s && Number.isFinite(s.fails) ? s : { fails: 0, lockedUntil: 0 };
  } catch {
    // Beschaedigter Zaehler zaehlt NICHT als Null -- sicherheitshalber
    // gesperrt. Der Ersatz wird gespeichert: sonst begaenne die Wartezeit bei
    // jedem Lesen neu, und die PIN liesse sich nie wieder eingeben.
    const s = { fails: PIN_FREE_ATTEMPTS, lockedUntil: deps.now() + pinWaitMs(PIN_FREE_ATTEMPTS) };
    await deps.setItem(PIN_STATE_KEY, JSON.stringify(s), BASE_OPTS);
    return s;
  }
}

/** Verbleibende Wartezeit nach falschen PINs (0 = Eingabe moeglich). */
export async function pinLockRemaining(): Promise<number> {
  const st = await pinState();
  return Math.max(0, st.lockedUntil - deps.now());
}

/** Wartezeit nach n Fehlversuchen: 5 frei, dann 30 s, 60 s, ... bis 1 h. */
export function pinWaitMs(fails: number): number {
  if (fails < PIN_FREE_ATTEMPTS) return 0;
  return Math.min(PIN_MAX_WAIT_MS, 30_000 * 2 ** (fails - PIN_FREE_ATTEMPTS));
}

// ---------------------------------------------------------------- Benutzen

async function readSecret(meta: VaultMeta, prompt: string, pin?: string): Promise<{ kind: SecretKind; secret: string }> {
  if (meta.protection === 'pin') {
    if (!pin) throw new VaultError('pinRequired');
    const st = await pinState();
    if (st.lockedUntil > deps.now()) throw new VaultError('pinLocked', st.lockedUntil - deps.now());
    const json = await deps.getItem(SECRET_KEY, BASE_OPTS);
    if (!json) throw new VaultError('noVault');
    try {
      const acc = await decryptKeystoreJson(json, pin);
      await deps.setItem(PIN_STATE_KEY, JSON.stringify({ fails: 0, lockedUntil: 0 }), BASE_OPTS);
      if (acc.mnemonic?.entropy) return { kind: 'phrase', secret: Mnemonic.fromEntropy(acc.mnemonic.entropy).phrase };
      return { kind: 'privateKey', secret: acc.privateKey };
    } catch {
      const fails = st.fails + 1;
      const wait = pinWaitMs(fails);
      await deps.setItem(PIN_STATE_KEY, JSON.stringify({ fails, lockedUntil: deps.now() + wait }), BASE_OPTS);
      throw new VaultError(wait > 0 ? 'pinLocked' : 'pinWrong', wait);
    }
  }
  if (meta.protection === 'device' && !(await deps.authenticate(prompt))) throw new VaultError('cancelled');
  let raw: string | null;
  try {
    raw = await deps.getItem(SECRET_KEY, {
      ...BASE_OPTS,
      requireAuthentication: meta.protection === 'biometric',
      authenticationPrompt: prompt,
    });
  } catch {
    // Abgebrochene Biometrie wirft im nativen Modul.
    throw new VaultError('cancelled');
  }
  if (!raw) throw new VaultError('noVault');
  const i = raw.indexOf(':');
  const kind = raw.slice(0, i) as SecretKind;
  if (kind !== 'phrase' && kind !== 'privateKey') throw new VaultError('invalidSecret');
  return { kind, secret: raw.slice(i + 1) };
}

/**
 * Fuehrt fn mit dem entschluesselten Signer aus -- genau einmal, mit eigener
 * Bestaetigung. Der Signer darf fn nicht verlassen (keine Speicherung).
 */
export async function withSigner<T>(prompt: string, fn: (w: HDNodeWallet | Wallet) => Promise<T>, opts: { pin?: string; index?: number } = {}): Promise<T> {
  const meta = await getMeta();
  if (!meta) throw new VaultError('noVault');
  const { kind, secret } = await readSecret(meta, prompt, opts.pin);
  const main = matchingMain(meta, kind, secret);
  const index = opts.index ?? 0;
  return fn(index === 0 ? main : walletFrom(kind, secret, index));
}

/** Hauptschluessel -- nur wenn Speicher und Metadaten zusammenpassen, sonst lieber nicht signieren. */
function matchingMain(meta: VaultMeta, kind: SecretKind, secret: string): HDNodeWallet | Wallet {
  const w = walletFrom(kind, secret, 0);
  if (w.address.toLowerCase() !== meta.address.toLowerCase()) throw new VaultError('invalidSecret');
  return w;
}

/**
 * Entsperren: dieselbe Pruefung wie vor einer Signatur (Biometrie, Geraete-PIN
 * oder App-PIN, samt Wartezeit nach Fehlversuchen), aber es verlaesst nichts
 * den Tresor. Gibt die Metadaten zurueck.
 */
export async function verifyAccess(prompt: string, opts: { pin?: string } = {}): Promise<VaultMeta> {
  const meta = await getMeta();
  if (!meta) throw new VaultError('noVault');
  const { kind, secret } = await readSecret(meta, prompt, opts.pin);
  matchingMain(meta, kind, secret);
  return meta;
}

/** Phrase zur Anzeige (Backup ansehen) -- nur fuer kind 'phrase'. */
export async function revealPhrase(prompt: string, opts: { pin?: string } = {}): Promise<string> {
  const meta = await getMeta();
  if (!meta) throw new VaultError('noVault');
  if (meta.kind !== 'phrase') throw new VaultError('invalidSecret');
  const { kind, secret } = await readSecret(meta, prompt, opts.pin);
  // Nie eine Phrase als Sicherung zeigen, die nicht zu DIESEM Konto gehoert --
  // wer sie aufschreibt, haette sonst ein wertloses Backup.
  matchingMain(meta, kind, secret);
  return secret;
}

/**
 * Tresor neu einrichten, wenn er sich nicht mehr oeffnen laesst (App-PIN
 * vergessen; iOS macht Biometrie-Elemente ungueltig, sobald ein Gesicht oder
 * Finger dazukommt). Nur mit dem Geheimnis, das zur GESPEICHERTEN Adresse
 * gehoert -- wer es hat, koennte die Wallet ohnehin auf jedem Geraet
 * wiederherstellen. Ein fremdes Geheimnis ersetzt nichts. Alles wird vor dem
 * Loeschen geprueft, damit ein Abbruch den alten Tresor nicht kostet.
 */
export async function recoverVault(input: { phrase: string } | { privateKey: string }, opts: { pin?: string } = {}): Promise<VaultMeta> {
  const meta = await getMeta();
  if (!meta) throw new VaultError('noVault');
  let kind: SecretKind;
  let secret: string;
  if ('phrase' in input) {
    kind = 'phrase';
    secret = normalizePhrase(input.phrase);
    if (!Mnemonic.isValidMnemonic(secret)) throw new VaultError('invalidSecret');
  } else {
    kind = 'privateKey';
    secret = normalizeKey(input.privateKey);
  }
  if (walletFrom(kind, secret).address.toLowerCase() !== meta.address.toLowerCase()) throw new VaultError('mismatch');
  const protection = await availableProtection();
  if (protection === 'pin') {
    if (!opts.pin) throw new VaultError('pinRequired');
    if (!validPin(opts.pin)) throw new VaultError('pinWeak');
  }
  if (protection === 'device' && !(await deps.authenticate('Aequitas-Wallet sichern'))) throw new VaultError('cancelled');
  await wipe();
  return storeVault(kind, secret, protection, { pin: opts.pin, backedUp: kind === 'phrase' }, true);
}

/** Entfernt den Tresor von diesem Geraet. Die UI verlangt vorher Backup-Bestaetigung. */
export async function wipe(): Promise<void> {
  await deps.deleteItem(SECRET_KEY);
  await deps.deleteItem(META_KEY);
  await deps.deleteItem(PIN_STATE_KEY);
}
