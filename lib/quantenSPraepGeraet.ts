// Quantengeld Weg B (4c-3a): die Präparatorin im echten Gerät -- die Umgebung
// für runde() (lib/quantenSPraepAblauf.ts) und der IBM-Zugang.
//
//   geheim   SecureStore, nur dieses Gerät, nur entsperrt (Schlüssel des
//            Tresors, IBM-Zugang). Ohne eigene Biometrie-Abfrage: die Runde
//            entsperrt ohnehin die Wallet (Biometrie oder Gerätesperre).
//   ablage   AsyncStorage (Chiffrate des Tresors, Zähler, erledigte Hüllen).
//   dateien  Ablage in Dateien (große Antworten, falls die App auch Ausgeber ist).
//   knoten   der eigene Knoten und die eingebauten Ausweich-Knoten (höchstens 8):
//            die Öffnung geht erst heraus, wenn ALLE befragten Knoten einig sind.

import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import { API_BASE, API_FALLBACKS } from './config';
import { dateiAblage } from './dateiAblage';
import type { IbmZugang } from './ibmQuantum';
import { QuantenSFehler } from './quantenS';
import { zufallInStuecken, type Speicher } from './quantenSInhaberin';
import { runde, type PraepUmgebung, type RundenBericht, type WalletSchluessel } from './quantenSPraepAblauf';
import { IBM_ZUGANG, ibmMesser, ibmZugangLesen, ibmZugangSpeichern } from './quantenSPraepIbm';

function asyncStorage(): { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default;
}

const OPT = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** SecureStore ohne Biometrie-Abfrage, nur dieses Gerät, nur entsperrt. */
export function geheimSpeicher(): Speicher {
  return {
    lesen: (k) => SecureStore.getItemAsync(k, OPT),
    schreiben: (k, w) => SecureStore.setItemAsync(k, w, OPT),
    loeschen: (k) => SecureStore.deleteItemAsync(k, OPT),
  };
}

/** Die Knoten, die die Präparatorin vor einer Öffnung befragt (eigener zuerst, höchstens 8, ohne Doppelte). */
export function praepKnoten(api = API_BASE, ausweich: string[] = API_FALLBACKS): string[] {
  const alle = [api, ...ausweich].map((a) => a.replace(/\/+$/, '')).filter((a) => a !== '');
  return [...new Set(alle)].slice(0, 8);
}

export function praepUmgebung(): PraepUmgebung {
  return {
    fetchFn: fetch,
    apiBasis: API_BASE,
    geheim: geheimSpeicher(),
    ablage: {
      lesen: (k) => asyncStorage().getItem(k),
      schreiben: (k, w) => asyncStorage().setItem(k, w),
      loeschen: (k) => asyncStorage().removeItem(k),
    },
    dateien: dateiAblage(),
    zufall: (n) => zufallInStuecken(n, getRandomBytes),
    jetzt: () => Date.now(),
  };
}

/** Ist ein IBM-Zugang gespeichert? (Den Schlüssel selbst zeigt die App nie.) */
export async function ibmZugangDa(u: Pick<PraepUmgebung, 'geheim'> = praepUmgebung()): Promise<boolean> {
  return (await ibmZugangLesen(u.geheim)) !== null;
}

export async function ibmZugangSetzen(z: IbmZugang, u: Pick<PraepUmgebung, 'geheim'> = praepUmgebung()): Promise<void> {
  await ibmZugangSpeichern(u.geheim, z);
}

export async function ibmZugangLoeschen(u: Pick<PraepUmgebung, 'geheim'> = praepUmgebung()): Promise<void> {
  await u.geheim.loeschen(IBM_ZUGANG);
}

/**
 * Eine Runde: Briefkasten abholen, Aufträge mit dem eigenen IBM-Zugang messen
 * und beantworten, Bestätigungen und Öffnungen. Ohne IBM-Zugang keine Runde
 * (Antworten auf Aufträge brauchen eine Messung).
 */
export async function praepRundeJetzt(
  wallet: WalletSchluessel,
  u: PraepUmgebung = praepUmgebung(),
  knoten: string[] = praepKnoten(),
  warten: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<RundenBericht> {
  const zugang = await ibmZugangLesen(u.geheim);
  if (!zugang) throw new QuantenSFehler('kein IBM-Zugang im Gerät');
  const messer = ibmMesser(zugang, { fetchFn: u.fetchFn, jetzt: u.jetzt, warten });
  return runde(u, wallet, messer, knoten);
}
