import {
  BURST_FRAME_COUNT,
  BURST_INTERVAL_MS,
  COUNTDOWN_SECONDS,
  CHALLENGE_PROMPTS,
  explainDecision,
  type CoordinatorResult,
} from '../biometric';

function result(over: Partial<CoordinatorResult>): CoordinatorResult {
  return {
    decision: 'new_enrollment',
    bioHash: null,
    attestation: null,
    attestationIssuedAt: null,
    challengeReason: null,
    challengePassed: null,
    raw: {},
    ...over,
  };
}

describe('capture constants', () => {
  // Kein Stilcheck: der Validator kann die Pulsschätzung unter 20 Bildern
  // grundsätzlich nicht durchführen (pulse.py liefert dann `too_few_frames`).
  // Wer BURST_FRAME_COUNT senkt, um die Aufnahme zu verkürzen, schaltet damit
  // unbemerkt eine ganze Prüfstufe ab.
  it('captures enough frames for the validator to estimate a pulse at all', () => {
    expect(BURST_FRAME_COUNT).toBeGreaterThanOrEqual(20);
  });

  // Bei 100 ms liegt die Abtastrate bei 10 Hz. Ein Puls von 60-180 bpm sind
  // 1-3 Hz; das Nyquist-Kriterium verlangt mehr als das Doppelte davon.
  // Ein Intervall über 160 ms (< 6,25 Hz) macht 180 bpm nicht mehr sicher
  // auflösbar.
  it('samples fast enough to resolve a plausible heart rate', () => {
    expect(BURST_INTERVAL_MS).toBeLessThanOrEqual(160);
  });

  it('gives the user time to read the task before the burst starts', () => {
    expect(COUNTDOWN_SECONDS).toBeGreaterThanOrEqual(2);
  });

  // Ein Challenge-Typ ohne Anweisungstext ergäbe einen leeren Bildschirm,
  // auf dem der Nutzer raten müsste, was zu tun ist — und die Prüfung würde
  // scheitern, ohne dass er es beeinflussen konnte.
  it('has a prompt for every challenge type the coordinator can issue', () => {
    for (const type of ['look_left', 'look_right', 'look_up', 'look_down', 'smile'] as const) {
      expect(CHALLENGE_PROMPTS[type]).toBeTruthy();
    }
  });
});

describe('explainDecision', () => {
  it('names the concrete corrective action for each liveness reason', () => {
    const tooSmall = explainDecision(
      result({ decision: 'liveness_failed', challengeReason: 'insufficient_motion_in_requested_direction' })
    );
    const bothWays = explainDecision(
      result({ decision: 'liveness_failed', challengeReason: 'motion_ambiguous_both_directions' })
    );
    expect(tooSmall).not.toBe(bothWays);
    expect(tooSmall).toMatch(/deutlicher/i);
    expect(bothWays).toMatch(/beide/i);
  });

  it('falls back to a usable sentence for an unknown liveness reason', () => {
    const text = explainDecision(
      result({ decision: 'liveness_failed', challengeReason: 'something_new_from_a_future_validator' })
    );
    expect(text).toMatch(/Lebenderkennung/);
    expect(text).not.toMatch(/something_new/);
  });

  // Jede Entscheidung, die der Coordinator zurückgeben kann, muss einen
  // erklärenden Satz haben. Fällt eine durch, sieht der Nutzer eine rohe
  // Kennung wie "risk_blocked" und weiß nicht, ob er etwas falsch gemacht hat
  // oder ob der Dienst kaputt ist.
  it('covers every decision main.py can return', () => {
    const decisions = [
      'new_enrollment',
      'duplicate_detected',
      'challenge_required',
      'liveness_failed',
      'capture_failed',
      'risk_blocked',
      'quorum_failed',
      'missing_consent',
      'invalid_mode',
    ];
    for (const decision of decisions) {
      const text = explainDecision(result({ decision }));
      expect(text).not.toMatch(/Unerwartete Antwort/);
      expect(text.length).toBeGreaterThan(10);
    }
  });

  it('still says something when the coordinator invents a new decision', () => {
    expect(explainDecision(result({ decision: 'brand_new_decision' }))).toMatch(/brand_new_decision/);
  });
});
