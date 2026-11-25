// Quantengeld Weg B (B4b-4c-2f-2b): die App als ANNAHMESTELLE eines Tokens aus
// Weg B. In Weg A fragt die Stelle die Validator-Dienste per HTTP
// (annehmenAlsStelle in lib/quantenSStelle.ts); in Weg B sind die Präparatorinnen
// Handys, erreichbar nur über den Briefkasten. Darum zweiphasig:
//
//   1. oeffnungenAnfordern: die Vorlage der Inhaberin (mit der Liste der
//      Gelosten, Vorlage.validatoren) gegen die Kette vorprüfen (Token mit
//      Stichprobe v2, gebunden und gewählt, keine offene Anmeldung, Stelle b =
//      dieses Konto, v = Zahl der Gelosten, Vorlage von der Inhaberin auf der
//      Kette unterschrieben), dann je Geloster die Hülle `oeffnung` {k, b} an ihren
//      Schlüssel aus dem Register (pubPasst). Die Präparatorin gibt erst nach
//      finaler Bindung und Wahl heraus (4c-1g) -- also später noch einmal sammeln.
//   2. oeffnungenSammeln: den eigenen Kasten (Adresse = Schlüssel der Stelle)
//      lesen; je Antwort {k, b, x, oeffnung, pakete, abschnitt}: Absender = die
//      Geloste x, ihr Abschnitt von ihr unterschrieben (abschnittPruefen), die
//      Öffnung mit dem eigenen Schlüssel lesbar und passend (oeffnungLesen). Nur
//      die erste gültige je x wird gesichert (vor dem Quittieren).
//   3. annehmenWegB: sind alle da, läuft GENAU annehmenAlsStelle -- mit einem
//      Adapter, der die gesicherten Antworten an Stelle der Validator-Dienste
//      liefert (eigene Adressen `https://geloste-<x>.weg-b.invalid`, nie im Netz).
//      Damit gelten dieselben Prüfungen wie in Weg A, unverändert: Blätter jeder
//      Gelosten von ihr unterschrieben und zusammen die Wurzel der Kette, jeder
//      Wert passt zu seinem Blatt und zu dieser Stelle, Stichprobe und Salze
//      ergeben die Bindung, Vorab-Rechnung, Anmelden, Urteil, BEFUND bei
//      Abweichung.
//   R9 (2f-2c): antwortet eine Geloste nicht, gilt der Ausweg aus Weg A: ihre
//      Blätter aus dem Paket des Ausgebers (er schickt es auch an beide Stellen;
//      beim Sammeln geprüft: jeder Abschnitt von seiner Gelosten unterschrieben,
//      alle Blätter die Wurzel der Kette; annehmenAlsStelle prüft sie noch einmal
//      an der Wurzel), ihre Werte aus mindestens t Paketen der anderen (`pakete`
//      in deren Antworten; jeder Wert gegen sein Blatt und sein Stellen-Bit).
//
// Die Liste der Gelosten kommt mit der Vorlage (Entscheidung 25.11.: die Kette
// speichert nur ihre Zahl). Falsche Namen bringen nichts: sie liefern keine
// Werte, die zu den Blättern der Wurzel auf der Kette passen -- die Stelle kann
// dann nur nicht einlösen, sie verliert nichts.
//
// Grenzen: v ≤ 16, eine Antwort ≤ ANTWORT_MAX, höchstens SEITEN_MAX Seiten Briefe je
// Sammeln, dazu die Grenzen von Hülle und Zusammensetzer.

import { ethers } from 'ethers';
import { ablegen, abholen, quittieren } from './briefkasten';
import { QuantenSFehler, abschnitt, abschnittPruefen, adresseVon, kanonisch, merkleWurzel, unterschreiben, unterschriftVon, vorlageText, type PaketAbschnitt } from './quantenS';
import { Zusammensetzer, einpacken, oeffnen, type Nachricht } from './quantenSHuelle';
import { holeJson, stand, type Umgebung } from './quantenSInhaberin';
import { REGISTER_MAX, registerLesen } from './quantenSPraeparator';
import { annehmenAlsStelle, oeffnungLesen, vorlageLesen, type AnnahmeErgebnis, type AnnahmeSchritt } from './quantenSStelle';

export const ANNAHME = 'aequitas.quantenS.stelle.wegb.annahme';
export const ANTWORT = 'aequitas.quantenS.stelle.wegb.antwort.';
/** Das Paket des Ausgebers (alle unterschriebenen Abschnitte), für den R9-Ausweg (2f-2c). */
export const PAKET = 'aequitas.quantenS.stelle.wegb.paket';
const NACH = 'aequitas.quantenS.stelle.wegb.nach';
const GESEHEN = 'aequitas.quantenS.stelle.wegb.gesehen';
/** Eine gesicherte Antwort (JSON). */
export const ANTWORT_MAX = 2 * 1024 * 1024;
export const SEITEN_MAX = 8;
const V_MAX = 16;
const HOST = /^https:\/\/geloste-(\d{1,2})\.weg-b\.invalid\/api\/quanten-w\/validator\/([a-z-]+)\?(.*)$/;
const ADRESSE = /^0x[0-9a-f]{40}$/;

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

interface Annahme {
  k: string;
  b: 0 | 1;
  validatoren: string[];
  /** die Vorlage, wie sie kam (Text des QR-Codes) */
  vorlage: string;
}

async function annahmeLesen(u: Umgebung): Promise<Annahme> {
  if (!u.ablage) fehler('ohne Ablage kein Weg B');
  const roh = await u.ablage.lesen(ANNAHME);
  if (roh === null) fehler('erst die Öffnungen anfordern');
  let a: Annahme;
  try {
    a = JSON.parse(roh) as Annahme;
  } catch {
    return fehler('Annahme im Gerät unlesbar');
  }
  const vl = vorlageLesen(a.vorlage);
  if (vl.k !== a.k || vl.b !== a.b || !vl.validatoren || vl.validatoren.join(',') !== a.validatoren.join(',')) fehler('Annahme im Gerät passt nicht zur Vorlage');
  return a;
}

/** Vorprüfung gegen die Kette (wie der Anfang von annehmenAlsStelle). */
async function vorpruefen(u: Umgebung, schluessel: string, vorlageRoh: string) {
  const ich = adresseVon(schluessel);
  const vl = vorlageLesen(vorlageRoh);
  if (!vl.validatoren) fehler('die Vorlage nennt keine Gelosten -- ein Token aus Weg A (Validator-Dienste)');
  const K = vl.k;
  const b = vl.b as 0 | 1;
  const st = await stand(u, K);
  if (!st) fehler('der Token steht nicht (mehr) auf der Kette -- eingelöst, tot oder nie ausgegeben');
  if (st.art !== 's' || st.probe_art !== 2) fehler('auf der Kette kein Token mit Stichprobe v2');
  if (st.gebunden !== true || st.gewaehlt !== true) fehler('erst nach Bindung und Wahl der Inhaberin');
  if (st.anmeldung != null) fehler('es gibt schon eine offene Anmeldung');
  const stellen = st.stellen;
  if (!Array.isArray(stellen) || stellen.length !== 2 || stellen[b] !== ich) fehler(`die Vorlage ist für Stelle ${b}, das ist nicht dieses Konto`);
  if (st.v !== vl.validatoren.length) fehler(`die Kette nennt v = ${String(st.v)}, die Vorlage ${vl.validatoren.length} Gelosten`);
  const n = st.n;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 2 || vl.x.length !== n) fehler('Vorlage: x passt nicht zu n auf der Kette');
  const inhaber = st.inhaber;
  if (typeof inhaber !== 'string' || !ADRESSE.test(inhaber)) fehler('Stand: Inhaberin');
  if (!kanonisch(vl.vorlage) || !unterschriftVon(vorlageText(K, b, vl.x), vl.vorlage, inhaber)) fehler('die Vorlage ist nicht von der Inhaberin auf der Kette unterschrieben');
  return { ich, vl, K, b, n, v: vl.validatoren.length, los: vl.validatoren };
}

/** Die laufende Annahme in Weg B (für die Seite), streng gelesen; ohne eine null. */
export async function annahmeWegBStand(u: Umgebung): Promise<{ k: string; b: 0 | 1; v: number } | null> {
  if (!u.ablage || (await u.ablage.lesen(ANNAHME)) === null) return null;
  const a = await annahmeLesen(u);
  return { k: a.k, b: a.b, v: a.validatoren.length };
}

/** Ist die Vorlage (Text des QR-Codes) eine aus Weg B (mit der Liste der Gelosten)? Wirft, wenn sie unlesbar ist. */
export function istWegBVorlage(text: string): boolean {
  return vorlageLesen(text).validatoren !== undefined;
}

/**
 * Phase 1: die Vorlage vorprüfen und jede Geloste um die Öffnung für diese
 * Stelle bitten. Noch einmal aufrufen ist erlaubt (dann nur an die, deren
 * Antwort fehlt).
 */
export async function oeffnungenAnfordern(u: Umgebung, schluessel: string, vorlageRoh: string): Promise<{ gesendet: number[] }> {
  if (!u.ablage) fehler('ohne Ablage kein Weg B');
  const { ich, K, b, v, los } = await vorpruefen(u, schluessel, vorlageRoh);
  // Schlüssel der Gelosten aus dem Register, jeder genau zu seiner Adresse.
  const { status, json } = await holeJson(u, `${u.apiBasis}/quanten-w/praeparatoren`, REGISTER_MAX);
  if (status !== 200) fehler('Register: keine Antwort');
  const reg = registerLesen(json);
  if (!reg) fehler('Register: Form');
  const pubs = los.map((konto) => {
    const e = reg.eintraege.filter((x) => x.konto === konto);
    if (e.length !== 1) fehler(`Geloste ${konto} nicht (eindeutig) im Register`);
    return e[0].pub;
  });
  // Eine andere Annahme vorher: deren Antworten zählen nie für diese.
  const alt = await u.ablage.lesen(ANNAHME);
  let altK = '';
  try {
    altK = alt ? String((JSON.parse(alt) as Annahme).k) : '';
  } catch {
    altK = '';
  }
  if (alt !== null && altK !== K) {
    for (let x = 1; x <= V_MAX; x++) await u.ablage.loeschen(ANTWORT + x);
    await u.ablage.loeschen(PAKET);
  }
  const annahme: Annahme = { k: K, b, validatoren: los, vorlage: vorlageRoh };
  await u.ablage.schreiben(ANNAHME, JSON.stringify(annahme), false);
  const jetzt = Math.floor(u.jetzt() / 1000);
  const signer = { signMessage: async (m: string) => unterschreiben(schluessel, m) };
  const gesendet: number[] = [];
  for (let x = 1; x <= v; x++) {
    if ((await u.ablage.lesen(ANTWORT + x)) !== null) continue;
    for (const brief of einpacken(schluessel, { adresse: los[x - 1], pub: pubs[x - 1] }, 'oeffnung', ethers.toUtf8Bytes(JSON.stringify({ k: K, b })), jetzt, u.zufall)) {
      await ablegen(ich, los[x - 1], brief, signer, jetzt, u.fetchFn, u.apiBasis);
    }
    gesendet.push(x);
  }
  return { gesendet };
}

interface Antwort {
  k: string;
  b: number;
  x: number;
  oeffnung: string;
  pakete: Record<string, string>;
  abschnitt: PaketAbschnitt;
}

/** Das Paket des Ausgebers streng lesen (genau k, validatoren, abschnitte; Abschnitte in Weg-B-Form). */
function paketLesen(m: Nachricht, K: string, v: number): PaketAbschnitt[] {
  if (m.nutzlast.length > ANTWORT_MAX * 2) fehler('Paket: zu groß');
  let o: unknown;
  try {
    o = JSON.parse(ethers.toUtf8String(m.nutzlast));
  } catch {
    return fehler('Paket: kein JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).sort().join(',') !== 'abschnitte,k,validatoren') fehler('Paket: Felder');
  const p = o as { k: unknown; abschnitte: unknown };
  if (p.k !== K) fehler('Paket: anderes K');
  if (!Array.isArray(p.abschnitte) || p.abschnitte.length !== v) fehler('Paket: Zahl der Abschnitte');
  const felder = 'basen_hash,bis,blaetter,buendel_hash,buendel_sig_hash,fuer_inhaberin,sig,teile,von,x,zaehlung';
  for (const ab of p.abschnitte) {
    if (!ab || typeof ab !== 'object' || Array.isArray(ab) || Object.keys(ab).sort().join(',') !== felder) fehler('Paket: Abschnitt, Felder');
  }
  return p.abschnitte as PaketAbschnitt[];
}

/** Die Antwort einer Gelosten streng lesen (genau diese Felder, Typen). */
function antwortLesen(m: Nachricht): Antwort {
  if (m.nutzlast.length > ANTWORT_MAX) fehler('Öffnung: zu groß');
  let o: unknown;
  try {
    o = JSON.parse(ethers.toUtf8String(m.nutzlast));
  } catch {
    return fehler('Öffnung: kein JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).sort().join(',') !== 'abschnitt,b,k,oeffnung,pakete,x') fehler('Öffnung: Felder');
  const a = o as Record<string, unknown>;
  if (typeof a.k !== 'string' || (a.b !== 0 && a.b !== 1) || typeof a.x !== 'number' || !Number.isInteger(a.x)) fehler('Öffnung: k, b, x');
  if (typeof a.oeffnung !== 'string' || !/^[0-9a-f]+$/.test(a.oeffnung)) fehler('Öffnung: Chiffrat');
  const p = a.pakete;
  if (!p || typeof p !== 'object' || Array.isArray(p) || !Object.entries(p).every(([k, c]) => /^[1-9][0-9]?$/.test(k) && typeof c === 'string' && /^[0-9a-f]+$/.test(c))) fehler('Öffnung: Pakete');
  if (!a.abschnitt || typeof a.abschnitt !== 'object' || Array.isArray(a.abschnitt)) fehler('Öffnung: Abschnitt');
  return a as unknown as Antwort;
}

/**
 * Phase 2: die Antworten aus dem eigenen Kasten sichern. Gibt die Nummern der
 * Gelosten, deren Antwort noch fehlt, und was abgewiesen wurde.
 */
export async function oeffnungenSammeln(u: Umgebung, schluessel: string): Promise<{ fehlen: number[]; neu: number[]; abgewiesen: string[]; paket: boolean }> {
  const a = await annahmeLesen(u);
  const ablage = u.ablage!;
  const ich = adresseVon(schluessel);
  const st = await stand(u, a.k);
  if (!st) fehler('der Token steht nicht (mehr) auf der Kette');
  const n = st.n as number;
  const v = a.validatoren.length;
  const signer = { signMessage: async (m: string) => unterschreiben(schluessel, m) };
  const jetzt = () => Math.floor(u.jetzt() / 1000);
  let gesehen: [string, number][] = [];
  const g = await ablage.lesen(GESEHEN);
  if (g !== null) {
    try {
      gesehen = JSON.parse(g) as [string, number][];
    } catch {
      fehler('Liste erledigter Hüllen beschädigt');
    }
  }
  const zs = new Zusammensetzer(gesehen);
  zs.aufraeumen(jetzt());
  const nachRoh = await ablage.lesen(NACH);
  if (nachRoh !== null && !/^\d{1,15}$/.test(nachRoh)) fehler('Zähler beschädigt');
  const nachStart = nachRoh === null ? 0 : Number(nachRoh);
  let nach = nachStart;
  const briefe: { id: number; schl: string | null }[] = [];
  const fertig: { m: Nachricht; schl: string }[] = [];
  const abgewiesen: string[] = [];
  for (let s = 0; s < SEITEN_MAX; s++) {
    const r = await abholen(ich, nach, signer, jetzt(), u.fetchFn, u.apiBasis);
    for (const b of r.briefe) {
      nach = b.id;
      try {
        const t = oeffnen(schluessel, b.inhalt, jetzt());
        const key = `${t.von}|${t.id}`;
        const m = zs.hinzu(t, jetzt());
        briefe.push({ id: b.id, schl: key });
        if (m) fertig.push({ m, schl: key });
      } catch (e) {
        briefe.push({ id: b.id, schl: null });
        abgewiesen.push((e as Error).message.slice(0, 200));
      }
    }
    if (!r.mehr) break;
  }
  await ablage.schreiben(GESEHEN, JSON.stringify(zs.gesehenListe()), false);
  const neu: number[] = [];
  let paket = false;
  for (const { m } of fertig) {
    if (m.art === 'paket') {
      // R9 (2f-2c): das Paket des Ausgebers -- jeder Abschnitt von seiner Gelosten
      // unterschrieben, alle Blätter zusammen die Wurzel der Kette. Wer es schickt, zählt nicht.
      try {
        const abschnitte = paketLesen(m, a.k, v);
        const blaetter: string[] = [];
        abschnitte.forEach((ab, i) => {
          abschnittPruefen(ab, a.k, n, v, i + 1, a.validatoren[i]);
          blaetter.push(...ab.blaetter);
        });
        if (merkleWurzel(blaetter) !== st.wurzel) fehler('Paket: die Blätter ergeben nicht die Wurzel auf der Kette');
        if ((await ablage.lesen(PAKET)) === null) {
          await ablage.schreiben(PAKET, JSON.stringify(abschnitte), false);
          paket = true;
        }
      } catch (e) {
        abgewiesen.push((e as Error).message.slice(0, 200));
      }
      continue;
    }
    if (m.art !== 'oeffnung') continue;
    try {
      const ant = antwortLesen(m);
      if (ant.k !== a.k || ant.b !== a.b) fehler('Öffnung: für einen anderen Token oder eine andere Stelle');
      const x = ant.x;
      if (x < 1 || x > v || m.von !== a.validatoren[x - 1]) fehler(`Öffnung ${x}: nicht von der Gelosten ${x}`);
      const ab = abschnitt(n, v, x);
      if (!ab) fehler('Abschnitte');
      // Ihr Abschnitt, von ihr unterschrieben; die Öffnung mit dem eigenen Schlüssel lesbar und passend.
      abschnittPruefen(ant.abschnitt, a.k, n, v, x, a.validatoren[x - 1]);
      oeffnungLesen(schluessel, ant.oeffnung, a.k, a.b, x, ab.von, ab.bis);
      if ((await ablage.lesen(ANTWORT + x)) !== null) continue; // die erste gültige zählt
      await ablage.schreiben(ANTWORT + x, JSON.stringify(ant), false);
      neu.push(x);
    } catch (e) {
      abgewiesen.push((e as Error).message.slice(0, 200));
    }
  }
  // Quittieren bis zum letzten Brief, vor dem alles erledigt ist.
  const fertigeSchl = new Set(fertig.map((f) => f.schl));
  let bis = nachStart;
  for (const b of briefe) {
    if (b.schl !== null && !fertigeSchl.has(b.schl)) break;
    bis = b.id;
  }
  if (bis > nachStart) {
    await quittieren(ich, bis, signer, jetzt(), u.fetchFn, u.apiBasis);
    await ablage.schreiben(NACH, String(bis), false);
  }
  const fehlen: number[] = [];
  for (let x = 1; x <= v; x++) if ((await ablage.lesen(ANTWORT + x)) === null) fehlen.push(x);
  return { fehlen, neu, abgewiesen, paket: paket || (await ablage.lesen(PAKET)) !== null };
}

/** Die Adresse, unter der der Adapter die Antwort der Gelosten x liefert (nie im Netz). */
export function gelosteApi(x: number): string {
  return `https://geloste-${x}.weg-b.invalid/api`;
}

/** Ein fetch, das die gesicherten Antworten wie die Validator-Dienste liefert; alles andere geht ans echte Netz. */
function adapter(echt: typeof fetch, antworten: (Antwort | null)[], alleBlaetter: string[] | null): typeof fetch {
  const antwort = (status: number, o: unknown) =>
    ({ ok: status === 200, status, text: async () => (o === null ? '' : JSON.stringify(o)) }) as unknown as Response;
  return (async (eingabe: RequestInfo | URL, init?: RequestInit) => {
    const url = String(eingabe);
    const t = HOST.exec(url);
    if (!url.includes('.weg-b.invalid')) return echt(eingabe, init);
    if (!t) return antwort(404, null);
    const x = Number(t[1]);
    const a = antworten[x - 1];
    if (!a) return antwort(404, null);
    const q = new URLSearchParams(t[3]);
    if (q.get('k') !== a.k) return antwort(404, null);
    switch (t[2]) {
      case 'fuer-inhaberin':
        return antwort(200, a.abschnitt);
      case 'oeffnung':
        return q.get('b') === String(a.b) ? antwort(200, { oeffnung: a.oeffnung }) : antwort(404, null);
      case 'anteil-oeffnung': {
        const p = a.pakete[q.get('x') ?? ''];
        return q.get('b') === String(a.b) && p ? antwort(200, { paket: p }) : antwort(404, null);
      }
      case 'blaetter':
        // R9: alle Blätter aus dem Paket des Ausgebers (annehmenAlsStelle prüft sie an der Wurzel).
        return alleBlaetter ? antwort(200, { blaetter: alleBlaetter }) : antwort(404, null);
      default:
        return antwort(404, null);
    }
  }) as typeof fetch;
}

/**
 * Phase 3: sind alle Antworten da, die Vorlage einlösen -- mit GENAU den
 * Prüfungen von annehmenAlsStelle (siehe oben).
 */
export async function annehmenWegB(u: Umgebung, schluessel: string, fortschritt: (s: AnnahmeSchritt) => void = () => {}): Promise<AnnahmeErgebnis> {
  const a = await annahmeLesen(u);
  const antworten: (Antwort | null)[] = [];
  const fehlend: number[] = [];
  for (let x = 1; x <= a.validatoren.length; x++) {
    const roh = await u.ablage!.lesen(ANTWORT + x);
    if (roh === null) {
      antworten.push(null);
      fehlend.push(x);
      continue;
    }
    let ant: Antwort;
    try {
      ant = JSON.parse(roh) as Antwort;
    } catch {
      return fehler(`Antwort ${x} im Gerät unlesbar`);
    }
    if (ant.x !== x || ant.k !== a.k || ant.b !== a.b) fehler(`Antwort ${x} im Gerät passt nicht`);
    antworten.push(ant);
  }
  // R9 (2f-2c): fehlen Gelosten, nur mit dem Paket des Ausgebers (ihre Blätter) und
  // genug anderen Antworten (ihre Pakete für die Werte, mindestens t).
  let alle: string[] | null = null;
  if (fehlend.length > 0) {
    const roh = await u.ablage!.lesen(PAKET);
    if (roh === null) fehler(`die Öffnung der Gelosten ${fehlend.join(', ')} fehlt noch, und es gibt kein Paket des Ausgebers -- erst sammeln`);
    const st = await stand(u, a.k);
    const t = st?.t;
    if (typeof t !== 'number' || a.validatoren.length - fehlend.length < t) fehler(`zu wenige Antworten für den Ausweg: ${a.validatoren.length - fehlend.length}, verlangt ${String(t)}`);
    try {
      alle = (JSON.parse(roh) as PaketAbschnitt[]).flatMap((ab) => ab.blaetter);
    } catch {
      return fehler('Paket im Gerät unlesbar');
    }
  }
  const validatoren = a.validatoren.map((adresse, i) => ({ adresse, api: gelosteApi(i + 1) }));
  return annehmenAlsStelle({ ...u, fetchFn: adapter(u.fetchFn, antworten, alle) }, schluessel, a.vorlage, validatoren, fortschritt);
}
