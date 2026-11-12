// Berechtigungen der Android-App: nur, was die App wirklich braucht.
//
// Bis 1.18.6 verlangte jede APK u. a. das Mikrofon (RECORD_AUDIO), das
// Ueberlagern anderer Apps (SYSTEM_ALERT_WINDOW), Speicher und
// Aktivitaetserkennung -- obwohl die App nichts davon nutzt. Die Rechte kamen
// aus Bibliotheken (expo-audio, expo-camera, expo-sensors, expo-file-system)
// und der Expo-Vorlage. app.json entfernt sie jetzt (blockedPermissions), und
// der Build prueft das fertige Manifest (build-apk.yml, "Berechtigungen
// pruefen"). Dieser Test haelt beides fest: die Sperrliste und dass der Code
// keine Funktion benutzt, die eines der gesperrten Rechte braeuchte -- sonst
// stuerzte die App an dieser Stelle ab, statt um Erlaubnis zu fragen.
import * as fs from 'fs';
import * as path from 'path';

const wurzel = path.resolve(__dirname, '..', '..');
const appJson = JSON.parse(fs.readFileSync(path.join(wurzel, 'app.json'), 'utf8'));
const android = appJson.expo.android;

const GESPERRT = [
  'android.permission.RECORD_AUDIO',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.ACTIVITY_RECOGNITION',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
];

function quelltexte(): { datei: string; text: string }[] {
  const ergebnis: { datei: string; text: string }[] = [];
  const besuchen = (ordner: string) => {
    for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (eintrag.name === 'node_modules' || eintrag.name === '__tests__' || eintrag.name.startsWith('.')) continue;
      const voll = path.join(ordner, eintrag.name);
      if (eintrag.isDirectory()) besuchen(voll);
      else if (/\.(ts|tsx|js|jsx|kt|java)$/.test(eintrag.name)) {
        ergebnis.push({ datei: path.relative(wurzel, voll), text: fs.readFileSync(voll, 'utf8') });
      }
    }
  };
  for (const ordner of ['app', 'lib', 'components', 'hooks', 'src', 'modules', 'contexts']) {
    const voll = path.join(wurzel, ordner);
    if (fs.existsSync(voll)) besuchen(voll);
  }
  return ergebnis;
}

// Kommentare entfernen, damit eine Erwaehnung im Kommentar nicht zaehlt.
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('Android-Berechtigungen', () => {
  it('verlangt nur Kamera und Geraete-Biometrie', () => {
    expect(android.permissions).toEqual(['USE_BIOMETRIC', 'USE_FINGERPRINT', 'CAMERA']);
  });

  it('sperrt jedes Recht, das Bibliotheken oder die Vorlage von selbst eintragen', () => {
    for (const recht of GESPERRT) expect(android.blockedPermissions).toContain(recht);
  });

  it('kein gesperrtes Recht steht zugleich in permissions', () => {
    for (const recht of android.permissions as string[]) {
      expect(GESPERRT).not.toContain(`android.permission.${recht}`);
      expect(GESPERRT).not.toContain(recht);
    }
  });

  it('expo-audio und expo-camera tragen das Mikrofon nicht ein', () => {
    const plugins = appJson.expo.plugins as (string | [string, Record<string, unknown>])[];
    const optionen = (name: string) => {
      const p = plugins.find((x) => (Array.isArray(x) ? x[0] : x) === name);
      expect(p).toBeDefined();
      return Array.isArray(p) ? p[1] : {};
    };
    expect(optionen('expo-audio').recordAudioAndroid).toBe(false);
    expect(optionen('expo-audio').microphonePermission).toBe(false);
    expect(optionen('expo-camera').recordAudioAndroid).toBe(false);
  });

  // Missbrauchstest: wer eine dieser Funktionen einbaut, braucht ein
  // gesperrtes Recht. Dann muss er die Sperre bewusst aufheben und das im PR
  // begruenden, statt dass die App auf dem Geraet abstuerzt.
  it('der Code nutzt keine Funktion, die ein gesperrtes Recht braucht', () => {
    const verboten: [RegExp, string][] = [
      [/\buseAudioRecorder\b|\bAudioModule\.AudioRecorder\b|requestRecordingPermissionsAsync|getRecordingPermissionsAsync/, 'Mikrofon (RECORD_AUDIO)'],
      [/\bsetActiveForLockScreen\b|\bupdateLockScreenMetadata\b/, 'Sperrbildschirm-Steuerung (FOREGROUND_SERVICE_MEDIA_PLAYBACK)'],
      [/\bPedometer\b/, 'Schrittzaehler (ACTIVITY_RECOGNITION)'],
      [/\benableAudio\s*[:=]\s*\{?\s*true|\baudio\s*=\s*\{\s*true\s*\}/, 'Ton in der Kamera-Aufnahme (RECORD_AUDIO)'],
      [/StorageAccessFramework|expo-media-library|MediaLibrary\./, 'Speicher/Mediathek'],
    ];
    const funde: string[] = [];
    for (const { datei, text } of quelltexte()) {
      const code = ohneKommentare(text);
      for (const [muster, recht] of verboten) {
        if (muster.test(code)) funde.push(`${datei}: ${recht}`);
      }
    }
    expect(funde).toEqual([]);
  });

  it('der Missbrauchstest erkennt eine Mikrofon-Aufnahme wirklich', () => {
    const beispiel = ohneKommentare("const r = useAudioRecorder(RecordingPresets.HIGH_QUALITY);");
    expect(/\buseAudioRecorder\b/.test(beispiel)).toBe(true);
    const nurKommentar = ohneKommentare('// useAudioRecorder war hier einmal');
    expect(/\buseAudioRecorder\b/.test(nurKommentar)).toBe(false);
  });
});
