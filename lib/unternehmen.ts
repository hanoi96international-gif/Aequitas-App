// Unternehmen in der App: Anmeldung, Kasse, Verzeichnis
// (aequitas-chain docs/UNTERNEHMEN_KONZEPT.md 10.2).
//
// Der Unternehmensschluessel entsteht auf dem Geraet und verlaesst es nie. Er
// wird als Wiederherstellungsphrase (12 Woerter) angezeigt, damit ein
// verlorenes Geraet nicht das Unternehmenskonto kostet; gespeichert wird er im
// sicheren Speicher des Geraets. Der Mensch unterschreibt mit seiner eigenen
// Wallet, dass er verantwortlich ist.
//
// Die Nachrichten muessen Zeichen fuer Zeichen denen der Kette entsprechen
// (wirtschaft_api.go, unternehmen_verzeichnis.go) -- sonst scheitert die
// Unterschrift. Tests halten das fest.

import * as SecureStore from 'expo-secure-store';
import { ethers } from 'ethers';
import { CHAIN_ID_DEC } from './config';
import { ensureDeviceAuthentication, getProvider } from './wallet';

// Wie unternehmenKategorien in wirtschaft.go -- eine andere lehnt die Kette ab.
export const KATEGORIEN = [
  'lebensmittel', 'gastronomie', 'handel', 'handwerk', 'dienstleistung', 'gesundheit',
  'bildung', 'kultur', 'verein', 'landwirtschaft', 'technik', 'sonstiges',
] as const;

// ------------------------------------------------------------ Nachrichten

export function eroeffnenNachricht(u: string, m: string, name: string, kategorie: string, zeit: number): string {
  return `Aequitas: Unternehmenskonto eroeffnen\nUnternehmen: ${u}\nVerantwortlich: ${m}\nName: ${name}\nKategorie: ${kategorie}\nZeit: ${zeit}`;
}

export function schliessenNachricht(u: string, zeit: number): string {
  return `Aequitas: Unternehmenskonto schliessen\nUnternehmen: ${u}\nZeit: ${zeit}`;
}

export function verzeichnisNachricht(u: string, v: string, ort: string, annahme: string, webseite: string, zeit: number): string {
  return `Aequitas: Verzeichniseintrag\nUnternehmen: ${u}\nVerantwortlich: ${v}\nOrt: ${ort}\nAnnahme: ${annahme}\nWebseite: ${webseite}\nZeit: ${zeit}`;
}

export function buergschaftNachricht(u: string, m: string, zeit: number): string {
  return `Aequitas: Buergschaft fuer ein Unternehmen\nUnternehmen: ${u}\nMensch: ${m}\nZeit: ${zeit}`;
}

export function austretenNachricht(u: string, m: string, zeit: number): string {
  return `Aequitas: Als Verantwortliche austreten\nUnternehmen: ${u}\nVerantwortlich: ${m}\nZeit: ${zeit}`;
}

// ------------------------------------------------------------ Normalisieren (wie die Kette)

/** Wie normName der Kette (Name beim Eroeffnen): erst trimmen, dann Zeilenumbruch, Tab und | zu Leerzeichen, hoechstens 60 Zeichen. */
export function normName(n: string): string {
  const t = String(n ?? '').trim().replace(/[\n\r\t|]/g, ' ');
  return Array.from(t).slice(0, 60).join('');
}

/** Wie normText der Kette (Verzeichnis): Steuerzeichen und | zu Leerzeichen, getrimmt, hoechstens max Zeichen. */
export function normText(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f|]/g, ' ').trim();
  return Array.from(t).slice(0, max).join('');
}

const WEBSEITE = /^https:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "" bleibt "", sonst https://host ohne Pfad oder null. */
export function normWebseite(s: string): string | null {
  const t = String(s ?? '').trim().toLowerCase().replace(/\/$/, '');
  if (t === '') return '';
  if (t.length > 100 || !WEBSEITE.test(t)) return null;
  return t;
}

/** Adresse fuer den freiwilligen Nachweis der Webseite. */
export function wellKnownUrl(webseite: string): string | null {
  const w = normWebseite(webseite);
  return w ? w + '/.well-known/aequitas.txt' : null;
}

/** Steht die Unternehmensadresse in der Datei? Gross/klein egal, als eigenes Wort. */
export function wellKnownPasst(inhalt: string, adresse: string): boolean {
  const a = adresse.toLowerCase();
  return String(inhalt ?? '')
    .slice(0, 4096)
    .toLowerCase()
    .split(/[^0-9a-fx]+/)
    .includes(a);
}

/** Prueft die Webseite selbst (die App, nicht der Knoten). false bei jedem Fehler. */
export async function webseiteBestaetigt(webseite: string, adresse: string, timeoutMs = 5000): Promise<boolean> {
  const url = wellKnownUrl(webseite);
  if (!url) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'error' });
    if (!res.ok) return false;
    return wellKnownPasst((await res.text()).slice(0, 4096), adresse);
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------ Schluessel

const SCHLUESSEL_LISTE = 'aequitas_unternehmen_v1';

export interface GespeichertesUnternehmen {
  adresse: string;
  name: string;
}

function schluesselKey(adresse: string): string {
  return 'aequitas_unternehmen_key_' + adresse.toLowerCase().slice(2);
}

/** Neuer Unternehmensschluessel; die Phrase muss der Mensch aufschreiben. */
export function neuerSchluessel(): { adresse: string; phrase: string; wallet: ethers.HDNodeWallet } {
  const wallet = ethers.Wallet.createRandom();
  return { adresse: wallet.address.toLowerCase(), phrase: wallet.mnemonic!.phrase, wallet };
}

/** Aus einer aufgeschriebenen Phrase wiederherstellen. Wirft bei falscher Phrase. */
export function ausPhrase(phrase: string): ethers.HDNodeWallet {
  return ethers.Wallet.fromPhrase(phrase.trim().toLowerCase().replace(/\s+/g, ' '));
}

export async function liste(): Promise<GespeichertesUnternehmen[]> {
  try {
    const roh = await SecureStore.getItemAsync(SCHLUESSEL_LISTE);
    const l = roh ? JSON.parse(roh) : [];
    return Array.isArray(l) ? l.filter((e) => e && /^0x[0-9a-f]{40}$/.test(e.adresse)) : [];
  } catch {
    return [];
  }
}

export async function speichern(wallet: ethers.HDNodeWallet | ethers.Wallet, name: string): Promise<void> {
  const adresse = wallet.address.toLowerCase();
  await SecureStore.setItemAsync(schluesselKey(adresse), wallet.privateKey, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  const l = (await liste()).filter((e) => e.adresse !== adresse);
  l.push({ adresse, name });
  await SecureStore.setItemAsync(SCHLUESSEL_LISTE, JSON.stringify(l));
}

/** Den Schluessel laden -- nur nach Entsperren des Geraets (PIN oder Biometrie). */
export async function laden(adresse: string): Promise<ethers.Wallet | null> {
  await ensureDeviceAuthentication('Unternehmenskonto entsperren');
  const pk = await SecureStore.getItemAsync(schluesselKey(adresse));
  return pk ? new ethers.Wallet(pk, getProvider()) : null;
}

/** Vom Unternehmenskonto zahlen (Lohn, Lieferant, Entnahme). Gibt den Hash zurueck. */
export async function auszahlen(adresse: string, an: string, betragAeq: string): Promise<string> {
  if (!ethers.isAddress(an)) throw new Error('Empfaenger ist keine Adresse');
  const wei = ethers.parseEther(betragAeq);
  if (wei <= 0n) throw new Error('Betrag muss groesser als 0 sein');
  const w = await laden(adresse);
  if (!w) throw new Error('Schluessel dieses Unternehmens ist nicht auf diesem Geraet');
  const tx = await w.sendTransaction({ to: ethers.getAddress(an), value: wei });
  return tx.hash;
}

export async function vergessen(adresse: string): Promise<void> {
  await SecureStore.deleteItemAsync(schluesselKey(adresse));
  const l = (await liste()).filter((e) => e.adresse !== adresse.toLowerCase());
  await SecureStore.setItemAsync(SCHLUESSEL_LISTE, JSON.stringify(l));
}

// ------------------------------------------------------------ Kasse

/** Zahlungslink nach EIP-681, wie ihn lib/zahlungslink.ts liest. */
export function zahlungslink(adresse: string, betragAeq: string): string {
  const wei = ethers.parseEther(betragAeq);
  if (wei <= 0n) throw new Error('Betrag muss groesser als 0 sein');
  return `ethereum:${ethers.getAddress(adresse)}@${CHAIN_ID_DEC}?value=${wei.toString()}`;
}

export interface KassenEintrag {
  zeit: number;
  betrag: number;
  gegenkonto: string;
  tx: string;
  richtung: 'ein' | 'aus' | 'neutral';
}

/** Ist die erwartete Zahlung eingegangen? Ein Eingang ab `seit` mit genau diesem Betrag. */
export function zahlungEingegangen(eintraege: KassenEintrag[], betrag: number, seit: number): KassenEintrag | null {
  return (
    eintraege.find(
      (e) => e.richtung === 'ein' && e.zeit >= seit && Math.abs(e.betrag - betrag) < 1e-6,
    ) ?? null
  );
}

/** Eingaenge eines Tages (UTC-Datum JJJJ-MM-TT). */
export function tagesliste(eintraege: KassenEintrag[], tag: string): KassenEintrag[] {
  return eintraege.filter((e) => new Date(e.zeit * 1000).toISOString().slice(0, 10) === tag);
}

/** CSV fuer die Buchhaltung: Datum, Betrag, Gegenkonto, Transaktion. Ausgaenge negativ. */
export function csv(eintraege: KassenEintrag[]): string {
  const zeilen = ['datum;betrag_aeq;gegenkonto;transaktion'];
  for (const e of eintraege) {
    if (e.richtung === 'neutral') continue;
    const vz = e.richtung === 'aus' ? -1 : 1;
    const feld = (s: string) => (/[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
    zeilen.push(
      [new Date(e.zeit * 1000).toISOString(), (vz * e.betrag).toFixed(6), feld(e.gegenkonto), feld(e.tx)].join(';'),
    );
  }
  return zeilen.join('\n') + '\n';
}

// ------------------------------------------------------------ Verzeichnis

export interface VerzeichnisEintrag {
  adresse: string;
  name: string;
  kategorie: string;
  ort: string;
  annahme: string;
  webseite: string;
  kundschaft: number | null;
  buergen: number;
  weitergabe: number | null;
  ausstieg: number | null;
}

const ADRESSE = /^0x[0-9a-f]{40}$/;

/** /api/unternehmen der Kette, geprueft und begrenzt -- das Netz ist fremd. */
export function verzeichnisLesen(roh: unknown): VerzeichnisEintrag[] {
  const liste = (roh as any)?.unternehmen;
  if (!Array.isArray(liste)) return [];
  const out: VerzeichnisEintrag[] = [];
  for (const u of liste.slice(0, 5000)) {
    const adresse = String(u?.adresse ?? '').toLowerCase();
    if (!ADRESSE.test(adresse)) continue;
    const v = u?.verzeichnis ?? {};
    const zahl = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const w = u?.weitergabe ?? {};
    out.push({
      adresse,
      name: normText(u?.name ?? '', 60),
      kategorie: normText(u?.kategorie ?? '', 30),
      ort: normText(v?.ort ?? '', 60),
      annahme: normText(v?.annahme ?? '', 80),
      webseite: normWebseite(v?.webseite ?? '') ?? '',
      kundschaft: zahl(u?.kundschaft_90_tage),
      buergen: zahl(u?.buergen_anzahl) ?? 0,
      weitergabe: zahl(w?.weitergabe),
      ausstieg: zahl(w?.ausstieg),
    });
  }
  // Wer viele verschiedene Menschen als Kundschaft hat, steht oben.
  return out.sort((a, b) => (b.kundschaft ?? -1) - (a.kundschaft ?? -1) || a.name.localeCompare(b.name));
}

export function suchen(liste: VerzeichnisEintrag[], text: string): VerzeichnisEintrag[] {
  const q = text.trim().toLowerCase();
  if (!q) return liste;
  return liste.filter((e) => [e.name, e.ort, e.kategorie].some((f) => f.toLowerCase().includes(q)));
}
