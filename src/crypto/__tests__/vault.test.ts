import { Wallet } from 'ethers';
import * as LocalAuthentication from 'expo-local-authentication';

import { checkPhrase, newPhrase, normalizePhrase, pickCheckPositions, suggestWords } from '../mnemonic';
import {
  _setDepsForTest,
  availableProtection,
  createVault,
  getMeta,
  markBackedUp,
  pinWaitMs,
  revealPhrase,
  validPin,
  VaultError,
  wipe,
  withSigner,
} from '../vault';

jest.setTimeout(30_000);

const PHRASE = 'test test test test test test test test test test test junk';
const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // Hardhat-Konto 0

function geraet(opts: { biometric?: boolean; level?: LocalAuthentication.SecurityLevel; authOk?: boolean }) {
  const store = new Map<string, string>();
  const auths: string[] = [];
  let now = 1_000_000;
  _setDepsForTest({
    getItem: async (k) => store.get(k) ?? null,
    setItem: async (k, v) => {
      store.set(k, v);
    },
    deleteItem: async (k) => {
      store.delete(k);
    },
    canUseBiometric: () => !!opts.biometric,
    enrolledLevel: async () => opts.level ?? LocalAuthentication.SecurityLevel.NONE,
    authenticate: async (p) => {
      auths.push(p);
      return opts.authOk ?? true;
    },
    now: () => now,
  });
  return { store, auths, vorspulen: (ms: number) => (now += ms) };
}

afterEach(() => _setDepsForTest(null));

describe('Phrase', () => {
  it('neue Phrase ist gueltig und hat 12 Woerter', () => {
    const p = newPhrase();
    expect(p.split(' ')).toHaveLength(12);
    expect(checkPhrase(p)).toBeNull();
  });
  it('erkennt Wortzahl, unbekannte Woerter und Pruefsumme', () => {
    expect(checkPhrase('test test')).toEqual({ problem: 'wordCount' });
    expect(checkPhrase(PHRASE.replace('junk', 'xyzzy'))).toEqual({ problem: 'unknownWord', word: 'xyzzy' });
    expect(checkPhrase(PHRASE.replace('junk', 'test'))).toEqual({ problem: 'checksum' });
    expect(checkPhrase('  Test,TEST test test test test test test test test test JUNK ')).toBeNull();
  });
  it('normalisiert, schlaegt vor, waehlt verschiedene Pruefpositionen', () => {
    expect(normalizePhrase(' A  b\nC ')).toBe('a b c');
    expect(suggestWords('ab')).toEqual(['abandon', 'ability', 'able', 'about']);
    const pos = pickCheckPositions(12, 3, (() => { const f = [0.1, 0.1, 0.5, 0.9]; return () => f.shift()!; })());
    expect(pos).toEqual([1, 6, 10]);
  });
});

describe('Schutz nach Geraet', () => {
  it('waehlt biometric > device > pin', async () => {
    geraet({ biometric: true });
    expect(await availableProtection()).toBe('biometric');
    geraet({ level: LocalAuthentication.SecurityLevel.SECRET });
    expect(await availableProtection()).toBe('device');
    geraet({});
    expect(await availableProtection()).toBe('pin');
  });
});

describe('Missbrauch: Geraet ohne Bildschirmsperre', () => {
  it('ohne PIN wird KEIN Tresor angelegt (frueher: Schluessel ohne jede Pruefung)', async () => {
    geraet({});
    await expect(createVault({ phrase: PHRASE })).rejects.toMatchObject({ reason: 'pinRequired' });
    expect(await getMeta()).toBeNull();
  });
  it('schwache PINs werden abgelehnt', () => {
    for (const p of ['12345', '000000', '123456', '987654', '11111111', 'abcdef']) expect(validPin(p)).toBe(false);
    expect(validPin('482915')).toBe(true);
  });
  it('mit PIN: Phrase verschluesselt gespeichert, Signieren nur mit richtiger PIN', async () => {
    const { store } = geraet({});
    const meta = await createVault({ phrase: PHRASE }, { pin: '482915' });
    expect(meta).toMatchObject({ protection: 'pin', kind: 'phrase', address: ADDR, backedUp: false });
    const gespeichert = store.get('aequitas.vault.v2.secret')!;
    expect(gespeichert).not.toContain('test test');
    const addr = await withSigner('x', async (w) => w.address, { pin: '482915' });
    expect(addr).toBe(ADDR);
    await expect(withSigner('x', async () => 1)).rejects.toMatchObject({ reason: 'pinRequired' });
  });
  it('falsche PINs kosten wachsende Wartezeit, auch die richtige hilft waehrend der Sperre nicht', async () => {
    const g = geraet({});
    await createVault({ phrase: PHRASE }, { pin: '482915' });
    for (let i = 0; i < 4; i++) {
      await expect(withSigner('x', async () => 1, { pin: '000001' })).rejects.toMatchObject({ reason: 'pinWrong' });
    }
    await expect(withSigner('x', async () => 1, { pin: '000001' })).rejects.toMatchObject({ reason: 'pinLocked', waitMs: 30_000 });
    await expect(withSigner('x', async () => 1, { pin: '482915' })).rejects.toMatchObject({ reason: 'pinLocked' });
    g.vorspulen(30_001);
    await expect(withSigner('x', async (w) => w.address, { pin: '482915' })).resolves.toBe(ADDR);
    expect(pinWaitMs(6)).toBe(60_000);
    expect(pinWaitMs(50)).toBe(60 * 60 * 1000);
  });
  it('ein beschaedigter Versuchszaehler sperrt statt zurueckzusetzen', async () => {
    const g = geraet({});
    await createVault({ phrase: PHRASE }, { pin: '482915' });
    g.store.set('aequitas.vault.v2.pinstate', '{kaputt');
    await expect(withSigner('x', async () => 1, { pin: '482915' })).rejects.toMatchObject({ reason: 'pinLocked' });
  });
});

describe('Geraete-PIN / Biometrie', () => {
  it('device: jede Nutzung fragt das System; Abbruch gibt nichts heraus', async () => {
    const g = geraet({ level: LocalAuthentication.SecurityLevel.SECRET });
    await createVault({ phrase: PHRASE }, { backedUp: true });
    expect(g.auths).toHaveLength(1);
    await withSigner('Signieren', async () => 1);
    await withSigner('Signieren', async () => 1);
    expect(g.auths).toHaveLength(3);
    _setDepsForTest({ ...{}, authenticate: async () => false, getItem: async (k) => g.store.get(k) ?? null, enrolledLevel: async () => LocalAuthentication.SecurityLevel.SECRET, canUseBiometric: () => false });
    await expect(withSigner('x', async () => 1)).rejects.toMatchObject({ reason: 'cancelled' });
  });
  it('biometric: Keychain-Element verlangt Authentifizierung', async () => {
    const opts: unknown[] = [];
    const store = new Map<string, string>();
    _setDepsForTest({
      canUseBiometric: () => true,
      getItem: async (k, o) => {
        opts.push(o);
        return store.get(k) ?? null;
      },
      setItem: async (k, v, o) => {
        opts.push(o);
        store.set(k, v);
      },
    });
    await createVault({ phrase: PHRASE });
    expect(opts.some((o) => (o as { requireAuthentication?: boolean })?.requireAuthentication === true)).toBe(true);
  });
});

describe('Integritaet', () => {
  it('ueberschreibt nie einen bestehenden Tresor', async () => {
    geraet({ biometric: true });
    await createVault({ phrase: PHRASE });
    await expect(createVault({ phrase: newPhrase() })).rejects.toMatchObject({ reason: 'exists' });
  });
  it('Speicher passt nicht zur Adresse -> keine Signatur', async () => {
    const g = geraet({ biometric: true });
    await createVault({ phrase: PHRASE });
    g.store.set('aequitas.vault.v2.secret', `phrase:${newPhrase()}`);
    await expect(withSigner('x', async () => 1)).rejects.toBeInstanceOf(VaultError);
  });
  it('Phrase anzeigen nur bei kind phrase; Backup-Status wird gesetzt; wipe entfernt alles', async () => {
    const g = geraet({ biometric: true });
    await createVault({ privateKey: Wallet.createRandom().privateKey });
    await expect(revealPhrase('x')).rejects.toMatchObject({ reason: 'invalidSecret' });
    await wipe();
    expect(g.store.size).toBe(0);
    await createVault({ phrase: PHRASE });
    expect(await revealPhrase('x')).toBe(PHRASE);
    await markBackedUp();
    expect((await getMeta())?.backedUp).toBe(true);
  });
  it('ungueltige Eingaben werden nicht gespeichert', async () => {
    geraet({ biometric: true });
    await expect(createVault({ phrase: 'foo bar' })).rejects.toMatchObject({ reason: 'invalidSecret' });
    await expect(createVault({ privateKey: '0x1234' })).rejects.toMatchObject({ reason: 'invalidSecret' });
    expect(await getMeta()).toBeNull();
  });
});
