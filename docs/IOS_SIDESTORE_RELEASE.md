**Aequitas für das iPhone – ohne App Store, über SideStore.** Aktuell: @TAG@.

> Zuerst: **Seed-Phrase sichern.** Ohne sie ist die Wallet weg, wenn die App mit einer anderen Apple-ID neu signiert wird.

## Installieren

1. **SideStore** einrichten – einmal mit einem Computer, danach erneuert SideStore die App selbst auf dem iPhone. Anleitung: https://docs.sidestore.io. Ab iOS 16 muss der **Entwicklermodus** an sein (Einstellungen → Datenschutz & Sicherheit → Entwicklermodus).
2. In SideStore unter **Quellen** → **+** diese Adresse hinzufügen:
   `https://github.com/@REPO@/releases/download/sidestore/quelle.json`
3. **Aequitas** aus der Quelle installieren. SideStore prüft die Datei gegen ihren SHA-256.

Ohne Quelle geht es auch: `aequitas-ios.ipa` aus dem Release @TAG@ herunterladen (https://github.com/@REPO@/releases/download/@TAG@/aequitas-ios.ipa) und mit SideStore, AltStore oder Sideloadly installieren. SHA-256: `@SHA@`.

## Was du wissen musst

- **Alle 7 Tage erneuern** (kostenlose Apple-ID). SideStore macht das auf dem iPhone. Läuft die Frist ab, startet die App nicht mehr, deine Daten bleiben aber erhalten. Erneuern genügt.
- **Immer dieselbe Apple-ID.** Die Wallet liegt im Schlüsselbund dieser Signatur. Eine andere Apple-ID heißt: Seed-Phrase neu eingeben.
- **Höchstens 3 eigene Apps** gleichzeitig mit einer kostenlosen Apple-ID (SideStore zählt mit).
- **Updates** zeigt SideStore an. Den Hinweis in der App leitet hierher.

## Grenzen auf dem iPhone (ehrlich)

- **Keine Geräteprüfung (App Attest).** Die gibt es nur mit einem bezahlten Apple-Entwicklerkonto. Die Registrierung läuft trotzdem, aber ohne geprüftes Gerät nur als „gelb“: Das Grundeinkommen startet **gestaffelt**, spätestens nach 30 Tagen ist es frei.
- **Gemeinsame Aufnahme (Zwillinge)** und der **strenge Umzug** brauchen die Hardware-Prüfung eines Android-Telefons. Auf dem iPhone geht der Umzug mit Wiederherstellungscode oder nach 14 Tagen Frist.
- Die iPhone-Fassung ist neu und auf echten Geräten noch wenig erprobt. Fehler bitte melden.

Die Datei ist **unsigniert**: Signiert wird sie auf deinem iPhone mit deiner Apple-ID. Gebaut wird sie öffentlich aus demselben Commit wie die Android-APK desselben Tags.
