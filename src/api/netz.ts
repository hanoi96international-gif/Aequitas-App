import { CHAIN_ID_DEC } from '@/lib/config';

// Netzabgleich (docs/NEUBAU_ANALYSE.md G "Chain-ID- und Netzabgleich fail-closed").
//
// /api/status liefert chain_evm_id und -- seit der Kette mit
// api_app_grundlagen.go -- netz_kennung = "aequitas-<chainID>-<genesis-unix>".
// Die Kennung aendert sich nur beim Neustart der Kette bei null. Dann gelten
// fruehere Registrierungen und Guthaben nicht mehr; die App muss das sagen,
// statt alte Staende weiterzuzeigen.
//
// Die Antwort kommt von einem Knoten und ist damit feindlich, bis sie
// geprueft ist:
//   - Falsche oder fehlende Chain-ID  -> 'fremdeKette' (nichts signieren).
//   - Kennung vorhanden, aber nicht im erwarteten Format -> 'ungueltig'
//     (nichts signieren; auch kein Speichern der Kennung).
//   - Kennung fehlt ganz -> 'ok' ohne Kennung: aeltere Knoten kennen das Feld
//     noch nicht. Einen Wechsel koennen wir dann nicht erkennen, aber auch
//     nichts Falsches behaupten.
//   - Andere Kennung als gespeichert -> 'gewechselt'. Das loescht NIE einen
//     Schluessel: der Mensch bestaetigt, danach werden nur lokale Kopien von
//     Kettenstaenden verworfen. Ein luegender Knoten kann so hoechstens einen
//     Hinweis ausloesen, keinen Schaden.

export type NetzBefund =
  | { art: 'ok'; kennung: string | null }
  | { art: 'erstmals'; kennung: string }
  | { art: 'gewechselt'; bisher: string; neu: string }
  | { art: 'fremdeKette' }
  | { art: 'ungueltig' };

const KENNUNG = new RegExp(`^aequitas-${CHAIN_ID_DEC}-\\d{1,12}$`);

export function gueltigeKennung(k: unknown): k is string {
  return typeof k === 'string' && k.length <= 40 && KENNUNG.test(k);
}

export function pruefeNetz(status: unknown, gespeichert: string | null): NetzBefund {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return { art: 'ungueltig' };
  const s = status as Record<string, unknown>;
  if (s.chain_evm_id !== CHAIN_ID_DEC) return { art: 'fremdeKette' };
  const k = s.netz_kennung;
  if (k === undefined || k === null) return { art: 'ok', kennung: null };
  if (!gueltigeKennung(k)) return { art: 'ungueltig' };
  // Ein beschaedigter Speicherwert zaehlt wie "noch nichts gespeichert".
  if (!gueltigeKennung(gespeichert)) return { art: 'erstmals', kennung: k };
  if (k !== gespeichert) return { art: 'gewechselt', bisher: gespeichert, neu: k };
  return { art: 'ok', kennung: k };
}

/** Darf die App in diesem Netzzustand signieren? Nur bei bekanntem, gleichem Netz. */
export function signierenErlaubt(b: NetzBefund | null): boolean {
  return !!b && (b.art === 'ok' || b.art === 'erstmals');
}
