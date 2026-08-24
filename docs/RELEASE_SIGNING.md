# Release-Signierung einrichten

**Status: offen. Das ist der schärfste verbliebene Beta-Blocker.**

## Worum es geht

`.github/workflows/build-apk.yml` kann bereits richtig signieren — die vier
Secrets werden gelesen (Zeilen 353–356) und `apksigner` wird korrekt
aufgerufen. Was fehlt, sind ausschließlich die Secrets selbst. Solange sie
fehlen, warnt der Build und signiert mit dem **Debug-Schlüssel der
Expo-Vorlage**.

## Warum das vor dem Beta-Start passieren muss

Android bindet eine Installation an die Signatur. Ein Update, das mit einem
anderen Schlüssel signiert ist, wird nicht als Update erkannt, sondern
abgelehnt — die einzige Möglichkeit ist dann **deinstallieren und neu
installieren**.

Und beim Deinstallieren geht der lokale Schlüsselspeicher der App mit: die
Wallet samt Seed-Phrase. Wer bis dahin AEQ auf einer nur lokal gesicherten
Wallet hält, verliert den Zugriff.

Genau deshalb ist die Reihenfolge nicht beliebig: **erst signieren, dann
Tester einladen.** Wird der Schlüssel nachgereicht, nachdem die ersten
Menschen die App installiert haben, trifft dieser Bruch jeden einzelnen von
ihnen.

## Warum das hier steht statt erledigt zu sein

Der Vorgang erzeugt ein Passwort und legt es als Secret ab. Vertrauliche
Zugangsdaten anzulegen oder einzutragen ist nichts, was der Assistent
übernimmt — das bleibt bei dir. Die Schritte sind vollständig, es fehlt nur
die Ausführung.

## Schritte

**1. Schlüsselspeicher erzeugen** (einmalig, lokal — braucht ein JDK):

```bash
keytool -genkeypair -v -keystore aequitas-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias aequitas
```

`keytool` fragt nach einem Passwort und nach Namensangaben. Das Passwort
wählst du; die Namensangaben dürfen frei bleiben, sie sind nur Metadaten.

**2. Die Datei sichern.** Geht `aequitas-release.jks` verloren, kann **nie
wieder** ein Update für bereits installierte Apps veröffentlicht werden — es
gibt keinen Wiederherstellungsweg. Mindestens zwei getrennte Sicherungen,
nicht nur im Repo-Ordner (die Datei gehört nicht ins Git).

**3. In Base64 umwandeln:**

```bash
base64 -w0 aequitas-release.jks > keystore.b64
```

**4. Vier Secrets hinterlegen**, unter *Settings → Secrets and variables →
Actions → New repository secret* im Repo `hanoi96international-gif/Aequitas-App`:

| Secret | Inhalt |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | der gesamte Inhalt von `keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | das Passwort aus Schritt 1 |
| `ANDROID_KEY_ALIAS` | `aequitas` |
| `ANDROID_KEY_PASSWORD` | dasselbe Passwort (falls kein eigenes gesetzt wurde) |

**5. `keystore.b64` danach löschen** — sie ist eine Klartextkopie des
Schlüssels.

**6. Neu bauen** (Actions → *Android APK bauen*). Die Warnung
„Release-Build mit Debug-Schluessel" darf im Protokoll nicht mehr auftauchen.

**7. Prüfen, womit wirklich signiert wurde:**

```bash
apksigner verify --print-certs app-release.apk
```

Der ausgegebene SHA-256-Fingerabdruck muss zu deinem Schlüsselspeicher
passen, nicht zum Debug-Schlüssel.

## Danach

Erst wenn Schritt 7 stimmt, sollte die APK an Beta-Tester gehen. Alle vorher
verteilten Installationen (v1.4.x, v1.5.0–v1.5.2) tragen den Debug-Schlüssel
und müssen einmalig deinstalliert werden — solange das nur dich und wenige
Testgeräte betrifft, ist es folgenlos.
