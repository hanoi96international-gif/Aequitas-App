import type { VaultMeta } from './vault';

// Entsperrzustand der App (docs/NEUBAU_ANALYSE.md 3.7 Punkt 2, G "Sperrbildschirm").
//
// Reine Zustandsmaschine ohne React und ohne IO, damit jede Regel testbar ist.
// Der SessionProvider (src/features/security) fuettert sie mit Ereignissen.
//
// "Entsperrt" heisst nur: die App zeigt ihre Inhalte. Einen Schluessel haelt
// die Sitzung nie -- jede Signatur fragt den Tresor selbst noch einmal
// (vault.withSigner).
//
// Regeln:
//   - Entsperren geht nur aus 'locked' und nur nach erfolgreicher
//     Tresorpruefung (vault.verifyAccess). Aus 'loading'/'noVault'/
//     'unavailable' fuehrt kein Ereignis nach 'unlocked', ausser dem
//     frisch angelegten Tresor ('created').
//   - 'background' sperrt immer.
//   - 'inactive' (App-Umschalter, Kontrollzentrum) sperrt auch -- ausser
//     waehrend einer Systemabfrage, die der Tresor selbst geoeffnet hat
//     (iOS meldet dann ebenfalls 'inactive', promptGuard.ts).
//   - Nach IDLE_LOCK_MS ohne Beruehrung sperrt die App.

export const IDLE_LOCK_MS = 60_000;

export type SessionStatus = 'loading' | 'unavailable' | 'noVault' | 'locked' | 'unlocked';

export interface SessionState {
  status: SessionStatus;
  meta: VaultMeta | null;
  lastActivity: number;
}

export type SessionEvent =
  | { type: 'loaded'; meta: VaultMeta | null }
  | { type: 'loadFailed' }
  | { type: 'created'; meta: VaultMeta; now: number }
  | { type: 'unlocked'; meta: VaultMeta; now: number }
  | { type: 'lock' }
  | { type: 'activity'; now: number }
  | { type: 'tick'; now: number }
  | { type: 'appState'; state: string; promptOpen: boolean }
  | { type: 'metaChanged'; meta: VaultMeta }
  | { type: 'removed' };

export const initialSession: SessionState = { status: 'loading', meta: null, lastActivity: 0 };

function locked(s: SessionState): SessionState {
  return s.status === 'unlocked' ? { ...s, status: 'locked' } : s;
}

export function sessionReducer(s: SessionState, e: SessionEvent): SessionState {
  switch (e.type) {
    case 'loaded':
      // Ein vorhandener Tresor startet IMMER gesperrt.
      return { status: e.meta ? 'locked' : 'noVault', meta: e.meta, lastActivity: 0 };
    case 'loadFailed':
      // Speicher nicht lesbar: nicht "kein Tresor" annehmen (das fuehrte ins
      // Onboarding und liesse den Menschen glauben, die Wallet sei weg).
      return { status: 'unavailable', meta: null, lastActivity: 0 };
    case 'created':
      if (s.status !== 'noVault') return s;
      return { status: 'unlocked', meta: e.meta, lastActivity: e.now };
    case 'unlocked':
      if (s.status !== 'locked' || !s.meta) return s;
      // Nur derselbe Tresor, den die Sitzung kennt.
      if (e.meta.address.toLowerCase() !== s.meta.address.toLowerCase()) return s;
      return { status: 'unlocked', meta: e.meta, lastActivity: e.now };
    case 'lock':
      return locked(s);
    case 'activity':
      return s.status === 'unlocked' ? { ...s, lastActivity: Math.max(s.lastActivity, e.now) } : s;
    case 'tick':
      return s.status === 'unlocked' && e.now - s.lastActivity >= IDLE_LOCK_MS ? locked(s) : s;
    case 'appState':
      if (e.state === 'active') return s;
      if (e.state === 'inactive' && e.promptOpen) return s;
      return locked(s);
    case 'metaChanged':
      return s.meta && e.meta.address.toLowerCase() === s.meta.address.toLowerCase() ? { ...s, meta: e.meta } : s;
    case 'removed':
      return { status: 'noVault', meta: null, lastActivity: 0 };
    default:
      return s;
  }
}
