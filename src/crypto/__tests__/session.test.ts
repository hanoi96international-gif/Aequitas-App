import { IDLE_LOCK_MS, initialSession, sessionReducer, type SessionEvent, type SessionState } from '../session';
import type { VaultMeta } from '../vault';

const META: VaultMeta = {
  version: 2,
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  protection: 'biometric',
  kind: 'phrase',
  backedUp: false,
  createdAt: 1,
};
const FREMD: VaultMeta = { ...META, address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' };

const run = (events: SessionEvent[], from: SessionState = initialSession) => events.reduce(sessionReducer, from);
const entsperrt = () => run([{ type: 'loaded', meta: META }, { type: 'unlocked', meta: META, now: 1000 }]);

describe('Sitzung', () => {
  it('ein vorhandener Tresor startet gesperrt, ohne Tresor geht es ins Onboarding', () => {
    expect(run([{ type: 'loaded', meta: META }]).status).toBe('locked');
    expect(run([{ type: 'loaded', meta: null }]).status).toBe('noVault');
  });
  it('nicht lesbarer Speicher ist NICHT "kein Tresor"', () => {
    expect(run([{ type: 'loadFailed' }]).status).toBe('unavailable');
  });
  it('entsperren und sperren', () => {
    expect(entsperrt().status).toBe('unlocked');
    expect(sessionReducer(entsperrt(), { type: 'lock' }).status).toBe('locked');
  });
  it('frisch angelegter Tresor ist entsperrt -- aber nur aus dem Onboarding heraus', () => {
    expect(run([{ type: 'loaded', meta: null }, { type: 'created', meta: META, now: 1 }]).status).toBe('unlocked');
    expect(run([{ type: 'loaded', meta: META }, { type: 'created', meta: FREMD, now: 1 }])).toMatchObject({ status: 'locked', meta: META });
  });
  it('entfernen fuehrt zurueck ins Onboarding', () => {
    expect(sessionReducer(entsperrt(), { type: 'removed' })).toMatchObject({ status: 'noVault', meta: null });
  });
});

describe('Missbrauch: Entsperren ohne Pruefung', () => {
  it('aus loading, noVault oder unavailable fuehrt "unlocked" nirgendwohin', () => {
    expect(run([{ type: 'unlocked', meta: META, now: 1 }]).status).toBe('loading');
    expect(run([{ type: 'loaded', meta: null }, { type: 'unlocked', meta: META, now: 1 }]).status).toBe('noVault');
    expect(run([{ type: 'loadFailed' }, { type: 'unlocked', meta: META, now: 1 }]).status).toBe('unavailable');
  });
  it('ein anderer Tresor entsperrt nicht diese Sitzung', () => {
    expect(run([{ type: 'loaded', meta: META }, { type: 'unlocked', meta: FREMD, now: 1 }]).status).toBe('locked');
  });
  it('Beruehrung und Uhr entsperren nie', () => {
    const s = run([{ type: 'loaded', meta: META }, { type: 'activity', now: 5 }, { type: 'tick', now: 6 }, { type: 'appState', state: 'active', promptOpen: false }]);
    expect(s.status).toBe('locked');
  });
});

describe('Automatische Sperre', () => {
  it('Hintergrund sperrt immer -- auch waehrend einer Systemabfrage', () => {
    expect(sessionReducer(entsperrt(), { type: 'appState', state: 'background', promptOpen: false }).status).toBe('locked');
    expect(sessionReducer(entsperrt(), { type: 'appState', state: 'background', promptOpen: true }).status).toBe('locked');
  });
  it('inactive (App-Umschalter) sperrt, ausser die App hat selbst eine Systemabfrage offen', () => {
    expect(sessionReducer(entsperrt(), { type: 'appState', state: 'inactive', promptOpen: false }).status).toBe('locked');
    expect(sessionReducer(entsperrt(), { type: 'appState', state: 'inactive', promptOpen: true }).status).toBe('unlocked');
  });
  it('unbekannter AppState sperrt (fail-closed)', () => {
    expect(sessionReducer(entsperrt(), { type: 'appState', state: 'extension', promptOpen: false }).status).toBe('locked');
  });
  it(`sperrt nach ${IDLE_LOCK_MS / 1000} s ohne Beruehrung; Beruehrung schiebt die Frist`, () => {
    const s = entsperrt();
    expect(sessionReducer(s, { type: 'tick', now: 1000 + IDLE_LOCK_MS - 1 }).status).toBe('unlocked');
    expect(sessionReducer(s, { type: 'tick', now: 1000 + IDLE_LOCK_MS }).status).toBe('locked');
    const beruehrt = sessionReducer(s, { type: 'activity', now: 30_000 });
    expect(sessionReducer(beruehrt, { type: 'tick', now: 1000 + IDLE_LOCK_MS }).status).toBe('unlocked');
    expect(sessionReducer(beruehrt, { type: 'tick', now: 30_000 + IDLE_LOCK_MS }).status).toBe('locked');
  });
  it('ein verspaetetes, aelteres Aktivitaetsereignis verlaengert nichts', () => {
    const s = sessionReducer(sessionReducer(entsperrt(), { type: 'activity', now: 30_000 }), { type: 'activity', now: 2_000 });
    expect(s.lastActivity).toBe(30_000);
  });
});

describe('Metadaten', () => {
  it('Backup-Status wird uebernommen, fremde Metadaten nicht', () => {
    const s = sessionReducer(entsperrt(), { type: 'metaChanged', meta: { ...META, backedUp: true } });
    expect(s.meta?.backedUp).toBe(true);
    expect(sessionReducer(s, { type: 'metaChanged', meta: FREMD }).meta?.address).toBe(META.address);
  });
});
