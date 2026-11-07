# Google Play: Launch-Vorbereitung

Stand 07.11.2026. Alles, was sich im Repo vorbereiten lässt, liegt hier. Was nur
der Betreiber tun kann, steht unter „Deine Schritte“.

## 1. Deine Schritte (nur du)

1. **Privates Entwicklerkonto anlegen** (Entscheidung des Betreibers,
   07.11.2026) – play.google.com/console, 25 US-Dollar einmalig,
   Ausweisprüfung und Telefonnummer.
   - Im Store erscheinen der **Entwicklername** (frei wählbar, z. B.
     „Aequitas“), das **Land** und eine **Kontakt-E-Mail**. Google prüft
     intern den echten Namen. Eine Postanschrift wird bei einer App ohne
     Käufe nicht angezeigt -- vor dem Start in der Play Console nachsehen,
     was dort für das Konto steht.
   - **Pflicht für neue Privatkonten:** vor der Produktion ein
     **geschlossener Test mit mindestens 12 Testern, 14 Tage am Stück**.
     Danach in der Play Console „Zugriff auf die Produktion beantragen“.
   - Krypto-Richtlinie: Aequitas ist eine **nicht verwahrende** Wallet (die
     Schlüssel bleiben auf dem Gerät). Nicht verwahrende Wallets fallen
     nicht unter Googles Lizenzpflicht für Börsen und Wallets
     (Klarstellung von Google, August 2025) -- in der Erklärung genau so
     angeben.
2. **Rechtstexte mit echten Angaben** des Rechtsträgers: Impressum und
   Datenschutzerklärung auf aequitas.digital. Google prüft die URL der
   Datenschutzerklärung.
3. **App-Signatur:** In der Play Console bei „App-Signatur“ **„vorhandenen
   Schlüssel verwenden“** wählen und den Release-Schlüssel mit Googles Werkzeug
   (PEPK) hochladen. Dann sind Play- und Website-Fassung dieselbe App und
   lassen sich gegenseitig aktualisieren. Der Schlüssel liegt verschlüsselt in
   der Sicherung (Aufgabe „Schlüssel-Sicherung“).
4. **12 Tester einladen:** eine Google-Gruppe oder E-Mail-Liste mit
   mindestens 12 Personen (Android, Google-Konto), in der Play Console unter
   „Geschlossener Test“ eintragen, Einladungslink verschicken (Vorlage
   unten). Die Tester müssen die App installieren und 14 Tage behalten.
5. **Bundle hochladen:** Workflow „Android APK bauen“ mit `variant: bundle`
   starten, Freigabe `app-signatur` erteilen, das Artefakt
   `aequitas-release-aab` herunterladen und in der Play Console als Release
   hochladen (zuerst interner Test, dann geschlossener Test, dann Produktion).

## 2. Store-Eintrag (fertig im Repo)

`store/play/<sprache>/` – `title.txt`, `short_description.txt` (≤ 80 Zeichen),
`full_description.txt` (≤ 4000 Zeichen) in 12 Sprachen: de-DE, en-US, es-ES,
fr-FR, it-IT, pt-PT, tr-TR, id, ru-RU, zh-CN, hi-IN, ar.

Noch zu liefern: Symbol 512×512, Vorstellungsgrafik 1024×500, mindestens zwei
Bildschirmfotos je Gerätetyp (Telefon). Die Bildschirmfotos entstehen am besten
auf einem echten Gerät im Testbetrieb.

## 3. Formular „Datensicherheit“ (Antworten)

| Frage | Antwort |
|---|---|
| Erhebt oder teilt die App Nutzerdaten? | Ja, erhebt; teilt **nicht** mit Dritten zu Werbezwecken |
| Daten verschlüsselt übertragen? | Ja (nur HTTPS) |
| Können Nutzer die Löschung verlangen? | Ja, in der App („Meine Daten löschen“); es bleibt eine verschlüsselte Einmaligkeits-Marke ohne Bezug zu Wallet oder Identität (Art. 17 Abs. 3 DSGVO, Betrugsverhinderung) |
| **Biometrische Daten / Gesichtsdaten** | Erhoben, **nicht geteilt**, erforderlich für die Registrierung. Zweck: Betrugsverhinderung (ein Mensch, ein Konto). Gespeichert wird nur ein verschlüsselter 64-Byte-Auszug, kein Foto |
| Fotos/Videos | Erhoben nur während der Aufnahme, verarbeitet und verworfen (nicht gespeichert) |
| Finanzinformationen | Wallet-Adresse und Kontostand liegen öffentlich auf der Kette; die App verwahrt keine fremden Gelder |
| Geräte- oder andere IDs | Geräteprüfung (Android Key Attestation) zur Betrugsverhinderung; kein Tracking, keine Werbe-ID |
| Standort, Kontakte, Nachrichten, Werbung, Analyse | Nein |

## 4. Weitere Erklärungen in der Play Console

- **Zielgruppe:** nur Erwachsene (18+); die App fragt das Alter vor der Aufnahme
  ab und lässt Kinder nicht zu.
- **Altersfreigabe (IARC):** keine Gewalt, kein Glücksspiel, keine
  Nutzerinhalte; Finanzfunktionen ja.
- **Finanzfunktionen / Kryptowährung:** nicht verwahrende Wallet (die Schlüssel
  liegen nur auf dem Gerät), kein Mining, kein Handel mit Fiat, keine
  Anlageberatung.
- **Werbung:** keine. **Berechtigungen:** Kamera (Gesichtsprüfung, QR-Codes),
  Biometrie des Geräts (Wallet entsperren). Kein Mikrofon, kein Standort.
- **Kontolöschung:** in der App (Daten löschen) und auf der Website
  (Datenschutzerklärung, Abschnitt Löschung) beschrieben.

## 5. Zugang für die Google-Prüfer

Text für „App-Zugriff“ in der Play Console:

> Aequitas needs no login. Open the app, create a new wallet (Wallet tab →
> "Create wallet"), note the 12 words. The face check (Identity tab →
> "Register") runs in public beta; reviewers can complete it with their own
> face, or skip it – sending, receiving and the node/verifier screens work
> without registration. Data is processed in test mode and can be deleted in
> the app ("Delete my data").

## 6. Technik (erledigt)

- App-Bundle: `.github/workflows/build-apk.yml`, `variant: bundle` →
  `./gradlew bundleRelease`, signiert im Job `signieren-aab` mit dem
  Release-Schlüssel (Fingerabdruck geprüft), Artefakt `aequitas-release-aab`.
- Ziel-API 36 (Android 16), aus React Native 0.81 / Expo SDK 54
  (`node_modules/react-native/gradle/libs.versions.toml`) -- erfüllt die
  Play-Pflicht.
- Updates außerhalb des Stores: die App meldet neue Versionen selbst
  (`components/UpdateHinweis.tsx`). Wer über den Store installiert, bekommt
  Updates über den Store.

## 7. Einladung an die Tester (Vorlage)

> Hallo! Ich suche 12 Menschen, die die Android-App **Aequitas** zwei Wochen
> lang testen – Pflicht von Google vor dem Start im Play Store. So geht's:
> 1. Diesem Link folgen und „Tester werden“ antippen: <Link aus der Play Console>
> 2. Die App aus dem Play Store installieren und **14 Tage installiert lassen**.
> 3. Gern einmal öffnen und eine Wallet anlegen; die Gesichtsprüfung ist freiwillig.
> Danke!
