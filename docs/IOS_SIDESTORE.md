# iOS über SideStore

Stand 15.11.2026. Die App gibt es für das iPhone **ohne App Store**: als unsignierte IPA, die SideStore (oder AltStore, Sideloadly) auf dem Gerät mit der Apple-ID des Menschen signiert. Kein Apple-Entwicklerkonto, kein Zertifikat, kein Secret.

Die Anleitung für Nutzer steht in `docs/IOS_SIDESTORE_RELEASE.md`. Sie wird bei jeder Veröffentlichung zum Text des Vorab-Releases `sidestore`.

## Ablauf (Betreiber)

1. Version in `app.json` erhöhen: `expo.version`, dazu `android.versionCode` **und** `ios.buildNumber` auf denselben Wert (der Test `appConfig.test.ts` hält das fest).
2. **Android:** `build-apk.yml` (release) → `release-apk.yml` mit Run-ID und Tag `vX.Y.Z`. Das legt das Release an.
3. **iOS:** `build-ios.yml` auf **demselben Commit** → `release-ios.yml` mit Run-ID und demselben Tag. Beide Läufe brauchen die Freigabe `app-signatur`.
   - `release-ios.yml` prüft: Der Lauf ist `build-ios.yml`, er war erfolgreich und kommt aus genau dem Commit des Tags. Die IPA hat genau eine App unter `Payload/`, Bundle-ID `digital.aequitas.app`, die Version des Tags, kein eingebettetes Profil und kein Mikrofon-Recht. Ihr SHA-256 stimmt mit dem des Baus überein.
   - Er hängt `aequitas-ios.ipa` an das Release, ergänzt die Release-Notizen (Größe, SHA-256) und schreibt `quelle.json` neu. Das ist die SideStore-Quelle im Format von AltStore, Quelle v2, mit `sha256`. Sie liegt im Vorab-Release `sidestore` unter fester Adresse.
   - Eine veröffentlichte IPA wird nie ersetzt (kein `--clobber`); nur `quelle.json` wird überschrieben.
4. Der Knoten liest für den Update-Hinweis `releases/latest`. Vorab-Releases zählen dort nicht, `sidestore` stört also nicht.

## Was der Bau prüft (`build-ios.yml`)

- Xcode ≥ 16.1 (SDK 54); genommen wird das neueste stabile auf `macos-15`.
- Typen und Tests wie im Android-Bau, `expo prebuild`, `pod install`, `xcodebuild archive` ohne Signatur.
- Info.plist:
  - Bundle-ID, Version und Build-Nummer stimmen.
  - Kamera- und Face-ID-Text sind vorhanden.
  - Diese Rechte fehlen: Mikrofon, Ort, Kontakte, Fotos, Bluetooth, Kalender, Spracherkennung, Tracking.
- Kein eingebettetes Profil, `main.jsbundle` vorhanden, Binärdatei mit arm64.
- Entitlements gibt es keine. Das erzeugte `.entitlements` ist leer, so reicht eine kostenlose Apple-ID.

## Unterschiede zu Android

| | Android | iPhone (SideStore) |
|---|---|---|
| Geräteprüfung | Android Key Attestation (`android_key`) | keine – App Attest braucht ein bezahltes Konto und eine feste Team-ID; SideStore signiert mit der Team-ID des Menschen |
| Lebendigkeit | grün möglich | höchstens gelb (`attestierung_fehlt`) → Grundeinkommen gestaffelt, spätestens Tag 30 frei |
| Zwillings-Aufnahme | ja | nein (Coordinator verlangt eine gültige Geräteprüfung) |
| Umzug | streng oder einfach | nur einfach (Code oder 14 Tage) |
| Handflächen-Erkennung | MediaPipe-Modul (Android) | das Modul ist Android-only, die App ruft es nicht auf |
| Signatur | eigener Release-Schlüssel | Apple-ID des Menschen, alle 7 Tage erneuern |
| Update | Hinweis → APK der Knoten-Seite | Hinweis → Seite `sidestore`, Update in SideStore |

## Sicherheit

- **Integrität:** Gebaut wird öffentlich in GitHub Actions, aus genau dem Commit, auf den der Tag zeigt. Der SHA-256 steht in den Notizen und in der Quelle; SideStore prüft ihn.
- **Keine Geheimnisse im Bau:** Nur die WalletConnect-Projekt-ID wird verwendet, und die steht ohnehin im Bundle. Das Veröffentlichen läuft in `app-signatur` mit Pflicht-Freigabe, liest aber keines ihrer Secrets und führt keinen Code aus dem Repo aus. Der Text kommt per API aus dem getaggten Stand.
- **Keychain:** `expo-secure-store` legt die Wallet im Schlüsselbund der Signatur ab. Eine andere Apple-ID heißt: neue Team-ID, die alten Einträge sind nicht mehr erreichbar. Die Anleitung sagt das (Seed-Phrase sichern).
- **Offen, vor breitem Einsatz auf echten iPhones prüfen:** Kamera und Gesichtserkennung (VisionCamera 5, ML Kit), Face ID, Tresor (ML-DSA), Registrierung bis „gelb“.
