import { useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { AppState } from 'react-native';

import { systemPromptOpen } from '@/src/crypto/promptGuard';
import { initialSession, sessionReducer, type SessionStatus } from '@/src/crypto/session';
import {
  createVault,
  getMeta,
  importLegacy,
  markBackedUp as vaultMarkBackedUp,
  recoverVault,
  verifyAccess,
  wipe,
  type VaultMeta,
} from '@/src/crypto/vault';

// Verbindet die Sitzungsregeln (src/crypto/session.ts) mit der App:
// Tresor laden, entsperren, bei AppState-Wechsel und nach Inaktivitaet sperren.
//
// Jeder Weg nach "entsperrt" laeuft hier durch und folgt direkt auf einen
// gelungenen Tresor-Vorgang (pruefen, anlegen, uebernehmen, neu einrichten).
// Bildschirme koennen die Sitzung nicht selbst oeffnen.
//
// Zeit kommt aus einer monotonen Uhr (performance.now): wer die Geraeteuhr
// zurueckstellt, verlaengert damit nicht die Inaktivitaetsfrist.

const TICK_MS = 5_000;
const ACTIVITY_THROTTLE_MS = 1_000;

const monotonic = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

type Secret = { phrase: string } | { privateKey: string };

interface SessionValue {
  status: SessionStatus;
  meta: VaultMeta | null;
  /** Entsperren; wirft VaultError (abgebrochen, PIN falsch/gesperrt, ...). */
  unlock: (prompt: string, pin?: string) => Promise<void>;
  lock: () => void;
  /** Beruehrung: schiebt die Inaktivitaetssperre hinaus. */
  touch: () => void;
  /** Onboarding: Tresor anlegen, danach entsperrt. */
  createAccount: (secret: Secret, opts: { pin?: string; backedUp: boolean }) => Promise<void>;
  /** Onboarding: Wallet der alten App uebernehmen, danach entsperrt. */
  takeOverLegacy: (prompt: string, pin?: string) => Promise<void>;
  /** Sperrbildschirm: mit dem Geheimnis dieses Kontos neu einrichten, danach entsperrt. */
  recover: (secret: Secret, pin?: string) => Promise<void>;
  /** Sicherung geprueft. */
  markBackedUp: () => Promise<void>;
  /** Wallet von diesem Geraet entfernen -- nur nach erneuter Pruefung. */
  remove: (prompt: string, pin?: string) => Promise<void>;
  retryLoad: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSession);
  const queryClient = useQueryClient();
  const lastTouch = useRef(0);

  const load = useCallback(() => {
    getMeta()
      .then((meta) => dispatch({ type: 'loaded', meta }))
      .catch(() => dispatch({ type: 'loadFailed' }));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) =>
      dispatch({ type: 'appState', state: next, promptOpen: systemPromptOpen() }),
    );
    return () => sub.remove();
  }, []);

  const unlocked = state.status === 'unlocked';
  useEffect(() => {
    if (!unlocked) return;
    const id = setInterval(() => dispatch({ type: 'tick', now: monotonic() }), TICK_MS);
    return () => clearInterval(id);
  }, [unlocked]);

  // Ging die App waehrend einer Abfrage in den Hintergrund, bleibt sie
  // gesperrt -- sonst waere sie beim Zurueckkehren ohne Pruefung offen.
  // ('inactive' ist erlaubt: iOS meldet es noch kurz nach Face ID.)
  const inForeground = () => AppState.currentState !== 'background';

  const unlock = useCallback(async (prompt: string, pin?: string) => {
    const meta = await verifyAccess(prompt, { pin });
    if (inForeground()) dispatch({ type: 'unlocked', meta, now: monotonic() });
  }, []);

  const createAccount = useCallback(async (secret: Secret, opts: { pin?: string; backedUp: boolean }) => {
    const meta = await createVault(secret, opts);
    // Auch im Hintergrund angelegt: dann gesperrt statt offen.
    dispatch(inForeground() ? { type: 'created', meta, now: monotonic() } : { type: 'loaded', meta });
  }, []);

  const takeOverLegacy = useCallback(async (prompt: string, pin?: string) => {
    const meta = await importLegacy(prompt, { pin });
    dispatch(inForeground() ? { type: 'created', meta, now: monotonic() } : { type: 'loaded', meta });
  }, []);

  const recover = useCallback(async (secret: Secret, pin?: string) => {
    const meta = await recoverVault(secret, { pin });
    if (inForeground()) dispatch({ type: 'unlocked', meta, now: monotonic() });
  }, []);

  const markBackedUp = useCallback(async () => {
    await vaultMarkBackedUp();
    const meta = await getMeta();
    if (meta) dispatch({ type: 'metaChanged', meta });
  }, []);

  const remove = useCallback(
    async (prompt: string, pin?: string) => {
      await verifyAccess(prompt, { pin });
      await wipe();
      // Kontobezogene Kopien aus dem Netz gehoeren dem entfernten Konto.
      queryClient.clear();
      dispatch({ type: 'removed' });
    },
    [queryClient],
  );

  const lock = useCallback(() => dispatch({ type: 'lock' }), []);

  const touch = useCallback(() => {
    const now = monotonic();
    if (now - lastTouch.current < ACTIVITY_THROTTLE_MS) return;
    lastTouch.current = now;
    dispatch({ type: 'activity', now });
  }, []);

  // lastActivity gehoert bewusst NICHT in den Wert: sonst zeichnete jede
  // Beruehrung die ganze App neu.
  const value = useMemo<SessionValue>(
    () => ({
      status: state.status,
      meta: state.meta,
      unlock,
      lock,
      touch,
      createAccount,
      takeOverLegacy,
      recover,
      markBackedUp,
      remove,
      retryLoad: load,
    }),
    [state.status, state.meta, unlock, lock, touch, createAccount, takeOverLegacy, recover, markBackedUp, remove, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession muss innerhalb von SessionProvider aufgerufen werden');
  return ctx;
}
