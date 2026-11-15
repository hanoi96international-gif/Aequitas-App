// "Jetzt aktualisieren": gibt es eine neuere App-Version?
//
// Gefragt wird der eigene Knoten (/api/app-version), nicht GitHub -- so
// erfaehrt kein Dritter, wer die App wann oeffnet. Die Antwort wird nur als
// Versionsnummer in strenger Form genommen. Aktualisiert wird ueber die
// Download-Seite des Knotens (/download/app.apk, signierte APK); die App
// installiert nichts von selbst.
import Constants from 'expo-constants';
import { API_BASE, WEBAPP } from './config';

const VERSION = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/;

export const DOWNLOAD_URL = `${WEBAPP}/download/app.apk`;

// iOS (ohne App Store, ueber SideStore/AltStore): die Seite mit der
// SideStore-Quelle und der jeweils neuesten IPA (release-ios.yml). Ein
// iPhone kann keine APK installieren; aktualisiert wird in SideStore.
export const IOS_DOWNLOAD_URL = 'https://github.com/hanoi96international-gif/Aequitas-App/releases/tag/sidestore';

/** Wohin "Jetzt aktualisieren" fuehrt, je nach Plattform. */
export function downloadUrlFuer(os: string): string {
  return os === 'ios' ? IOS_DOWNLOAD_URL : DOWNLOAD_URL;
}

export function eigeneVersion(): string {
  const v = String(Constants.expoConfig?.version ?? '');
  return VERSION.test(v) ? v : '';
}

/** Ist a neuer als b? Beide in der Form 1.2.3; sonst false. */
export function istNeuer(a: string, b: string): boolean {
  if (!VERSION.test(a) || !VERSION.test(b)) return false;
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

/** Die neueste Version laut Knoten, oder null (Fehler, unbekannt, falsche Form). */
export async function neuesteVersion(fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await fetchFn(`${API_BASE}/app-version`);
    if (!r.ok) return null;
    const text = (await r.text()).slice(0, 1025);
    if (text.length > 1024) return null;
    const v = JSON.parse(text)?.version;
    return typeof v === 'string' && VERSION.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Die neuere Version, die gemeldet werden soll -- oder null. */
export async function updateVerfuegbar(fetchFn: typeof fetch = fetch, eigene: string = eigeneVersion()): Promise<string | null> {
  if (!eigene) return null;
  const neu = await neuesteVersion(fetchFn);
  return neu && istNeuer(neu, eigene) ? neu : null;
}
