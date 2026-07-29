/**
 * Client für den Proof-of-Personhood-Coordinator (aequitas-biometric-beta).
 *
 * Ersetzt die bisherige Herkunft des `bio`-Werts. Bislang erzeugte
 * `identity.ts` ihn als Zufallszahl im Keystore des Geräts — was bedeutete,
 * dass eine Neuinstallation eine neue Identität ergab und ein Mensch mit n
 * Installationen n Identitäten hatte. Der Wert kam jetzt vom Coordinator,
 * der ihn erst nach einem Handflächen-/Gesichtsabgleich gegen alle bisherigen
 * Registrierungen vergibt, bestätigt durch ein M-of-N-Quorum unabhängiger
 * Validatoren.
 *
 * Die Reihenfolge der Aufrufe ist nicht beliebig: `fetchChallenge()` MUSS vor
 * der Aufnahme laufen. Der ganze Wert der Challenge liegt darin, dass der
 * Coordinator sie zu einem Zeitpunkt wählt, zu dem eine vorbereitete oder
 * eingespeiste Aufnahme bereits hätte existieren müssen. Holt der Client sie
 * erst nachträglich, ist sie wertlos.
 */
import { COORDINATOR_BASE } from './config';

export type ChallengeType = 'look_left' | 'look_right' | 'look_up' | 'look_down' | 'smile';

export interface Challenge {
  nonce: string;
  challengeType: ChallengeType;
}

export interface CoordinatorResult {
  decision: string;
  bioHash: string | null;
  /** Ed25519-Signatur des Coordinators über (bio_hash, wallet, issued_at). */
  attestation: string | null;
  attestationIssuedAt: number | null;
  /** Grund, warum die Lebenderkennung ablehnte — für eine verständliche Meldung. */
  challengeReason: string | null;
  challengePassed: boolean | null;
  raw: any;
}

/** Menschlich lesbare Anweisung. Wird auf dem Gerät angezeigt, bevor der
 *  Burst startet, und muss deshalb hier stehen und nicht serverseitig — der
 *  Coordinator kennt die Sprache des Nutzers nicht. */
export const CHALLENGE_PROMPTS: Record<ChallengeType, string> = {
  look_left: 'Kopf nach LINKS drehen',
  look_right: 'Kopf nach RECHTS drehen',
  look_up: 'nach OBEN schauen',
  look_down: 'nach UNTEN schauen',
  smile: 'LÄCHELN',
};

/** Frames pro Burst und Abstand zwischen ihnen.
 *
 *  25 Frames sind kein runder Zufallswert: pulse.py verlangt mindestens 20,
 *  sonst liefert die rPPG-Schätzung `too_few_frames` und die Pulsprüfung kann
 *  grundsätzlich nie greifen. 100 ms ergeben 2,5 Sekunden — genug für eine
 *  bewusste Kopfdrehung, ohne dass es sich zieht. */
export const BURST_FRAME_COUNT = 25;
export const BURST_INTERVAL_MS = 100;

/** Vorlaufzeit, bevor der Burst startet. Ohne sie konkurriert die
 *  Reaktionszeit des Nutzers mit der gesamten Aufnahmedauer: bis jemand
 *  „Kopf nach links drehen" gelesen hat, wäre der Burst halb vorbei, und die
 *  Prüfung schlüge fehl, obwohl nur die Zeit fehlte. */
export const COUNTDOWN_SECONDS = 3;

function base(): string {
  return COORDINATOR_BASE.replace(/\/$/, '');
}

export async function fetchChallenge(): Promise<Challenge> {
  const resp = await fetch(`${base()}/challenge`, { method: 'POST' });
  if (!resp.ok) throw new Error(`Coordinator antwortete mit HTTP ${resp.status}`);
  const body = await resp.json();
  return { nonce: body.nonce, challengeType: body.challenge_type };
}

export interface SubmitParams {
  wallet: string;
  deviceId: string;
  challengeNonce: string;
  /** file:// URIs der aufgenommenen Bilder. */
  palmUri: string;
  faceUris: string[];
  /**
   * GEMESSENER mittlerer Abstand zwischen zwei Burst-Bildern, nicht der
   * angestrebte Wert BURST_INTERVAL_MS.
   *
   * Der Unterschied ist nicht kosmetisch: die rPPG-Pulsschätzung des
   * Validators leitet die Herzfrequenz aus genau diesem Abstand ab. Auf einem
   * langsamen Gerät braucht ein Bild leicht das Doppelte der angestrebten
   * 100 ms — würde die App trotzdem 100 melden, käme eine um den Faktor zwei
   * falsche Frequenz heraus, und ein völlig normaler Puls fiele aus dem
   * plausiblen Bereich.
   */
  burstIntervalMs: number;
  consentVersion: string;
  consentedAt: number;
}

export async function submitCapture(params: SubmitParams): Promise<CoordinatorResult> {
  const form = new FormData();
  // `mode` wird bewusst NICHT gesendet: der Coordinator nimmt seinen
  // Betriebsmodus aus der eigenen Konfiguration. Als Requestfeld ließ er sich
  // auf "test" setzen, um gegen die in Produktion leere Testtabelle geprüft
  // zu werden und trotzdem einen verwertbaren bio_hash zu erhalten.
  form.append('device_id', params.deviceId);
  form.append('wallet_address', params.wallet);
  form.append('challenge_nonce', params.challengeNonce);
  form.append('burst_interval_ms', String(params.burstIntervalMs));
  form.append('consent_version', params.consentVersion);
  form.append('consented_at', String(params.consentedAt));

  form.append('palm_image', {
    uri: params.palmUri, name: 'palm.jpg', type: 'image/jpeg',
  } as any);
  // Das erste Burst-Bild dient zusätzlich als Primärbild für den
  // Antispoof-Klassifikator, der ohne Burst arbeitet.
  form.append('face_image', {
    uri: params.faceUris[0], name: 'face.jpg', type: 'image/jpeg',
  } as any);
  params.faceUris.forEach((uri, i) => {
    form.append('face_burst', { uri, name: `burst_${i}.jpg`, type: 'image/jpeg' } as any);
  });

  const resp = await fetch(`${base()}/register`, { method: 'POST', body: form });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(body?.detail || body?.error || `Coordinator antwortete mit HTTP ${resp.status}`);
  }

  // Der Grund steckt in den Einzelstimmen der Validatoren, nicht auf oberster
  // Ebene. Ohne ihn stünde bei einer Ablehnung nur "liveness_failed" da, und
  // der Nutzer wüsste nicht, ob er sich zu wenig bewegt hat oder ob das Licht
  // zu schlecht war.
  const firstVote = Array.isArray(body.votes) && body.votes.length > 0 ? body.votes[0] : null;

  return {
    decision: body.decision,
    bioHash: body.bio_hash ?? null,
    attestation: body.bio_hash_signature ?? null,
    attestationIssuedAt: body.bio_hash_issued_at ?? null,
    challengeReason: firstVote?.challenge_reason ?? null,
    challengePassed: firstVote?.challenge_passed ?? null,
    raw: body,
  };
}

/** Übersetzt eine Coordinator-Entscheidung in einen Satz, der dem Nutzer
 *  sagt, was er anders machen soll. Eine rohe Kennung wie
 *  "motion_ambiguous_both_directions" hilft niemandem vor dem Gerät. */
export function explainDecision(result: CoordinatorResult): string {
  switch (result.decision) {
    case 'new_enrollment':
      return 'Prüfung bestanden.';
    case 'duplicate_detected':
      return 'Diese Person ist bereits registriert. Pro Mensch ist genau eine Registrierung möglich.';
    case 'challenge_required':
      return 'Die Aufgabe wurde nicht mitgesendet. Bitte die Aufnahme erneut starten.';
    case 'liveness_failed':
      switch (result.challengeReason) {
        case 'insufficient_motion_in_requested_direction':
          return 'Die Bewegung war zu klein. Den Kopf deutlicher in die gezeigte Richtung drehen.';
        case 'motion_ambiguous_both_directions':
          return 'Der Kopf hat sich in beide Richtungen bewegt. Nur in die gezeigte Richtung drehen und dort halten.';
        case 'insufficient_frames':
          return 'Das Gesicht war zu selten erkennbar. Mehr Licht, und das Gesicht im Rahmen halten.';
        default:
          return 'Die Lebenderkennung ist fehlgeschlagen. Bitte in gutem Licht erneut versuchen.';
      }
    case 'capture_failed':
      return 'Handfläche oder Gesicht waren nicht auswertbar. Beide formatfüllend und scharf aufnehmen.';
    case 'risk_blocked':
      return 'Zu viele Versuche von diesem Gerät. Bitte später erneut versuchen.';
    case 'quorum_failed':
      return 'Die Validatoren sind zu keiner gemeinsamen Entscheidung gekommen. Bitte erneut versuchen.';
    case 'missing_consent':
      return 'Ohne Einwilligung ist keine Registrierung möglich.';
    case 'invalid_mode':
      // Kein Nutzerfehler und durch Wiederholen nicht zu beheben: der
      // Coordinator und seine Validatoren sind unterschiedlich konfiguriert.
      return 'Der Prüfdienst ist derzeit falsch konfiguriert. Das lässt sich auf dem Gerät nicht beheben — bitte später erneut versuchen.';
    default:
      return `Unerwartete Antwort des Coordinators: ${result.decision}`;
  }
}
