// IBM Quantum aus dem Handy (lib/ibmQuantum.ts): Anfragen in der belegten
// Form, Ergebnis-JSON wie qiskit-ibm-runtime es kodiert, alles fail-closed.
import { zlibSync } from 'fflate';
import { ethers } from 'ethers';
import ergebnisVektor from './vektoren/ibm_ergebnis_vektor.json';
import einfachVektor from './vektoren/ibm_ergebnis_einfach_vektor.json';
import auftragVektor from './vektoren/ibm_auftrag_vektor.json';
import {
  API_BASEN,
  API_BASIS,
  apiBasis,
  regionVon,
  API_VERSION,
  IAM_URL,
  IbmFehler,
  auftragKoerper,
  einreichen,
  ergebnisRoh,
  ergebnisSchuesse,
  geraeteListe,
  geraetWaehlen,
  instanzenSuchen,
  SUCHE_URL,
  holeToken,
  npyZeilen,
  status,
  zugangPruefen,
} from '../ibmQuantum';
import { abschnittAuswerten, abschnittKreise } from '../quantenSSchaltkreis';

const CRN = 'crn:v1:bluemix:public:quantum-computing:us-east:a/0123456789abcdef0123456789abcdef:01234567-89ab-cdef-0123-456789abcdef::';
const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_xy';
const TOKEN = 'eyJ' + 'x'.repeat(60);

type Aufruf = { url: string; init: RequestInit };
function netz(antworten: ((a: Aufruf) => { status: number; text: string })[]) {
  const aufrufe: Aufruf[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const a = { url, init };
    aufrufe.push(a);
    const r = antworten[aufrufe.length - 1](a);
    return { status: r.status, ok: r.status < 300, text: async () => r.text } as unknown as Response;
  }) as unknown as typeof fetch;
  return { f, aufrufe };
}

describe('Zugang und Token', () => {
  it('prüft Schlüssel und Instanz', () => {
    expect(zugangPruefen({ apiKey: ` ${KEY} `, crn: CRN })).toEqual({ apiKey: KEY, crn: CRN });
    expect(() => zugangPruefen({ apiKey: 'kurz', crn: CRN })).toThrow(IbmFehler);
    expect(() => zugangPruefen({ apiKey: KEY, crn: 'crn:v1:evil' })).toThrow('CRN');
    expect(() => zugangPruefen({ apiKey: KEY + '&x=1', crn: CRN })).toThrow('API');
  });

  it('holt das Token bei IBM Cloud IAM, Schlüssel nur im Formular', async () => {
    const { f, aufrufe } = netz([() => ({ status: 200, text: JSON.stringify({ access_token: TOKEN, expires_in: 3600, token_type: 'Bearer' }) })]);
    const t = await holeToken({ apiKey: KEY, crn: CRN }, 1000, f);
    expect(t).toEqual({ token: TOKEN, bis: 1000 + 3_600_000 });
    expect(aufrufe[0].url).toBe(IAM_URL);
    expect(aufrufe[0].init.method).toBe('POST');
    expect(aufrufe[0].init.redirect).toBe('error');
    expect(aufrufe[0].init.body).toBe(`grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${KEY}`);
  });

  it.each([
    ['HTTP 400', 400, '{"errorMessage":"Provided API key could not be found"}', 'HTTP 400'],
    ['kein JSON', 200, 'nein', 'kein JSON'],
    ['ohne Token', 200, '{"expires_in":3600}', 'Antwort'],
    ['ohne Laufzeit', 200, JSON.stringify({ access_token: TOKEN }), 'Antwort'],
  ])('Anmeldung scheitert: %s', async (_n, st, text, fehler) => {
    const { f } = netz([() => ({ status: st, text })]);
    await expect(holeToken({ apiKey: KEY, crn: CRN }, 0, f)).rejects.toThrow(fehler);
  });

  it('nennt den Schlüssel nie in einer Fehlermeldung', async () => {
    const { f } = netz([() => ({ status: 401, text: JSON.stringify({ errorMessage: KEY }) })]);
    await holeToken({ apiKey: KEY, crn: CRN }, 0, f).catch((e: Error) => expect(e.message).not.toContain(KEY));
  });
});

describe('Auftrag, Status, Ergebnis', () => {
  it('der Körper für die Probe ist genau der Prüfvektor', () => {
    const kreise = abschnittKreise(auftragVektor.u, auftragVektor.t, auftragVektor.y, auftragVektor.qubits);
    expect(kreise.map((k) => k.n)).toEqual(auftragVektor.kreise_n);
    expect(auftragKoerper('ibm_marrakesh', kreise.map((k) => k.qasm), auftragVektor.schuesse)).toBe(auftragVektor.koerper);
    const b = JSON.parse(auftragVektor.koerper);
    expect(b.program_id).toBe('sampler');
    expect(b.params.pubs[0][1]).toBeNull();
    expect(b.params.pubs[0][2]).toBe(5);
  });

  it.each([
    ['Backend mit Pfad', () => auftragKoerper('ibm/../x', ['OPENQASM 3.0;'], 5)],
    ['keine Schaltkreise', () => auftragKoerper('ibm_x', [], 5)],
    ['zu viele Schüsse', () => auftragKoerper('ibm_x', ['OPENQASM 3.0;'], 16)],
    ['kein QASM', () => auftragKoerper('ibm_x', ['import os'], 5)],
  ])('weist ab: %s', (_n, f) => {
    expect(f).toThrow(IbmFehler);
  });

  it('reicht mit den belegten Kopfzeilen ein und liest Status und Ergebnis', async () => {
    const { f, aufrufe } = netz([
      () => ({ status: 200, text: '{"id":"d1abcdef0123456789"}' }),
      () => ({ status: 200, text: '{"id":"d1abcdef0123456789","state":{"status":"Completed"}}' }),
      () => ({ status: 200, text: JSON.stringify(ergebnisVektor.ergebnis) }),
    ]);
    const id = await einreichen(TOKEN, CRN, auftragVektor.koerper, f);
    expect(id).toBe('d1abcdef0123456789');
    expect(await status(TOKEN, CRN, id, f)).toBe('COMPLETED');
    const roh = await ergebnisRoh(TOKEN, CRN, id, f);
    expect(aufrufe.map((a) => a.url)).toEqual([`${API_BASIS}/jobs`, `${API_BASIS}/jobs/${id}`, `${API_BASIS}/jobs/${id}/results`]);
    const h = aufrufe[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(h['Service-CRN']).toBe(CRN);
    expect(h['IBM-API-Version']).toBe(API_VERSION);
    expect(aufrufe.every((a) => a.init.redirect === 'error')).toBe(true);
    expect(ergebnisSchuesse(roh, [16, 16, 8, 3])).toEqual(ergebnisVektor.erwartet.map((e) => e.schuesse_hex));
  });

  it('weist eine fremde Kennung ab, bevor sie in eine Adresse kommt', async () => {
    const { f } = netz([]);
    await expect(status(TOKEN, CRN, '../../x', f)).rejects.toThrow('Kennung');
    await expect(ergebnisRoh(TOKEN, CRN, 'a/b', f)).rejects.toThrow('Kennung');
  });

  it('meldet einen abgelehnten Auftrag mit dem Grund von IBM', async () => {
    const { f } = netz([() => ({ status: 400, text: '{"errors":[{"message":"Invalid pubs","code":1234}]}' })]);
    await expect(einreichen(TOKEN, CRN, auftragVektor.koerper, f)).rejects.toThrow('HTTP 400 Invalid pubs');
  });

  it('kennt nur die belegten Status', async () => {
    const { f } = netz([() => ({ status: 200, text: '{"state":{"status":"Teleported"}}' })]);
    await expect(status(TOKEN, CRN, 'd1abcdef0123456789', f)).rejects.toThrow('unbekannt');
  });
});

describe('Ergebnis lesen (wie qiskit-ibm-runtime kodiert)', () => {
  it('liest die Schüsse des Vektors und wertet einen Abschnitt aus', () => {
    const s = ergebnisSchuesse(ergebnisVektor.ergebnis, [16, 16, 8, 3]);
    expect(s).toEqual(ergebnisVektor.erwartet.map((e) => e.schuesse_hex));
    expect(abschnittAuswerten([{ n: 16 }, { n: 16 }, { n: 8 }, { n: 3 }], s, 5)).toHaveLength(43);
  });

  const roh = () => JSON.parse(JSON.stringify(ergebnisVektor.ergebnis));
  const ba = (r: any, j = 0) => r.__value__.pub_results[j].__value__.data.__value__.fields.c.__value__;

  it.each([
    ['falsche Hülle', (r: any) => { r.__type__ = 'EstimatorResult'; }],
    ['ein Schaltkreis zu wenig', (r: any) => { r.__value__.pub_results.pop(); }],
    ['falsche Bitzahl', (r: any) => { ba(r).num_bits = 15; }],
    ['kein base64', (r: any) => { ba(r).array.__value__ = '%%%'; }],
    ['nicht entpackbar', (r: any) => { ba(r).array.__value__ = ethers.encodeBase64(new Uint8Array([1, 2, 3])); }],
    ['anderes Register', (r: any) => { const f = r.__value__.pub_results[0].__value__.data.__value__.fields; f.meas = f.c; delete f.c; }],
  ])('weist ab: %s', (_n, aendern) => {
    const r = roh();
    aendern(r);
    expect(() => ergebnisSchuesse(r, [16, 16, 8, 3])).toThrow(IbmFehler);
  });

  function npy(kopf: string, daten: number[]): Uint8Array {
    let k = kopf;
    while ((10 + k.length + 1) % 64 !== 0) k += ' ';
    k += '\n';
    const out = new Uint8Array(10 + k.length + daten.length);
    out.set([0x93, ...Array.from('NUMPY').map((c) => c.charCodeAt(0)), 1, 0, k.length & 0xff, k.length >> 8]);
    out.set(Array.from(k).map((c) => c.charCodeAt(0)), 10);
    out.set(daten, 10 + k.length);
    return out;
  }

  it('npy: nur |u1, C-Ordnung, 2D, Größe passend', () => {
    expect(npyZeilen(npy("{'descr': '|u1', 'fortran_order': False, 'shape': (2, 1), }", [5, 7])).map((z) => Array.from(z))).toEqual([[5], [7]]);
    expect(() => npyZeilen(npy("{'descr': '<i8', 'fortran_order': False, 'shape': (2, 1), }", [5, 7]))).toThrow('Typ');
    expect(() => npyZeilen(npy("{'descr': '|u1', 'fortran_order': True, 'shape': (2, 1), }", [5, 7]))).toThrow('Typ');
    expect(() => npyZeilen(npy("{'descr': '|u1', 'fortran_order': False, 'shape': (3, 1), }", [5, 7]))).toThrow('Größe');
    expect(() => npyZeilen(npy("{'descr': '|u1', 'fortran_order': False, 'shape': (16, 1), }", Array(16).fill(0)))).toThrow('Größe');
  });

  it('Bits über n im Ergebnis: abgewiesen', () => {
    const r = roh();
    const n = npy("{'descr': '|u1', 'fortran_order': False, 'shape': (5, 1), }", [8, 0, 0, 0, 0]);
    r.__value__.pub_results[3].__value__.data.__value__.fields.c.__value__.array.__value__ = ethers.encodeBase64(zlibSync(n));
    expect(() => ergebnisSchuesse(r, [16, 16, 8, 3])).toThrow('Bits über n');
  });
});

describe('Ergebnis lesen (einfache Form der IBM-Doku)', () => {
  const N = [16, 16, 8, 3];
  it('liest results[i].data.c.samples genau wie die kodierte Form', () => {
    expect(ergebnisSchuesse(einfachVektor.ergebnis, N)).toEqual(ergebnisSchuesse(ergebnisVektor.ergebnis, N));
    expect(ergebnisSchuesse(einfachVektor.ergebnis, N)).toEqual(einfachVektor.erwartet.map((e) => e.schuesse_hex));
  });

  it('ohne num_bits und mit Großbuchstaben/führenden Nullen: gleich gelesen', () => {
    const r = JSON.parse(JSON.stringify(einfachVektor.ergebnis));
    delete r.results[2].data.c.num_bits;
    r.results[0].data.c.samples[0] = '0x' + r.results[0].data.c.samples[0].slice(2).toUpperCase().padStart(4, '0');
    expect(ergebnisSchuesse(r, N)).toEqual(einfachVektor.erwartet.map((e) => e.schuesse_hex));
  });

  const roh = () => JSON.parse(JSON.stringify(einfachVektor.ergebnis));
  it.each([
    ['ein Schaltkreis zu wenig', (r: any) => { r.results.pop(); }],
    ['ein Schaltkreis zu viel', (r: any) => { r.results.push(r.results[0]); }],
    ['falsche Bitzahl', (r: any) => { r.results[0].data.c.num_bits = 15; }],
    ['Bits über n', (r: any) => { r.results[3].data.c.samples[0] = '0x8'; }],
    ['kein Hex', (r: any) => { r.results[0].data.c.samples[0] = '17'; }],
    ['Zahl statt Text', (r: any) => { r.results[0].data.c.samples[0] = 17; }],
    ['zu lang', (r: any) => { r.results[0].data.c.samples[0] = '0x00001'; }],
    ['zu viele Schüsse', (r: any) => { r.results[0].data.c.samples = Array(16).fill('0x1'); }],
    ['keine Schüsse', (r: any) => { r.results[0].data.c.samples = []; }],
    ['anderes Register', (r: any) => { r.results[0].data.meas = r.results[0].data.c; delete r.results[0].data.c; }],
    ['zusätzliches Register', (r: any) => { r.results[0].data.d = r.results[0].data.c; }],
    ['results kein Feld', (r: any) => { r.results = {}; }],
  ])('weist ab: %s', (_n, aendern) => {
    const r = roh();
    aendern(r);
    expect(() => ergebnisSchuesse(r, N)).toThrow(IbmFehler);
  });

  it.each([
    ['null', null],
    ['Liste', []],
    ['ohne Form', { ergebnis: 1 }],
  ])('weist ab: Hülle %s', (_n, r) => {
    expect(() => ergebnisSchuesse(r, N)).toThrow(IbmFehler);
  });

  it('weist eine unsinnige Erwartung ab', () => {
    expect(() => ergebnisSchuesse(einfachVektor.ergebnis, [])).toThrow(IbmFehler);
    expect(() => ergebnisSchuesse(einfachVektor.ergebnis, [17, 16, 8, 3])).toThrow(IbmFehler);
    const nur = { results: [{ data: { c: { samples: ['0x0'] } } }] };
    expect(ergebnisSchuesse(nur, [16])).toEqual([['0x0']]);
    expect(() => ergebnisSchuesse(nur, [17])).toThrow('Schaltkreise');
    expect(() => ergebnisSchuesse(nur, [0])).toThrow('Schaltkreise');
  });
});

describe('Instanz und Gerät finden (wie qiskit-ibm-runtime least_busy)', () => {
  const CRN2 = CRN.replace('01234567-89ab', '11111111-89ab');
  const suche = (items: unknown[]) => () => ({ status: 200, text: JSON.stringify({ items }) });
  const geraete = (devices: unknown[]) => () => ({ status: 200, text: JSON.stringify({ devices }) });
  const dev = (name: string, q: number, extra: object = {}) => ({ name, status: { name: 'online' }, queue_length: q, qubits: 156, ...extra });

  it('sucht die Instanzen über Global Search, nur mit dem Token', async () => {
    const { f, aufrufe } = netz([suche([{ crn: CRN2 }, { crn: CRN }, { crn: CRN }, { crn: 'crn:v1:evil' }, { name: 'ohne' }])]);
    expect(await instanzenSuchen(TOKEN, f)).toEqual([CRN, CRN2].sort());
    expect(aufrufe[0].url).toBe(SUCHE_URL);
    expect(aufrufe[0].init.method).toBe('POST');
    expect(aufrufe[0].init.redirect).toBe('error');
    expect(JSON.parse(String(aufrufe[0].init.body))).toEqual({ query: 'service_name:quantum-computing', fields: ['crn', 'name'] });
    expect((aufrufe[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    ['HTTP 401', () => ({ status: 401, text: '{}' }), 'HTTP 401'],
    ['keine Instanz', suche([]), 'keine Quantum-Instanz'],
    ['nur fremde', suche([{ crn: 'crn:v1:bluemix:public:cloud-object-storage:global:a/0123456789abcdef0123456789abcdef:01234567-89ab-cdef-0123-456789abcdef::' }]), 'keine Quantum-Instanz'],
    ['zu viele', suche(Array(101).fill({ crn: CRN })), 'Antwort'],
    ['keine Liste', () => ({ status: 200, text: '{"items":{}}' }), 'Antwort'],
  ])('Suche scheitert: %s', async (_n, antwort, fehler) => {
    const { f } = netz([antwort]);
    await expect(instanzenSuchen(TOKEN, f)).rejects.toThrow(fehler);
  });

  it('höchstens 8 Instanzen', async () => {
    const viele = Array.from({ length: 20 }, (_, i) => ({ crn: CRN.replace('01234567-89ab', `${String(i).padStart(8, '0')}-89ab`) }));
    const { f } = netz([suche(viele)]);
    expect(await instanzenSuchen(TOKEN, f)).toHaveLength(8);
  });

  it('Geräte: nur frei und echt, kürzeste Schlange zuerst', async () => {
    const { f, aufrufe } = netz([
      geraete([
        dev('ibm_b', 5),
        dev('ibm_a', 5),
        dev('ibm_c', 1, { status: { name: 'paused' } }),
        dev('ibm_d', 0, { class: 'mock' }),
        dev('ibm/../x', 0),
        dev('ibm_e', -1),
        dev('ibm_f', 3),
        { name: 'ibm_g' },
      ]),
    ]);
    expect((await geraeteListe(TOKEN, CRN, f)).map((g) => g.name)).toEqual(['ibm_f', 'ibm_a', 'ibm_b']);
    expect(aufrufe[0].url).toBe(`${API_BASIS}/backends`);
    expect((aufrufe[0].init.headers as Record<string, string>)['Service-CRN']).toBe(CRN);
    await expect(geraeteListe(TOKEN, 'crn:v1:evil', f)).rejects.toThrow('CRN');
  });

  it('Geräte: zu lange Liste abgewiesen', async () => {
    const { f } = netz([geraete(Array(257).fill(dev('ibm_a', 1)))]);
    await expect(geraeteListe(TOKEN, CRN, f)).rejects.toThrow('Antwort');
  });

  it('wählt über alle Instanzen das Gerät mit der kürzesten Schlange und genug Qubits', async () => {
    const { f } = netz([
      suche([{ crn: CRN }, { crn: CRN2 }]),
      geraete([dev('ibm_klein', 0, { qubits: 5 }), dev('ibm_x', 7)]),
      geraete([dev('ibm_y', 2)]),
    ]);
    expect(await geraetWaehlen(TOKEN, 16, f)).toEqual({ crn: CRN2, geraet: { name: 'ibm_y', schlange: 2, qubits: 156 } });
    const umgekehrt = netz([suche([{ crn: CRN }, { crn: CRN2 }]), geraete([dev('ibm_y', 2)]), geraete([dev('ibm_x', 7)])]);
    expect((await geraetWaehlen(TOKEN, 16, umgekehrt.f)).geraet.name).toBe('ibm_y');
  });

  it('überspringt eine Instanz ohne Zugang, nicht aber andere Fehler', async () => {
    const a = netz([suche([{ crn: CRN }, { crn: CRN2 }]), () => ({ status: 403, text: '{}' }), geraete([dev('ibm_y', 2)])]);
    expect((await geraetWaehlen(TOKEN, 16, a.f)).crn).toBe(CRN2);
    const b = netz([suche([{ crn: CRN }, { crn: CRN2 }]), () => ({ status: 500, text: '{}' }), geraete([dev('ibm_y', 2)])]);
    await expect(geraetWaehlen(TOKEN, 16, b.f)).rejects.toThrow('HTTP 500');
  });

  it('kein freies Gerät oder unsinnige Qubitzahl: Fehler', async () => {
    const { f } = netz([suche([{ crn: CRN }]), geraete([dev('ibm_klein', 0, { qubits: 5 })])]);
    await expect(geraetWaehlen(TOKEN, 16, f)).rejects.toThrow('kein freies Gerät');
    await expect(geraetWaehlen(TOKEN, 17, netz([]).f)).rejects.toThrow('Qubits');
  });
});

describe('Region der Instanz bestimmt die Adresse (wie qiskit-ibm-runtime)', () => {
  const EU = CRN.replace(':us-east:', ':eu-de:');
  const FREMD = CRN.replace(':us-east:', ':jp-tok:');
  const dev = { name: 'ibm_y', status: { name: 'online' }, queue_length: 2, qubits: 156 };

  it('feste Tabelle: us-east ohne Vorsilbe, eu-de mit', () => {
    expect(apiBasis(CRN)).toBe('https://quantum.cloud.ibm.com/api/v1');
    expect(apiBasis(EU)).toBe('https://eu-de.quantum.cloud.ibm.com/api/v1');
    expect(Object.keys(API_BASEN).sort()).toEqual(['eu-de', 'us-east']);
    expect(regionVon(EU)).toBe('eu-de');
  });

  it('unbekannte Region wird abgewiesen, nie als Hostname benutzt', async () => {
    expect(() => apiBasis(FREMD)).toThrow('Region');
    expect(() => zugangPruefen({ apiKey: KEY, crn: FREMD })).toThrow('Region');
    const { f, aufrufe } = netz([]);
    await expect(einreichen(TOKEN, FREMD, '{}', f)).rejects.toThrow('Region');
    await expect(status(TOKEN, FREMD, 'd1abcdef0123456789', f)).rejects.toThrow('Region');
    await expect(geraeteListe(TOKEN, FREMD, f)).rejects.toThrow('Region');
    expect(aufrufe).toHaveLength(0);
  });

  it('Aufträge, Status, Ergebnis und Geräte einer eu-de-Instanz gehen an eu-de', async () => {
    const { f, aufrufe } = netz([
      () => ({ status: 200, text: '{"id":"d1abcdef0123456789"}' }),
      () => ({ status: 200, text: '{"state":{"status":"Running"}}' }),
      () => ({ status: 200, text: '{}' }),
      () => ({ status: 200, text: JSON.stringify({ devices: [dev] }) }),
    ]);
    const id = await einreichen(TOKEN, EU, auftragVektor.koerper, f);
    await status(TOKEN, EU, id, f);
    await ergebnisRoh(TOKEN, EU, id, f);
    await geraeteListe(TOKEN, EU, f);
    const eu = 'https://eu-de.quantum.cloud.ibm.com/api/v1';
    expect(aufrufe.map((a) => a.url)).toEqual([`${eu}/jobs`, `${eu}/jobs/${id}`, `${eu}/jobs/${id}/results`, `${eu}/backends`]);
  });

  it('Suche: Instanzen unbekannter Regionen werden übergangen; Wahl über Regionen hinweg', async () => {
    const { f, aufrufe } = netz([
      () => ({ status: 200, text: JSON.stringify({ items: [{ crn: FREMD }, { crn: EU }, { crn: CRN }] }) }),
      () => ({ status: 200, text: JSON.stringify({ devices: [{ ...dev, name: 'ibm_eu', queue_length: 1 }] }) }),
      () => ({ status: 200, text: JSON.stringify({ devices: [{ ...dev, name: 'ibm_us', queue_length: 9 }] }) }),
    ]);
    const w = await geraetWaehlen(TOKEN, 16, f);
    expect(w).toEqual({ crn: EU, geraet: { name: 'ibm_eu', schlange: 1, qubits: 156 } });
    expect(aufrufe.slice(1).map((a) => a.url)).toEqual(['https://eu-de.quantum.cloud.ibm.com/api/v1/backends', `${API_BASIS}/backends`]);
  });
});
