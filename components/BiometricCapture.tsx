/**
 * Aufnahmeablauf für den Proof-of-Personhood-Coordinator.
 *
 * Die Reihenfolge der Schritte ist nicht kosmetisch. Die Challenge wird
 * geholt, BEVOR die Kamera überhaupt anläuft: ihr ganzer Wert liegt darin,
 * dass der Coordinator die Aufgabe zu einem Zeitpunkt wählt, zu dem eine
 * vorbereitete oder eingespielte Aufnahme bereits hätte existieren müssen.
 * Würde die App sie erst nach der Aufnahme abrufen, wäre sie wertlos — man
 * könnte ein passendes Video nachreichen.
 *
 * Ebenso bewusst: die Einwilligung steht vor dem ersten Kamerabild, nicht
 * dazwischen. Der Coordinator verlangt `consent_version` und `consented_at`
 * und lehnt ohne sie ab; wichtiger ist aber, dass zu dem Zeitpunkt, zu dem
 * jemand zustimmt, noch keine Aufnahme existiert, der zugestimmt werden
 * müsste.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useLanguage } from '@/contexts/LanguageContext';
import { theme, purpleTint, purpleTintBorder, redTint, redTintBorder } from '@/constants/aequitas-theme';
import {
  BURST_FRAME_COUNT,
  BURST_INTERVAL_MS,
  COUNTDOWN_SECONDS,
  CHALLENGE_PROMPTS,
  fetchChallenge,
  submitCapture,
  explainDecision,
  type Challenge,
  type CoordinatorResult,
} from '@/lib/biometric';
import { getDeviceId } from '@/lib/identity';

/** Fassung des Einwilligungstextes. Wird mitgesendet und beim Validator
 *  gespeichert, damit später nachvollziehbar ist, wem wozu zugestimmt wurde.
 *  Bei jeder inhaltlichen Änderung des Textes hochzählen. */
const CONSENT_VERSION = '1';

/** Wartezeit nach dem Kamerawechsel, bevor der Countdown startet.
 *
 *  Der Wechsel von der Rück- auf die Frontkamera ist auf Android kein
 *  Umschalten, sondern ein Neuaufbau der Aufnahmesitzung. Startet der
 *  Countdown sofort, laufen die ersten Burst-Bilder gegen eine Kamera, die
 *  noch nicht scharf gestellt und belichtet hat — die Frames sind dann
 *  unbrauchbar, und die Prüfung scheitert an etwas, das der Nutzer nicht
 *  beeinflussen kann. */
const CAMERA_SWITCH_SETTLE_MS = 900;

type Step = 'consent' | 'preparing' | 'palm' | 'switch' | 'countdown' | 'burst' | 'submitting' | 'result' | 'failed';

interface Props {
  visible: boolean;
  wallet: string;
  onCancel: () => void;
  onSuccess: (r: { bioHash: string; signature: string; issuedAt: number }) => void;
}

export default function BiometricCapture({ visible, wallet, onCancel, onSuccess }: Props) {
  const { t } = useLanguage();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView | null>(null);

  const [step, setStep] = useState<Step>('consent');
  const [consented, setConsented] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [palmUri, setPalmUri] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [burstDone, setBurstDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CoordinatorResult | null>(null);

  // Verhindert, dass ein doppelter Tap zwei Aufnahmen gleichzeitig auslöst —
  // takePictureAsync auf derselben Kamerasitzung parallel aufzurufen liefert
  // auf Android sporadisch einen Fehler statt eines zweiten Bildes.
  const busy = useRef(false);

  // Läuft der Ablauf noch? Wird beim Schließen auf false gesetzt, damit die
  // Burst-Schleife nicht in eine bereits abgebaute Kamerasitzung weiterläuft.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = visible;
    if (visible) {
      setStep('consent');
      setConsented(false);
      setChallenge(null);
      setPalmUri(null);
      setCountdown(COUNTDOWN_SECONDS);
      setBurstDone(0);
      setError(null);
      setResult(null);
      busy.current = false;
    }
    return () => {
      alive.current = false;
    };
  }, [visible]);

  const fail = useCallback((msg: string) => {
    setError(msg);
    setStep('failed');
  }, []);

  /** Einwilligung erteilt: Berechtigung einholen, Challenge holen, Kamera an. */
  const start = useCallback(async () => {
    setStep('preparing');
    setError(null);
    try {
      if (!permission?.granted) {
        const res = await requestPermission();
        if (!res.granted) {
          fail(t('bio.errNoCameraPermission'));
          return;
        }
      }
      const c = await fetchChallenge();
      if (!alive.current) return;
      setChallenge(c);
      setStep('palm');
    } catch (e: any) {
      fail(t('bio.errCoordinatorUnreachable') + (e?.message ? ` (${e.message})` : ''));
    }
  }, [permission?.granted, requestPermission, fail, t]);

  const capturePalm = useCallback(async () => {
    if (busy.current || !camera.current) return;
    busy.current = true;
    try {
      const photo = await camera.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: true,
        shutterSound: false,
      });
      if (!photo?.uri) {
        fail(t('bio.errCaptureFailed'));
        return;
      }
      setPalmUri(photo.uri);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setStep('switch');
    } catch (e: any) {
      fail(t('bio.errCaptureFailed') + (e?.message ? ` (${e.message})` : ''));
    } finally {
      busy.current = false;
    }
  }, [fail, t]);

  // Kamerawechsel + Countdown. Der Timer hängt bewusst am Schritt und nicht
  // am Zähler: so gibt es genau einen laufenden Intervall, auch wenn React
  // die Komponente zwischendurch neu rendert.
  useEffect(() => {
    if (step !== 'switch') return;
    const timer = setTimeout(() => {
      if (alive.current) setStep('countdown');
    }, CAMERA_SWITCH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (step !== 'countdown') return;
    setCountdown(COUNTDOWN_SECONDS);
    let n = COUNTDOWN_SECONDS;
    const timer = setInterval(() => {
      n -= 1;
      if (!alive.current) return;
      setCountdown(n);
      Haptics.selectionAsync().catch(() => {});
      if (n <= 0) {
        clearInterval(timer);
        setStep('burst');
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [step]);

  /**
   * Der Burst.
   *
   * takePictureAsync ist nicht gleichmäßig schnell — je nach Gerät dauert ein
   * Bild zwischen 40 und 250 ms. Deshalb wird der TATSÄCHLICHE mittlere
   * Abstand gemessen und mitgesendet statt des Wunschwerts BURST_INTERVAL_MS:
   * die rPPG-Pulsschätzung des Validators rechnet die Frequenz aus genau
   * diesem Abstand aus, und ein um den Faktor zwei falscher Abstand ergibt
   * eine um den Faktor zwei falsche Herzfrequenz.
   */
  useEffect(() => {
    if (step !== 'burst') return;
    let cancelled = false;

    (async () => {
      const uris: string[] = [];
      const stamps: number[] = [];
      try {
        for (let i = 0; i < BURST_FRAME_COUNT; i++) {
          if (cancelled || !alive.current || !camera.current) return;
          const started = Date.now();
          const photo = await camera.current.takePictureAsync({
            quality: 0.6,
            skipProcessing: true,
            shutterSound: false,
          });
          if (photo?.uri) {
            uris.push(photo.uri);
            stamps.push(started);
            if (!cancelled) setBurstDone(uris.length);
          }
          const spent = Date.now() - started;
          if (spent < BURST_INTERVAL_MS) {
            await new Promise((r) => setTimeout(r, BURST_INTERVAL_MS - spent));
          }
        }
      } catch (e: any) {
        if (!cancelled) fail(t('bio.errCaptureFailed') + (e?.message ? ` (${e.message})` : ''));
        return;
      }

      if (cancelled || !alive.current) return;
      if (uris.length < 20 || !palmUri || !challenge) {
        fail(t('bio.errTooFewFrames'));
        return;
      }

      const measured =
        stamps.length > 1
          ? Math.round((stamps[stamps.length - 1] - stamps[0]) / (stamps.length - 1))
          : BURST_INTERVAL_MS;

      setStep('submitting');
      try {
        const deviceId = await getDeviceId();
        const r = await submitCapture({
          wallet,
          deviceId,
          challengeNonce: challenge.nonce,
          palmUri,
          faceUris: uris,
          burstIntervalMs: measured,
          consentVersion: CONSENT_VERSION,
          consentedAt: Math.floor(Date.now() / 1000),
        });
        if (cancelled || !alive.current) return;
        setResult(r);
        setStep('result');
        if (r.bioHash && r.attestation && r.attestationIssuedAt != null) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        }
      } catch (e: any) {
        if (!cancelled) fail(e?.message ?? t('bio.errSubmitFailed'));
      }
    })();

    return () => {
      cancelled = true;
    };
    // palmUri/challenge sind zum Zeitpunkt von 'burst' bereits gesetzt und
    // ändern sich nicht mehr; sie stehen nur der Vollständigkeit halber hier.
  }, [step, palmUri, challenge, wallet, fail, t]);

  const prompt = challenge ? CHALLENGE_PROMPTS[challenge.challengeType] : '';
  const showCamera = step === 'palm' || step === 'switch' || step === 'countdown' || step === 'burst';
  const facing = step === 'palm' ? 'back' : 'front';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View style={S.root}>
        {showCamera && (
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing={facing}
            animateShutter={false}
            // Der Blitz bleibt aus: bei der Handfläche überstrahlt er die
            // Venenzeichnung, und beim Gesichts-Burst würde er die
            // Farbschwankung überdecken, aus der der Puls geschätzt wird.
            flash="off"
          />
        )}
        {showCamera && <View style={S.scrim} pointerEvents="none" />}

        <SafeAreaView style={S.safe} edges={['top', 'bottom']}>
          {/* --- Kopfzeile --- */}
          <View style={S.topBar}>
            <Text style={S.topTitle}>{t('bio.title')}</Text>
            <Pressable onPress={onCancel} hitSlop={12} style={S.closeBtn}>
              <Text style={S.closeText}>✕</Text>
            </Pressable>
          </View>

          {step === 'consent' && (
            <ScrollView contentContainerStyle={S.scroll} showsVerticalScrollIndicator={false}>
              <View style={S.hero}>
                <Text style={S.heroTitle}>{t('bio.consentTitle')}</Text>
                <Text style={S.heroSub}>{t('bio.consentIntro')}</Text>
              </View>

              <View style={S.card}>
                <Bullet n={1} text={t('bio.consentPoint1')} />
                <Bullet n={2} text={t('bio.consentPoint2')} />
                <Bullet n={3} text={t('bio.consentPoint3')} />
                <Bullet n={4} text={t('bio.consentPoint4')} />
              </View>

              <Pressable style={S.checkRow} onPress={() => setConsented((v) => !v)}>
                <View style={[S.checkbox, consented && S.checkboxOn]}>
                  {consented && <Text style={S.checkMark}>✓</Text>}
                </View>
                <Text style={S.checkLabel}>{t('bio.consentCheckbox')}</Text>
              </Pressable>

              <Pressable disabled={!consented} onPress={start} style={!consented && S.disabled}>
                <LinearGradient
                  colors={theme.gradient}
                  start={theme.gradientAngle.start}
                  end={theme.gradientAngle.end}
                  style={S.btn}
                >
                  <Text style={S.btnText}>{t('bio.startBtn')}</Text>
                </LinearGradient>
              </Pressable>
            </ScrollView>
          )}

          {step === 'preparing' && (
            <View style={S.center}>
              <ActivityIndicator size="large" color={theme.purple} />
              <Text style={S.centerText}>{t('bio.preparing')}</Text>
            </View>
          )}

          {/* --- Handfläche --- */}
          {step === 'palm' && (
            <View style={S.overlay}>
              <View style={S.guidePalm} />
              <View style={S.bottomPanel}>
                <Text style={S.stepLabel}>{t('bio.stepPalmLabel')}</Text>
                <Text style={S.instruction}>{t('bio.palmInstruction')}</Text>
                <Text style={S.hint}>{t('bio.palmHint')}</Text>
                <Pressable onPress={capturePalm}>
                  <LinearGradient
                    colors={theme.gradient}
                    start={theme.gradientAngle.start}
                    end={theme.gradientAngle.end}
                    style={S.btn}
                  >
                    <Text style={S.btnText}>{t('bio.captureBtn')}</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          )}

          {/* --- Kamerawechsel --- */}
          {step === 'switch' && (
            <View style={S.overlay}>
              <View style={S.bottomPanel}>
                <Text style={S.stepLabel}>{t('bio.stepFaceLabel')}</Text>
                <Text style={S.instruction}>{t('bio.switching')}</Text>
              </View>
            </View>
          )}

          {/* --- Countdown --- */}
          {step === 'countdown' && (
            <View style={S.overlay}>
              <View style={S.guideFace} />
              <View style={S.countdownWrap}>
                <Text style={S.countdownNum}>{countdown > 0 ? countdown : '•'}</Text>
              </View>
              <View style={S.bottomPanel}>
                <Text style={S.stepLabel}>{t('bio.stepFaceLabel')}</Text>
                <Text style={S.taskLabel}>{t('bio.taskLabel')}</Text>
                <Text style={S.taskPrompt}>{prompt}</Text>
                <Text style={S.hint}>{t('bio.countdownHint')}</Text>
              </View>
            </View>
          )}

          {/* --- Burst --- */}
          {step === 'burst' && (
            <View style={S.overlay}>
              <View style={[S.guideFace, S.guideFaceActive]} />
              <View style={S.bottomPanel}>
                <Text style={S.taskLabel}>{t('bio.taskNowLabel')}</Text>
                <Text style={S.taskPromptBig}>{prompt}</Text>
                <View style={S.progressTrack}>
                  <LinearGradient
                    colors={theme.gradient}
                    start={theme.gradientAngle.start}
                    end={theme.gradientAngle.end}
                    style={[S.progressFill, { width: `${(burstDone / BURST_FRAME_COUNT) * 100}%` }]}
                  />
                </View>
                <Text style={S.progressText}>
                  {burstDone} / {BURST_FRAME_COUNT}
                </Text>
              </View>
            </View>
          )}

          {step === 'submitting' && (
            <View style={S.center}>
              <ActivityIndicator size="large" color={theme.purple} />
              <Text style={S.centerText}>{t('bio.submitting')}</Text>
              <Text style={S.centerHint}>{t('bio.submittingHint')}</Text>
            </View>
          )}

          {/* --- Ergebnis ---
              Drei Ausgänge, nicht zwei. `duplicate_detected` liefert einen
              bio_hash MIT Attestierung — bewusst, denn es ist der eigene
              frühere Eintrag dieses Menschen, und wer seinen Proof verloren
              hat, muss ihn damit neu erzeugen können. Ihn deshalb grün als
              Erfolg anzuzeigen wäre aber irreführend, und ihn rot als Fehler
              anzuzeigen ebenso: die Kette weist die zweite Registrierung
              ohnehin ab. Also ein eigener, gelber Zustand. */}
          {step === 'result' && result && (
            <ScrollView contentContainerStyle={S.scroll} showsVerticalScrollIndicator={false}>
              <View
                style={
                  result.decision === 'new_enrollment'
                    ? S.okBox
                    : result.decision === 'duplicate_detected'
                      ? S.warnBox
                      : S.errBox
                }
              >
                <Text
                  style={
                    result.decision === 'new_enrollment'
                      ? S.okTitle
                      : result.decision === 'duplicate_detected'
                        ? S.warnTitle
                        : S.errTitle
                  }
                >
                  {result.decision === 'new_enrollment'
                    ? t('bio.resultOkTitle')
                    : result.decision === 'duplicate_detected'
                      ? t('bio.resultDuplicateTitle')
                      : t('bio.resultFailTitle')}
                </Text>
                <Text style={S.resultText}>{explainDecision(result)}</Text>
                <Text style={S.decisionCode}>{result.decision}</Text>
              </View>

              {result.bioHash && result.attestation && result.attestationIssuedAt != null ? (
                <Pressable
                  onPress={() =>
                    onSuccess({
                      bioHash: result.bioHash!,
                      signature: result.attestation!,
                      issuedAt: result.attestationIssuedAt!,
                    })
                  }
                >
                  <LinearGradient
                    colors={theme.gradient}
                    start={theme.gradientAngle.start}
                    end={theme.gradientAngle.end}
                    style={S.btn}
                  >
                    <Text style={S.btnText}>
                      {result.decision === 'duplicate_detected'
                        ? t('bio.continueAnywayBtn')
                        : t('bio.continueBtn')}
                    </Text>
                  </LinearGradient>
                </Pressable>
              ) : (
                <>
                  {/* Ein bio_hash OHNE Attestierung ist nutzlos: der Proof-
                      Server lehnt ihn unter BIO_ATTESTATION_MODE=required ab,
                      und ihn trotzdem weiterzureichen ergäbe einen Fehler, den
                      niemand einordnen kann. */}
                  {result.bioHash && !result.attestation && (
                    <Text style={S.noAttestNote}>{t('bio.errNoAttestation')}</Text>
                  )}
                  <Pressable onPress={() => setStep('consent')}>
                    <LinearGradient
                      colors={theme.gradient}
                      start={theme.gradientAngle.start}
                      end={theme.gradientAngle.end}
                      style={S.btn}
                    >
                      <Text style={S.btnText}>{t('bio.retryBtn')}</Text>
                    </LinearGradient>
                  </Pressable>
                </>
              )}

              <Pressable onPress={onCancel} style={S.secondaryBtn}>
                <Text style={S.secondaryText}>{t('bio.closeBtn')}</Text>
              </Pressable>
            </ScrollView>
          )}

          {step === 'failed' && (
            <ScrollView contentContainerStyle={S.scroll} showsVerticalScrollIndicator={false}>
              <View style={S.errBox}>
                <Text style={S.errTitle}>{t('bio.resultFailTitle')}</Text>
                <Text style={S.resultText}>{error}</Text>
              </View>
              <Pressable onPress={() => setStep('consent')}>
                <LinearGradient
                  colors={theme.gradient}
                  start={theme.gradientAngle.start}
                  end={theme.gradientAngle.end}
                  style={S.btn}
                >
                  <Text style={S.btnText}>{t('bio.retryBtn')}</Text>
                </LinearGradient>
              </Pressable>
              <Pressable onPress={onCancel} style={S.secondaryBtn}>
                <Text style={S.secondaryText}>{t('bio.closeBtn')}</Text>
              </Pressable>
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function Bullet({ n, text }: { n: number; text: string }) {
  return (
    <View style={S.bullet}>
      <View style={S.bulletDot}>
        <Text style={S.bulletNum}>{n}</Text>
      </View>
      <Text style={S.bulletText}>{text}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  // Abdunklung über dem Kamerabild: ohne sie ist weißer Text auf einem hellen
  // Motiv (Handfläche im Sonnenlicht) schlicht nicht lesbar.
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(12,14,22,0.45)' },
  safe: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  topTitle: { color: theme.text, fontSize: 13, fontWeight: '900', letterSpacing: 3 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  closeText: { color: theme.text, fontSize: 14, fontWeight: '700' },

  scroll: { padding: 20, paddingBottom: 40, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  centerText: { color: theme.purple, marginTop: 18, fontSize: 13, letterSpacing: 1, textAlign: 'center' },
  centerHint: { color: theme.muted, marginTop: 10, fontSize: 11.5, lineHeight: 17, textAlign: 'center' },

  hero: {
    backgroundColor: purpleTint,
    borderWidth: 1,
    borderColor: purpleTintBorder,
    borderRadius: theme.radius,
    padding: 20,
  },
  heroTitle: { color: theme.text, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  heroSub: { color: theme.muted, fontSize: 12.5, lineHeight: 19 },

  card: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    padding: 18,
    gap: 14,
  },
  bullet: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  bulletDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: purpleTintBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  bulletNum: { color: theme.purple, fontSize: 11, fontWeight: '700' },
  bulletText: { flex: 1, color: theme.muted, fontSize: 12, lineHeight: 18 },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.purple, borderColor: theme.purple },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '900' },
  checkLabel: { flex: 1, color: theme.text, fontSize: 12.5, lineHeight: 18 },

  btn: { borderRadius: theme.radiusSm, paddingVertical: 18, alignItems: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13, letterSpacing: 1.5 },
  disabled: { opacity: 0.35 },
  secondaryBtn: { paddingVertical: 14, alignItems: 'center' },
  secondaryText: { color: theme.muted, fontSize: 12, letterSpacing: 1 },

  overlay: { flex: 1, justifyContent: 'space-between' },
  // Rahmen als Zielhilfe. Kein bloßes Dekor: der Validator verwirft Bilder,
  // auf denen die Handfläche bzw. das Gesicht zu klein im Bild steht.
  guidePalm: {
    alignSelf: 'center',
    marginTop: 24,
    width: '68%',
    aspectRatio: 0.78,
    borderWidth: 2,
    borderColor: 'rgba(155,114,246,0.65)',
    borderRadius: 28,
  },
  guideFace: {
    alignSelf: 'center',
    marginTop: 24,
    width: '62%',
    aspectRatio: 0.76,
    borderWidth: 2,
    borderColor: 'rgba(34,211,238,0.6)',
    borderRadius: 999,
  },
  guideFaceActive: { borderColor: theme.neon, borderWidth: 3 },

  bottomPanel: {
    backgroundColor: 'rgba(19,22,32,0.92)',
    borderTopWidth: 1,
    borderTopColor: theme.border,
    borderTopLeftRadius: theme.radius,
    borderTopRightRadius: theme.radius,
    padding: 20,
    gap: 8,
  },
  stepLabel: { color: theme.muted, fontSize: 10, letterSpacing: 3 },
  instruction: { color: theme.text, fontSize: 16, fontWeight: '700', lineHeight: 23 },
  hint: { color: theme.muted, fontSize: 11.5, lineHeight: 17 },
  taskLabel: { color: theme.muted, fontSize: 10, letterSpacing: 3 },
  taskPrompt: { color: theme.teal, fontSize: 20, fontWeight: '800' },
  taskPromptBig: { color: theme.neon, fontSize: 26, fontWeight: '900', letterSpacing: 0.5 },

  countdownWrap: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  countdownNum: { color: theme.text, fontSize: 84, fontWeight: '900', letterSpacing: 2 },

  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: { height: 6, borderRadius: 3 },
  progressText: { color: theme.muted, fontSize: 11, fontFamily: theme.fontMono },

  okBox: {
    backgroundColor: 'rgba(52,211,153,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.25)',
    borderRadius: theme.radius,
    padding: 20,
    gap: 8,
  },
  okTitle: { color: theme.neon, fontSize: 17, fontWeight: '800' },
  warnBox: {
    backgroundColor: 'rgba(240,180,41,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(240,180,41,0.3)',
    borderRadius: theme.radius,
    padding: 20,
    gap: 8,
  },
  warnTitle: { color: theme.gold, fontSize: 17, fontWeight: '800' },
  errBox: {
    backgroundColor: redTint,
    borderWidth: 1,
    borderColor: redTintBorder,
    borderRadius: theme.radius,
    padding: 20,
    gap: 8,
  },
  errTitle: { color: theme.red, fontSize: 17, fontWeight: '800' },
  resultText: { color: theme.text, fontSize: 13, lineHeight: 20 },
  decisionCode: { color: theme.muted, fontSize: 10.5, fontFamily: theme.fontMono },
  noAttestNote: { color: theme.gold, fontSize: 11.5, lineHeight: 17 },
});
