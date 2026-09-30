# Aequitas-App: Analyse für den Neubau

Alle vier Quellpfade sind vorhanden. Den V8-Contract gibt es in keinem Repo: die App bindet die Registrierungssignatur heute an `V7_CONTRACT` (`lib/config.ts`, `lib/identity.ts:138`).

## Kurzfazit

- **Brauchbarer Kern.** Die Fachlogik ist über viele Audits gehärtet und lässt sich weitgehend übernehmen:
  - Gebühren und Höchstbetrag
  - Knotenbindung zwischen Beweis und Registrierung
  - Coordinator-Bindung an den Challenge-Nonce
  - Widerspruch, Löschung, Zahlungslink
- **UI und Architektur sind nicht tragfähig.**
  - Riesige Einzeldateien (`app/biometric-capture.tsx` hat 1.704 Zeilen, `app/(tabs)/trade.tsx` 645).
  - Kein Designsystem, nur dunkler Modus.
  - Abfragen laufen über verstreute `setInterval`, Fehler werden als Text-Strings geführt.
  - Es gibt keinen Einstellungs-, Sperr- oder Detailbildschirm.
- **Schlüssel und Backup sind die größten Sicherheitslücken:**
  - Die Seed-Phrase kann in die Zwischenablage kopiert werden.
  - Das Backup wird nicht geprüft.
  - Die Phrase lässt sich später nicht mehr anzeigen.
  - „Wallet entfernen“ löscht den Schlüssel nach einem einzigen Dialog.
  - Auf Geräten ohne Bildschirmsperre wird der Schlüssel ohne jede Prüfung herausgegeben.
- **Einige Funktionen scheitern mit den heutigen Kettenregeln:**
  - „100 %“ beim Tausch AEQ→tUSD, weil die App die Ausstiegsabgabe nicht kennt.
  - 429/503 vom Coordinator: Die Gesichtsaufnahme geht verloren.
- **Mehrere P0-Funktionen brauchen Backend-Endpunkte, die fehlen.** Beispiele: Treuhand- und Aktivitätsstatus, maschinenlesbare Fehlercodes, `Retry-After` an der Kette, eine Netzkennung für den Neustart. Details in Abschnitt 2.

---

## 1. Bestandsaufnahme

### 1.1 Screens und Funktionen

| Screen | Datei | Was er tut |
|---|---|---|
| Onboarding | `app/onboarding.tsx` | Wallet anlegen (Seed anzeigen, Checkbox), Import (Seed oder Private Key), WalletConnect, Sprache wählen |
| Start | `app/(tabs)/index.tsx` | Explorer-Kennzahlen (Höhe, Menschen, Gini-Note, Töpfe, Phase, UBI-Countdown), letzte Blöcke, „GHOSTDAG“-Abzeichen. **Kein eigenes Guthaben.** |
| Wallet | `app/(tabs)/wallet.tsx` | Guthaben, Senden (Adresse, Betrag, Max, QR-Scan, Gebühr, Alert-Bestätigung), Empfangen (QR nur mit Adresse, Z. 239), tUSD-Faucet, Wirtschaftshinweise (Umlaufabgabe, freie Adresse), Verlauf (`components/Verlauf.tsx`), Wallet entfernen/trennen |
| Tausch | `app/(tabs)/trade.tsx` | Swap mit Vorschau und Preiseinfluss; Liquidität hinzufügen/entfernen; Preisdiagramm; Faucet ein zweites Mal |
| Knoten | `app/(tabs)/run-node.tsx` | Statische Anleitung (Befehle kopieren, GitHub-Links), kein Live-Status |
| Identität | `app/(tabs)/identity.tsx` | Registrierung per Gerätegeheimnis (nur wenn `ALLOW_DEVICE_SECRET_REGISTER`) oder Sprung zur Gesichtsaufnahme; Status; Protokollliste; Einwilligung widerrufen (Enrollment löschen); „Nachziehen“ |
| Gesichtsaufnahme | `app/biometric-capture.tsx` | Einwilligung, Challenge, Gesichtsführung, Farbblitz, Gyroskop-Daten, Burst-Video, Sprachansage (TTS), Submit an den Coordinator, danach Beweis/Signatur/Registrierung, Widerspruchskarte, Vouch |
| Modal | `app/modal.tsx` | Rest der Expo-Vorlage |

### 1.2 Datenflüsse

- **Konfiguration:** `lib/config.ts`. `EXPO_PUBLIC_*`, Fallback-Knoten, Chain-ID 1926 und V7-Adresse sind fest eingetragen.
- **REST:** `lib/api.ts`.
  - Der aktive Knoten wird 15 Minuten lang beibehalten.
  - `/prove` → `/register` wird an denselben Knoten gebunden (`proveKnoten`, Z. 69–84, 380, 406). Das entspricht `prove_provenance.go` in der Kette.
  - Bei 429 wird wiederholt, mit festen Wartezeiten 4/8/12 s (Z. 131).
- **RPC:** `lib/wallet.ts:getProvider` nutzt einen ethers-`FallbackProvider`. Überweisungen sind signierte EVM-Transaktionen (`sendAEQ`).
- **Aufträge:** Swap, Liquidität und Faucet laufen über `personal_sign` auf Klartextnachrichten mit Nonce aus `/api/nonce`. Die Formate müssen byteweise zu `swap.go:134/246/337/477` und `auftrag_nachweis.go:125–142` passen.
- **Globaler Zustand:** `contexts/WalletContext.tsx`.
  - Pollt `/balance` und `/status` alle 10 s (Z. 206). Das rendert den ganzen Baum neu.
  - Verwaltet Modus lokal/WalletConnect und den Signer.
- **Weiteres Polling:**
  - Start: Blöcke alle 10 s
  - Tausch: `/pool`, `/lp-position` alle 15 s, `/price-history` alle 30 s
  - Identität: SecureStore alle 3 s
  - Diese Timer laufen weiter, auch wenn der Reiter nicht sichtbar ist.
- **Biometrie:** `lib/biometricIdentity.ts` spricht mit dem Coordinator über `/challenge`, `/register`, `/nachziehen`, `/widerspruch`, `/enrollment` und `/vouch`.

### 1.3 Architekturprobleme

1. **Keine Schichtentrennung.** Screens rufen API, Signer und Formatierung direkt auf.
   - Die Faucet-Logik steht doppelt (`wallet.tsx:154–171`, `trade.tsx:174–191`).
   - `SIGN_TIMEOUT_MS` ist dreimal definiert.
2. **Monolithische Screens:**
   - `biometric-capture.tsx` hat 1.704 Zeilen: Kamera, TTS, Zustandsmaschine, Netz und Ergebnis-UI in einer Datei.
   - `trade.tsx` enthält drei Funktionen mit zwölf `useState`.
3. **Server-State liegt im Context** (`WalletContext.tsx:188–210`).
   - Fehler werden geschluckt („next poll retries“).
   - Es gibt kein Caching und keine Deduplizierung.
   - Das Polling hängt nicht an Fokus oder AppState.
4. **Beträge sind `Number`/float:**
   - `parseFloat(amount)` in `trade.tsx:105`
   - `toLocaleString('en-US')` unabhängig von der Sprache (`lib/format.ts:14`)
   - Anzeige als „K/M“
   - Die Kette rechnet inzwischen in Mikro-AEQ (Commit „Tausch in Mikro-AEQ“).
5. **Kein zentrales Fehlermodell.** Statusmeldungen sind Strings mit „✗“-Präfix. `fehlerArt` in `lib/ueberweisung.ts` rät aus englischem und deutschem Freitext, weil die Kette bei Fachfehlern HTTP 200 mit `{success:false, message}` liefert (`swap.go`).
6. **Theming:**
   - Nur dunkel (`app.json:9`, `app/_layout.tsx:44–58`).
   - `constants/aequitas-theme.ts` hat Farbnamen statt semantischer Tokens (purple/teal/blue sind alle `#5B8CFF`).
   - Styles stehen pro Screen und sind kopiert.
7. **Navigation:**
   - Fünf Tabs, einer davon eine statische Knotenanleitung.
   - Kein Einstellungsbereich (Sprache steht im Header, „Wallet entfernen“ im Wallet-Tab).
   - Keine Sperr- oder Detailscreens.
   - Registrierung und Identität sind ein Tab, nicht Teil des Onboardings.
8. **`lib/api.ts` hat keine Timeouts.**
   - `fetchApi` (Z. 102–118) kennt keinen AbortController.
   - `apiGet` wirft nur `statusText` und verliert den Fehlerrumpf (Z. 122).
   - 503 wird nicht behandelt, `Retry-After` wird ignoriert.
9. **Zwei Kamerabibliotheken** (expo-camera für QR, vision-camera 5 für das Gesicht), dazu Patches (`patches/`), ein Config-Plugin (`plugins/withRawPropsJsiValueFix.js`) und R8-Regeln in `app.json`.

### 1.4 Sicherheitsprobleme

**Schlüsselhaltung (`lib/wallet.ts`, `app/onboarding.tsx`)**

- **Schlüssel ohne jede Authentifizierung.** Ist am Gerät keine Bildschirmsperre eingerichtet, wird der Private Key ohne Prüfung herausgegeben (`wallet.ts:76–81`: `SecurityLevel.NONE → return`). Nötig wäre eine eigene App-PIN oder eine Ablehnung.
- **Nur der Private Key wird gespeichert, nicht die Mnemonic** (`wallet.ts:91–102`, `123–132`). Folgen:
  - Kein späteres „Backup anzeigen“ möglich.
  - Unternehmensschlüssel lassen sich nicht über einen HD-Pfad ableiten.
- **Seed-Anzeige:**
  - „In Zwischenablage kopieren“ (`onboarding.tsx:132–153`), mit Löschen nach 45 s.
  - Nur eine Checkbox, keine Wortprüfung (`:158–166`).
  - Kein Screenshot-Schutz.
  - Das Import-Feld ist Klartext (`:191–201`).
  - Import eines rohen Private Keys ist erlaubt.
- **„Wallet entfernen“ löscht den Schlüssel sofort** (`WalletContext.tsx:250–253`) nach einem Alert. Es gibt weder Backup-Nachweis noch Guthabenwarnung.
- **Gut, übernehmen:**
  - Sperre bei jedem Verlassen von „active“ (`wallet.ts:173–177`).
  - `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
  - Biometrie oder Geräte-PIN als Tor.

**Signaturen**

- Aufträge sind frei formulierte `personal_sign`-Texte **ohne Chain-ID oder Domäne**:
  - Swap, Liquidität, Faucet, Guardian, Treuhand
  - Ausnahme: das PoH-Credential (`api_credential.go:118`)
- **Backend-Befund, relevant für die V8-Neudefinition:** Drei Nachrichten haben weder Nonce noch Zeitstempel und sind damit wiederholbar:
  - `"Aequitas: set guardian <g>"` (`api.go:4143`): Eine alte Signatur setzt einen früheren Guardian zurück.
  - `"confirm alive"` (`api.go:4220`)
  - `"recover escrow"` (`api.go:4329`, `auftrag_nachweis.go:142`)
- **Zeitfenster und Uhrzeit:**
  - Swap und Liquidität verlangen `ts` innerhalb von ±60 s (`swap.go:128`).
  - Die App nimmt `Date.now()` (`trade.tsx:145`). Weicht die Geräteuhr ab, scheitern Aufträge.
  - `/api/status` liefert keine Serverzeit; der HTTP-`Date`-Header wäre nutzbar.
- **`min_amount_out = preview*0.99`** (`trade.tsx:150`) ist eine feste Toleranz von 1 %.
  - Die Vorschau (`:115`) ignoriert die Ausstiegsabgabe (2 % auf den Betrag über dem Freibetrag, oben aufgeschlagen: `state.go:5967–5970`, `wirtschaft.go:673–687`).
  - Im Vorbehaltsmodus werden sogar pauschal 102 % reserviert (`vorbehalt.go:87`).
  - Folge: „100 %“ (`trade.tsx:130–133`) scheitert mit „insufficient AEQ balance“, und die Kosten erscheinen nirgends.
- **`identity.ts`:**
  - Salt deterministisch aus `bio` (Z. 63, 81): kein echter Blindungsfaktor. Für V8 festlegen.
  - Toter Fallback `circuitVersion || 2` (Z. 152) nach der Pflichtprüfung auf 3 (Z. 130).

**Netz und Fehlerbehandlung**

- **Coordinator `/register`** (`biometricIdentity.ts:514–517`):
  - Jeder Nicht-2xx-Status wirft einen Fehler.
  - `mengengrenze.py:111–121` antwortet aber bewusst mit 429/503 und `Retry-After` („die App wiederholt dann von selbst“). Die App tut das nicht, die Gesichtsaufnahme ist verloren.
  - Keine Timeouts bei Coordinator-Aufrufen außer dem Health-Check (6 s).
- **Kette:**
  - Nirgends ein `Retry-After`-Header (per grep geprüft).
  - 429 teils mit JSON-Text, teils `http.Error`.
  - 503 z. B. bei `annahmeBeginnen` (`wirtschaft_api.go:224`).
- **`lib/globalErrorHandler.ts:43` unterdrückt alle fatalen Fehler.** Eine Wallet läuft dann in unbekanntem Zustand weiter; nötig sind Error-Boundary und Neustart statt Weiterlaufen.
- **Gut, übernehmen:**
  - Keine Tokens im Bundle.
  - HTTPS-Standard.
  - `usesCleartextTraffic` entfernt.
- **Offen:**
  - Kein Chain-ID-Abgleich mit `/api/status.chain_evm_id` (fail-closed fehlt).
  - `docs/ENDPOINTS.md` beschreibt noch die IP-Phase und ist überholt (vgl. `config.ts`, „RESOLVED 2026-08-22“).

**Speicher**

- Sprache liegt in SecureStore (unnötig, schadet nicht).
- `bio_hash` als Löschschlüssel in SecureStore ist richtig.
- Nach dem Neustart bei null werden lokale Stände (`bio_hash`, `nachgezogen`) ungültig. Es gibt keine Netzkennung, an der die App das erkennt.

**Berechtigungen**

- `RECORD_AUDIO` in `app.json:29` ist überflüssig; der Akustiktest wurde entfernt.

### 1.5 UX-Probleme

- **Start ist ein Explorer** (Blöcke, GHOSTDAG, Gini-Note), kein Kontoüberblick.
- Guthaben ohne LP-Wert: `/api/balance` liefert `lp_value_aeq`, `total_value_aeq`, `staffel` sowie Demurrage-Hinweise (`api.go:2284–2299`), der App-Typ ignoriert sie (`lib/api.ts:202–207`).
- **Senden:**
  - Kein Überprüfungsbildschirm, nur ein `Alert.alert`.
  - Kein Pending-/Erfolgsstatus: nur die ersten 12 Zeichen des Hash, dann Refresh nach 3 s.
  - Keine Transaktionsdetails, keine Kontakte, keine Prüfsummenanzeige der Adresse.
- **Empfangen:** Der QR enthält nur die Adresse (`wallet.tsx:239`), obwohl der Scanner EIP-681 mit Chain-Prüfung liest. Es gibt keinen Betrag und keinen Zahlungslink.
- **tUSD-Faucet** (Testgeld) steht gleichrangig neben echtem Geld im Wallet.
- **Identität:**
  - Entwickler-Protokollliste statt klarer Schritte.
  - Registrierung ist nicht Teil des Onboardings.
  - Wartezeiten und 429 sind nicht erklärt.
- Kein Einstellungsbereich, kein Sperrbildschirm, keine Hilfe, keine Rechtstexte in der App.
- **i18n:**
  - `t()` ersetzt nur das erste Vorkommen eines Platzhalters (`contexts/LanguageContext.tsx:55`).
  - Keine Pluralformen.
  - Standardsprache fest `de` statt Gerätesprache.
  - RTL für Arabisch definiert (`lib/i18n/languages.ts: RTL_LOCALES`), aber nirgends angewendet (kein `I18nManager`).
- **Barrierefreiheit:** In der ganzen App gibt es genau ein `accessibilityLabel` (`wallet.tsx:277`). Keine Rollen, keine Angaben zur Schriftskalierung.

### 1.6 Tote oder fehlerhafte Teile

- **Expo-Vorlage:**
  - `app/modal.tsx`
  - `components/{hello-wave,parallax-scroll-view,themed-text,themed-view,external-link}.tsx`, `components/ui/collapsible.tsx`
  - `hooks/use-theme-color.ts`, `constants/theme.ts`, `scripts/reset-project.js`
  - `assets/images/*react-logo*`
  - Vorlagen-`README.md`
  - Icon-Hintergrund `#E6F4FE` (`app.json:18`)
- **Handflächen-Modul:** `modules/mediapipe-hand-detector` wird nicht mehr importiert, steht aber noch in `package.json` und in den R8-Keep-Regeln.
- **Pakete:** `expo-audio` ist ungenutzt; `valtio` wird nur als Override für reown gebraucht.
- **Toter Zweig** `res.decision === 'duplicate_detected'` (`biometric-capture.tsx:1211`): Der Coordinator liefert `bio_hash` nur bei `new_enrollment` (`coordinator/app/main.py:932`).
- **Veraltete Texte:** `run-node.tsx`/`identity.tsx` sprechen teils noch von Handfläche und Gesicht.
- **Kein iOS-Bundle-Identifier** in `app.json`.

### 1.7 Tests

- 13 Unit-Testdateien in `lib/__tests__`: api_fallback, attestation, challenge_gleicher_coordinator, config, format, i18n, nachziehen, prove_register_gleicher_knoten, signer, ueberweisung, wallet, widerspruch, zahlungslink.
- CI (`.github/workflows/ci.yml`) führt tsc, `expo lint` und jest aus.
- Keine Komponententests, keine Tests für Screens oder Contexts, kein E2E.

---

## 2. Funktionsliste für eine professionelle Version

„✓“ bedeutet, der Endpunkt existiert (Route registriert in `x/humanity/keeper/api.go` bzw. Coordinator `coordinator/app/main.py`). „✗“ bedeutet, er fehlt.

### A. Onboarding und Registrierung

| Funktion | P | Endpunkt / Status |
|---|---|---|
| Willkommen, Erklärung „1 Mensch = 1 Konto“, Datenschutz-Kurzfassung | P0 | lokal; `/datenschutz` ✓ (Route; laut `docs/RECHTSTEXTE_FREISCHALTEN.md` 404, bis Betreiberangaben gesetzt sind; `/api/legal-status` api.go:1004) |
| Wallet anlegen: Seed anzeigen mit Screenshot-Sperre, **Wortprüfung**, kein Kopieren | P0 | lokal |
| Wallet wiederherstellen (12/24 Wörter, Wortliste mit Autovervollständigung); Private-Key-Import höchstens im Expertenmodus | P0 | lokal; danach `/api/balance` ✓ (1101) |
| App-Schutz einrichten: Biometrie oder Geräte-PIN, **App-PIN als Fallback** | P0 | lokal |
| Einwilligung (Art. 9 DSGVO, versioniert `CONSENT_VERSION`), getrennt vom Bonus-Opt-in | P0 | Coordinator `/register` Formularfelder ✓ (main.py:528) |
| Kamerarechte, Vorbereitung (Licht, Brille), Gesichtsführung, Lebendigkeit (Challenge, Farbblitz, Gyroskop), Sprachführung, Haptik | P0 | `/challenge` ✓ (main.py:511); Logik vorhanden in `biometric-capture.tsx` |
| Upload mit Fortschritt; **429/503 mit `Retry-After` automatisch abwarten, Countdown zeigen, Aufnahme behalten** | P0 | Coordinator liefert `Retry-After` ✓ (`mengengrenze.py:111–121`); App fehlt |
| Ergebnisfälle: neu, **Duplikat mit Widerspruch**, Aufnahme gescheitert, Lebendigkeit gescheitert, Quorum gescheitert, fehlende Einwilligung, `risk_blocked` → je eigener Text und Aktion | P0 | `/widerspruch` ✓ (main.py:1159), `/widerspruch/{kennung}` ✓ (1179) |
| Beweis → Signatur → Registrierung als **wiederaufnehmbare Zustandsmaschine** (Knotenbindung 14 min beibehalten, Fortschritt persistiert) | P0 | `/api/prove` ✓ (1131, `handleProveProxy` api.go:3359), `/api/register` ✓ (1100, `register.go:217`), `/api/check-registration-by-biohash` ✓ (1103); `/api/prove/store`, `/api/prove/get/` ✓ (1133/1132) wären für die Wiederaufnahme nutzbar |
| Fehler aus dem Beweis: 403 Bescheinigung abgelehnt, 409 `bio_used`/`wallet_used`, 429 | P0 | Proof-Server `server.js:492–600` ✓; die Kette reicht Status durch |
| Startguthaben bestätigen, bei Staffel „200 sofort + 800 über 30 Tage“ | P0 | `/api/balance` Feld `staffel` ✓ (api.go:2297); Staffel ist ruhend bis `stagedGrantActivationUnix` (grant_staffel.go) |
| Zweite Lebendigkeitsprüfung für die Staffel | P1 | Kette `/api/liveness-renewal` ✓ (1150, grant_staffel.go:278); **Coordinator-Endpunkt dafür ✗** (nicht unter den Routen von main.py) |
| Gerätegeheimnis-Registrierung | – | für V8 entfernen: macht nur ein Gerät einzigartig, keinen Menschen (`docs/ENDPOINTS.md` sagt das selbst) |

### B. Identität und Status

| Funktion | P | Endpunkt / Status |
|---|---|---|
| Status „verifizierter Mensch“, Registrierungsdatum, Kontoart | P0 | `/api/balance` `is_human` ✓; `/api/wirtschaft/konto` `art` ✓ (1153); Registrierungsdatum ✗ |
| Einwilligung widerrufen, Enrollment löschen (teilweise ≠ Erfolg) | P0 | `DELETE /enrollment` ✓ (main.py:1296) |
| Widerspruchsstatus einsehen | P1 | `/widerspruch/{kennung}` ✓ |
| PoH-Nachweis teilen (signiertes Credential) | P2 | `/api/humanity/credential` ✓ (1097) |
| Nachziehen (Altkonten) | – | nach Neustart bei null entfällt es |

### C. Wallet

| Funktion | P | Endpunkt / Status |
|---|---|---|
| Übersicht: AEQ, tUSD, **LP-Wert**, Gesamtwert, Stand „veraltet“-Hinweis | P0 | `/api/balance` ✓ (`lp_value_aeq`, `total_value_aeq`, api.go:2284ff); `/api/status` `stand_veraltet`/`stand_hinweis` ✓ |
| Grundeinkommen: nächste Auszahlung, Verlauf | P0 | `/api/status` `ubi_next_payout_secs` ✓; `/api/verlauf` ✓ (1154), **Filter nach Art ✗** (nur `adresse/vor/limit`, `kontoverlauf.go:227`); Prognose des Tagesbetrags je Mensch ✗ |
| Senden: Adresse (Prüfsumme, eigene Adresse, fremde Kette), Betrag, Max, **Gebührvorschau aus Freibetrag**, Überprüfungsbildschirm, Biometrie, Ergebnis mit Pending→Bestätigt | P0 | RPC `/rpc` ✓ (1182); `/api/wirtschaft/konto` `gebuehrenfrei_rest_monat` ✓ (wirtschaft_api.go:152); Beleg per `eth_getTransactionReceipt` ✓ |
| Nonce bei Überweisungen | P0 | über RPC `eth_getTransactionCount` ✓; die Kette prüft `NaechsteNonce` (`signierte_ueberweisung.go`) |
| Empfangen: QR als EIP-681 `ethereum:0x…@1926?value=`, Betrag anfordern, teilen | P0 | lokal (`lib/zahlungslink.ts` parst schon, erzeugen fehlt) |
| Zahlungslink per Deep- oder Universal-Link | P1 | Schema `aequitasapp` ✓ (`app.json`); **`/.well-known/assetlinks.json` und `apple-app-site-association` ✗** (nicht in den Routen) |
| Verlauf mit Filter, Details (Hash, Block, Gebühr, Gegenpartei), CSV-Export | P0 / P1 (Export) | `/api/verlauf` ✓ (bis 100 Einträge je Abruf, Blätterparameter `vor`) |
| Kontakte (lokal, mit Adressprüfung) | P1 | lokal |
| Wirtschaftsregeln transparent: Umlaufabgabe-Prognose (über 5 Freibeträge, 0,5 %/Monat), Freibeträge Rest/Monat, Vermögensgrenze 25×, Tausch-Freibetrag | P0 | `/api/wirtschaft/regeln` ✓ (1152), `/api/wirtschaft/konto` ✓ (`abgabe_pro_monat_bei_diesem_stand`, `tausch_frei_rest_monat`, `lp_wert`, `abgabe_grundlage`); `/api/wealth-cap` ✓ (1119). **Zahlen immer vom Server:** WHITEPAPER.md §4.2 nennt andere Gebührenaufschläge als `wirtschaft.go` |
| Treuhand-Warnung (2,5 Jahre Inaktivität), „Aktivität bestätigen“ | P0 | **Letzte Aktivität und Warnstufe ✗** (`last_activity_at` nur intern, `state.go:104`; Stufen in `guardian.go`); `/api/escrow` ✓ (1166, erst nach Verschiebung), `/api/recover-escrow` ✓ (1167) |
| Guardian festlegen, für andere „lebt noch“ bestätigen | P1 | `/api/set-guardian` ✓ (1163), `/api/confirm-alive` ✓ (1164), `/api/guardian` ✓ (1165). Nachrichten ohne Nonce oder Zeit (siehe 1.4); ob die Funktion in V8/Go bleibt, ist offen |
| tUSD-Faucet | P2 | `/api/faucet` ✓ (1109). Nur mit Kennzeichnung „Testgeld“ und außerhalb des Hauptwegs |

### D. Tausch und Liquidität

| Funktion | P | Endpunkt / Status |
|---|---|---|
| Kurs, Reserven, Preiseinfluss | P0 | `/api/pool` ✓ (1110, swap.go:497) |
| Vorschau inkl. 0,1 % Swapgebühr **und Ausstiegsabgabe** (Freibetrag 3.000 AEQ/Monat, eigene Einlage frei), Vorbehaltsreserve 102 % berücksichtigen, **einstellbare Slippage** | P0 | Daten aus `/api/pool` + `/api/wirtschaft/konto` (`tausch_frei_rest_monat`, `eigene_einlage_abgabefrei`) ✓; **serverseitiges Quote ✗** (empfohlen, sonst dupliziert die App Konsensrechnung) |
| Überprüfungsbildschirm mit exakt signiertem Text, Uhrabgleich über den `Date`-Header | P0 | `/api/nonce` ✓ (1121), `/api/swap` ✓ (1105) |
| Liquidität hinzufügen (nur Menschen), Verhältnis automatisch | P0 | `/api/add-liquidity` ✓ (1106) |
| LP-Position: Anteil, entnehmbarer Wert, Erträge | P0 / P1 (Erträge) | `/api/lp-position` ✓ (1108); Erträge über `/api/verlauf` Art `lp_distribution` ✓; Ertragsauswertung ✗ |
| Liquidität entnehmen | P0 | `/api/remove-liquidity` ✓ (1107) |
| Preisverlauf | P1 | `/api/price-history` ✓ (1118) |

### E. Unternehmen (sinnvoll ab P1, Konzept und Kette sind fertig)

| Funktion | P | Endpunkt / Status |
|---|---|---|
| Unternehmen eröffnen: **zweiter Schlüssel (HD-Index 1) plus Unterschrift des Menschen** | P1 | `/api/unternehmen/eroeffnen` ✓ (1158; Nachricht `wirtschaft_api.go:27`) |
| Mitinhaber aufnehmen (zwei Unterschriften, oft zwei Geräte → Signaturanfrage per QR) | P1 | `/api/unternehmen/mitinhaber` ✓ (1159) |
| Schließen | P2 | `/api/unternehmen/schliessen` ✓ (1160) |
| Liegegeld-Anzeige: Monatsumsatz, frei bis, hohe Stufe, Gründungsphase | P1 | `/api/wirtschaft/konto` (`umsatz.*`) ✓ |
| Kassenmodus (Betrag → QR → Beleg), CSV-Export mit Euro-Wert zum Zahlungszeitpunkt | P2 | lokal plus `/api/verlauf`; historischer Kurs je Zeitpunkt ✗ |
| Öffentliches Register | P2 | `/api/unternehmen` ✓ (1155) |

### F. Validator und Knoten

| Funktion | P | Endpunkt / Status |
|---|---|---|
| Netzstatus: Höhe, Validatoren, Gesundheit | P1 | `/api/status` ✓, `/api/validators` ✓ (1135), `/api/validator-labels` ✓ (1092), `/api/peers/status` ✓ (1126), `/api/wache` ✓ (1086) |
| „Mein Knoten“: Validator an mein Konto binden (Mensch signiert `"Aequitas: authorize validator <signing>"`) | P1 | `/api/register-validator-key` ✓ (1144, api.go:2901); Selbstbeweis `/api/validator-selfproof` ✓ (1162) |
| Validator-Einnahmen | P1 | `/api/verlauf` Art `validator_distribution` ✓ |
| Anleitung (Compose), Link zu `docs/VALIDATOR_EINRICHTEN.md` | P2 | statisch |
| Push bei Knotenausfall | P2 | ✗ |

### G. Sicherheit

| Funktion | P | Hinweis |
|---|---|---|
| Sperrbildschirm, Autosperre (Hintergrund / 60 s), Biometrie oder App-PIN, erneute Bestätigung vor jeder Signatur | P0 | lokal |
| Backup-Status, Seed erneut anzeigen (nach Auth), Backup-Erinnerung | P0 | setzt voraus, dass die Mnemonic gespeichert wird |
| „Wallet von diesem Gerät entfernen“ nur mit Backup-Bestätigung, Guthabenwarnung, Eintippen zur Bestätigung | P0 | lokal |
| Chain-ID- und Netzabgleich fail-closed; Erkennung des Neustarts bei null | P0 | `/api/status` `chain_evm_id` ✓; **Genesis- bzw. Netzkennung ✗** |
| Geräteintegrität: Play Integrity / App Attest bei der Registrierung | P1 | `lib/attestation.ts` vorhanden; iOS-Challenge muss vom Server kommen (Z. 224 lokal zufällig) |
| Screenshot- und Recents-Schutz auf Seed- und Signaturscreens | P0 | lokal |
| Mindestversion / Zwangsupdate | P1 | ✗ |

### H. Einstellungen, Sprachen, Barrierefreiheit, Zustände, Hilfe

| Funktion | P |
|---|---|
| Einstellungen: Sprache (12 vorhandene), Hell/Dunkel/System, Anzeigewährung nur als Hinweis (tUSD ist Testgeld, `wirtschaft_api.go:50`), Knotenwahl (Experten), Version | P0 |
| Barrierefreiheit: Rollen und Labels, Schriftskalierung, Kontrast AA in beiden Modi, Screenreader-Ansagen für Status, Kameraflow mit Sprache und Haptik | P0 |
| RTL für Arabisch | P1 |
| Offline-Banner, letzter bekannter Stand mit Zeitstempel, Ratelimit-Countdown, „Knoten veraltet“ | P0 |
| Benachrichtigungen (Eingang, Grundeinkommen, Treuhand-Warnung). **Backend-Push ✗**; `/api/events` (SSE, api.go:1083) ist nur ein Weckruf ohne Inhalt | P2 (lokal per Hintergrundabruf P2) |
| Hilfe/FAQ, Wirtschaftsregeln in einfacher Sprache, Kontakt | P1 |
| Impressum, Datenschutz, Nutzungsbedingungen; **Einwilligungstexte versioniert** | P0 |

**Backend-Lücken, die für P0 zu schließen sind:**

1. Aktivitäts- und Treuhandstatus je Konto.
2. Maschinenlesbare Fehlercodes statt Freitext mit HTTP 200.
3. `Retry-After` bei 429/503 der Kette.
4. Netz- bzw. Genesis-Kennung und Serverzeit in `/api/status`.
5. Signaturformate für V8 mit Domäne, Chain-ID, Nonce und Ablauf (am besten EIP-712); gilt auch für Guardian und Treuhand.
6. Optional ein Tausch-Quote-Endpunkt.

---

## 3. Architekturvorschlag

### 3.1 Ordnerstruktur

```
app/                         # nur Routen/Layouts (expo-router), dünn
  _layout.tsx                # Provider, Theme, Fonts, Splash, ErrorBoundary, Guards
  lock.tsx
  (onboarding)/…             # siehe 4.
  (app)/(tabs)/…  (app)/send/… (app)/settings/… usw.
src/
  ui/          tokens.ts, theme/ (ThemeProvider, useTheme), primitives/, patterns/
  features/    wallet/ exchange/ identity/ business/ node/ security/ settings/
               je: components/, hooks/ (Queries/Mutations), model/ (Zustandsautomaten)
  domain/      amount.ts (bigint Mikro-AEQ), fees.ts (aus ueberweisung.ts), amm.ts,
               levy.ts, address.ts, paymentLink.ts, messages.ts (alle Signaturtexte)
  api/         http.ts (Timeout, Retry-Policy, Knotenwahl/-bindung), errors.ts,
               chain.ts, coordinator.ts, rpc.ts, guards.ts (Antwortprüfung)
  crypto/      vault.ts (Schlüsselspeicher), signer.ts (nur typisierte Aufträge),
               session.ts (Entsperrzustand)
  storage/     secure.ts, prefs.ts
  i18n/        locales/, index.ts (t, plural, Intl-Formatierer)
```

**Abhängigkeitsrichtung:**

- UI → features → domain/api/crypto.
- `domain` ist rein, ohne React und ohne IO.
- Nur `crypto/signer` hält Schlüssel. Die UI bekommt nie `signMessage(string)`, sondern z. B. `signSwap(auftrag)`. So entsteht jeder signierte Text in `domain/messages.ts` und kann gegen die Go-Formate getestet werden.

### 3.2 State und Datenabruf

**Empfehlung: TanStack Query v5 als einzige neue Laufzeit-Bibliothek.** Kein Zustand, kein Redux.

- **Server-State (Guthaben, Pool, Verlauf, Regeln):** Queries mit `staleTime` und `refetchInterval` nur bei sichtbarem Screen. Das ersetzt die sechs `setInterval`.
  - `focusManager` an AppState koppeln, `onlineManager` an `expo-network` (Expo-Paket).
  - Erlaubt Deduplizierung, Pull-to-Refresh und Invalidierung nach Mutationen.
- **Retry-Policy zentral:**
  - Netzfehler und 503 mit Backoff (höchstens 3).
  - 429 nach `Retry-After`, sonst 4/8/12 s wie heute.
  - 4xx und Fachfehler nie wiederholen.
  - **Signierte Mutationen nie automatisch wiederholen.** Stattdessen Nonce neu holen und neu signieren, nach Bestätigung.
- **Client-State (Sitzung/Entsperrt, Onboarding-Fortschritt, Registrierungsautomat):** React Context + `useReducer`. Er ist klein, deshalb reicht das.
- **Registrierung als expliziter Zustandsautomat:**
  - Zustände: `consent → challenge → capture → upload(wait?) → prove → sign → register → confirm`.
  - Zwischenstand persistieren (ohne Rohbilder), Wiederaufnahme innerhalb der Knotenbindung.

### 3.3 Navigation (expo-router, `Stack.Protected` wie heute)

- **Guard 1:** kein Wallet → `(onboarding)`.
- **Guard 2:** Wallet gesperrt → `lock`.
- **Guard 3:** entsperrt → `(app)`.
- Registrierung ist ein eigener Stack im Onboarding und später erneut aufrufbar. Wallet-Nutzung ohne Registrierung bleibt möglich (freie Adresse bis 250 AEQ, `wirtschaft.go`).
- **Tabs (4):** Übersicht · Zahlen · Tausch · Mehr.
- Senden, Empfangen und Details als Stack- bzw. Sheet-Screens. Bestätigungen als Sheet, nicht als `Alert`.
- Vor dem Bau die SDK-54-Doku (`docs.expo.dev/versions/v54.0.0`) auf `presentation: 'formSheet'` prüfen, wie `AGENTS.md` im App-Repo verlangt.

### 3.4 Fehler- und Ladezustände

- **Ein Fehlertyp:** `ApiError{kind: network|timeout|rateLimited(retryAfter)|unavailable|rejected(code)|invalidResponse|clockSkew|chainMismatch}` mit i18n-Abbildung.
  - `fehlerArt()` aus `lib/ueberweisung.ts` wird Teil davon, bis die Kette Codes liefert.
- **Einheitliche Bausteine:** `Skeleton`, `EmptyState`, `ErrorState` (mit „Erneut versuchen“), `OfflineBanner`, `RateLimitNotice` (Countdown).
- **Fail-closed:**
  - Fehlt die Kontoauskunft, gilt die volle Gebühr (wie heute).
  - Fehlt die Abgabeinfo, gelten 2 %.
  - Weicht die Chain-ID ab, gibt es keine Signatur.
- Error-Boundary pro Route. Der globale Handler unterdrückt fatale Fehler nicht mehr.

### 3.5 i18n

- Eigene typisierte Lösung beibehalten: 12 Sprachen und Paritätstest sind vorhanden.
- Korrekturen:
  - `replaceAll` für Platzhalter
  - Plural über `Intl.PluralRules`
  - Beträge und Daten über `Intl.NumberFormat`/`DateTimeFormat` je Sprache
  - Gerätesprache als Start (`expo-localization`, Expo-Paket)
  - RTL über `I18nManager`
- Schlüssel nach Feature ordnen. Beträge nie abkürzen, wenn sie bestätigt werden.

### 3.6 Designsystem

- **Tokens (hell und dunkel):**
  - Farben semantisch: `bg`, `surface`, `surfaceRaised`, `border`, `text/secondary/tertiary`, `accent`, `positive`, `negative`, `warning`, `info`, `focus`
  - Abstände auf 4-pt-Raster, Radien, Typografie (Display/Title/Body/Caption, tabellarische Ziffern für Beträge), Elevation, Bewegung mit Reduce-Motion
  - Akzent `#5B8CFF` der Website bleibt; neutrale Flächen für einen ruhigen Banking-Look
- **Komponenten:**
  - Text, Heading, Amount (Vorzeichen, Einheit, Mikro-Präzision)
  - Button (primary/secondary/tertiary/destructive, loading), IconButton
  - TextField, AmountField (Max, Einheit), AddressField (Einfügen/Scan/Prüfsumme/Identicon)
  - Card, ListRow, SectionHeader, KeyValueRow (Gebührenaufstellung), Divider
  - Badge, Banner, Toast, Sheet, ConfirmSheet
  - SegmentedControl, Switch, Skeleton, EmptyState, ErrorState
  - Stepper/ProgressSteps, Countdown, PinPad
  - SeedWordGrid, SeedVerify, QRCode (react-native-qrcode-svg vorhanden), Scanner, Sparkline (react-native-svg vorhanden)
  - CameraGuide (Oval, Zustände)

### 3.7 Schlüsselkonzept

1. **Speicherung:** BIP-39 und BIP-44 `m/44'/60'/0'/0/i` (i=0 Mensch, i≥1 Unternehmen).
   - **Entropie bzw. Mnemonic** in SecureStore mit `requireAuthentication` und `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
   - Ohne Biometrie: verschlüsselt mit App-PIN-abgeleitetem Schlüssel (scrypt, in ethers enthalten).
   - Ohne Bildschirmsperre: App-PIN ist Pflicht (schließt `wallet.ts:76–81`).
2. **Gebrauch:**
   - Entschlüsseln nur für eine Signatur, Signer danach verwerfen.
   - Autosperre beim Verlassen von „active“ (übernehmen) und nach 60 s Inaktivität.
3. **Signatur-UX:** Jede Signatur hat einen Überprüfungsbildschirm, der den **exakten** Auftrag zeigt (Betrag, Gebühr, Abgabe, Empfänger vollständig, Nonce). Danach Biometrie.
4. **Migration vom Altspeicher:** `aequitas_wallet_secret_v1` enthält nur den Private Key.
   - Bestandsnutzer bekommen „Backup nicht möglich, bitte neues Konto mit Seed anlegen“, oder den Key weiter nutzen mit Hinweis.
   - Nach dem Neustart bei null ist ein neues Seed-Konto vertretbar.
5. **WalletConnect:** Nur noch P2 oder entfernen.
   - Spart die reown-Abhängigkeiten, `lib/walletconnect.ts` (288 Zeilen) und `lib/globalErrorHandler.ts`.
   - Registrierung und Aufträge sind ohnehin an App-Formate gebunden.

### 3.8 Tests

- **Unit (jest-expo, vorhanden) für `domain/`:**
  - Gebühren, Höchstbetrag, AMM, Abgabe, Beträge
  - **Golden-Tests der Signaturtexte gegen die Go-Formate** (`swap.go`, `auftrag_nachweis.go`, `wirtschaft_api.go:27–37`), idealerweise mit gemeinsamen Vektoren aus den Go-Tests
- **api-Schicht mit gemocktem fetch:** 429 mit/ohne `Retry-After`, 503, Timeout, Knotenwechsel, prove→register-Bindung.
- **Komponenten:** `@testing-library/react-native` (neue Dev-Abhängigkeit) für Formulare, Sheets, Zustände.
- **E2E:** Maestro (externes Werkzeug, keine npm-Abhängigkeit) für Onboarding anlegen/wiederherstellen, Sperren, Senden, Tausch. Kamera nur manuell bzw. per Geräteliste.
- **Missbrauchstests gemäß `AGENTS.md`:**
  - QR mit fremder Chain
  - Adresse mit falscher Prüfsumme
  - Betragsüberlauf
  - Doppelte Nonce
  - Uhrabweichung
  - Chain-ID-Mismatch
  - 429-Sturm (Retry-Obergrenze)
  - Übergroße oder fehlerhafte Serverantwort (Guards, Listenlimits)

---

## 4. Informationsarchitektur

**Onboarding**

1. **Willkommen:** Wert in drei Sätzen, Sprache, „Konto anlegen“ / „Wiederherstellen“.
2. **Sicherheit einrichten:** Biometrie oder App-PIN.
3. **Seed:** Erklärung → Anzeige (Screenshot-Sperre) → Prüfung von drei Wörtern.
4. **Wiederherstellen:** Worteingabe mit Vorschlägen.
5. **Identität (optional jetzt, später in „Mehr“):** Einwilligung → Vorbereitung → Aufnahme → Übertragung (Warten/Countdown) → Ergebnis. Bei Duplikat Widerspruch, bei Fehlern Wiederholen.
6. **Fertig:** Startguthaben bzw. Staffel.

**App-Tabs**

- **Übersicht:**
  - Gesamtwert (AEQ + LP), tUSD getrennt
  - Karte „Grundeinkommen“ (nächste Auszahlung, letzte Beträge)
  - Hinweiskarten (Umlaufabgabe-Prognose, Treuhand-Warnung, Backup fehlt, Staffel)
  - Letzte Buchungen → Verlauf
- **Zahlen:**
  - Senden: Empfänger → Betrag → Überprüfung → Ergebnis/Beleg
  - Empfangen: QR, Betrag anfordern, teilen
  - Kontakte
  - Verlauf mit Filter → Buchungsdetail
- **Tausch:**
  - Tauschen: Richtung, Betrag, Vorschau mit Gebühr, Abgabe, Slippage → Überprüfung → Ergebnis
  - Liquidität: Position, hinzufügen, entnehmen
  - Kurs/Verlauf
- **Mehr:**
  - Identität & Status (Nachweis, Einwilligung/Löschung, Widerspruch)
  - Wirtschaftsregeln (aus `/api/wirtschaft/regeln`, verständlich erklärt)
  - Unternehmen (P1)
  - Knoten & Netz (P1)
  - Treuhand/Guardian
  - Sicherheit (Backup, Sperre, Gerät entfernen)
  - Einstellungen (Sprache, Darstellung, Netz)
  - Hilfe
  - Rechtliches
  - App-Info

**Global:** Sperrbildschirm, Offline-Banner, Deep-Link-Einstieg (Zahlungslink → Senden mit vorausgefüllten Feldern und Chain-Prüfung).

---

## 5. Migrationsplan

Der Neubau passiert im selben Repo auf einem eigenen Zweig. Paket `digital.aequitas.app` und Keystore bleiben gleich (`eas.json`), damit Updates ohne Neuinstallation funktionieren.

| Etappe | Inhalt | Übernahme aus dem Bestand |
|---|---|---|
| 0 Klärung | V8-Konstanten und Signaturformate (EIP-712?); Backend-Lücken aus 2. beauftragen; Umfang v1 (Unternehmen? WalletConnect?); Rechtstexte | – |
| 1 Fundament | Tokens, ThemeProvider hell/dunkel, Primitives, i18n-Port und Fixes, api-Client (Timeouts, Retry-Policy, Fehlertyp), TanStack Query, `domain/amount` in bigint | Knotenwahl und prove-Bindung aus `lib/api.ts`; `lib/format.ts:parseAEQToWei/formatWeiToAEQ`; Locales-Texte; `lib/__tests__/*` |
| 2 Schlüssel & Onboarding | Vault, Sperre, App-PIN, Seed anlegen/prüfen/wiederherstellen, Migration des alten Keys, Einstellungen/Sicherheit | Auth-Erkenntnisse und AppState-Sperre aus `lib/wallet.ts`; Signer-Interface und `withTimeout` aus `lib/signer.ts`; FallbackProvider |
| 3 Wallet | Übersicht, Senden-Flow, Empfangen/EIP-681, Verlauf/Detail, Regelkarten | `lib/ueberweisung.ts` (auf bigint), `lib/zahlungslink.ts` (+ Erzeugung), `components/Verlauf.tsx:artSchluessel`, `components/QrScanner.tsx` |
| 4 Identität (V8) | Registrierungsautomat, Aufnahme-UI neu, Hooks aus `biometric-capture.tsx` extrahieren (Gesichtsführung, Challenge, Blitz, Gyroskop, Burst-Video, TTS), 429/503-Warten, Ergebnisfälle, Löschung, Widerspruch | `lib/biometricIdentity.ts` fast vollständig (Nonce-Bindung, Einwilligung, Aufräumen, Widerspruch, Löschung); `lib/identity.ts:proveAndRegister` mit V8-Adresse; `lib/attestation.ts`; `plugins/`, `patches/` |
| 5 Tausch | Quote inkl. Abgabe/Vorbehalt, Slippage, Liquidität, LP | Nachrichtenformate aus `trade.tsx`, AMM-Vorschau |
| 6 Mehr | Treuhand/Guardian, Knotenstatus und -bindung, Unternehmen (P1), Hilfe/Recht | Texte aus `run-node.tsx` |
| 7 Härtung | E2E, Barrierefreiheitsprüfung, Missbrauchstests, **eigene Sicherheitsprüfung des Diffs** (Pflicht laut `AGENTS.md`: Signaturen/Kontostände), Beta-Rollout | – |

**Entfernen:**

- Vorlagenreste (1.6)
- `modules/mediapipe-hand-detector` und die zugehörigen R8-Regeln
- `expo-audio`
- `RECORD_AUDIO`
- Gerätegeheimnis-Registrierung
- `lib/walletconnect.ts`, reown/valtio und `globalErrorHandler.ts` (falls WalletConnect entfällt)
- `docs/ENDPOINTS.md` aktualisieren

**Risiken**

1. **Neustart bei null.**
   - Alle Guthaben verfallen.
   - Lokale `bio_hash`/`nachgezogen`-Stände werden ungültig, die Coordinator-Testdaten werden gelöscht (`docs/LAUNCH_CHECKLISTE.md:130`).
   - Ohne Netzkennung erkennt die App den Wechsel nicht.
   - Nutzerkommunikation in der App ist nötig.
2. **Signaturformate müssen byteweise zu Go passen.** Jede Abweichung heißt „signature invalid“ nach der Nutzerbestätigung. Golden-Tests sind Pflicht.
3. **Uhrabweichung ±60 s bei Tausch und Liquidität** (`swap.go:128`) sorgt ohne Serverzeit für sporadische Fehlschläge.
4. **Native Fragilität der Gesichtsaufnahme** (vision-camera 5 + Patches + R8). Das Neuschreiben der UI darf die geprüfte Logik nicht verlieren; deshalb in Hooks extrahieren statt neu erfinden.
5. **Backend-Lücken blockieren P0** (Treuhandstatus, Fehlercodes, Netzkennung, `Retry-After`). Ohne sie kann die App diese Teile nur schätzen oder weglassen.
6. **Konsensrechnung in der App** (Gebühr, Abgabe, AMM) kann von der Kette abweichen. Zahlen deshalb aus `/api/wirtschaft/*` lesen, ein Quote-Endpunkt wäre besser. WHITEPAPER §4.2 widerspricht `wirtschaft.go` bereits.
7. **Keystore-Kontinuität:** Wechselt der Signierschlüssel, müssen Bestandsnutzer neu installieren (`eas.json`, `docs/RELEASE_SIGNING.md`).
8. **Recht:** Impressum und Datenschutz liefern noch 404. Biometrie nach Art. 9 DSGVO braucht vor dem Einschalten versionierte Einwilligungstexte und eine Rechtsprüfung (`.env.example`, `lib/biometricIdentity.ts`-Kopf).
9. **Umfang:** Unternehmen brauchen Zwei-Schlüssel- bzw. Zwei-Geräte-Signaturen. Das gehört eher nicht in v1.

---

## 6. Entscheidungen (30.09.2026)

- Stil: ruhig, seriös, Banking; heller und dunkler Modus.
- Umfang v1: Onboarding mit Schlüsselsicherung, Registrierung und Identität, Wallet (Senden/Empfangen/Verlauf/Wirtschaftsregeln), Tausch und Liquidität, Knoten und Netz. Unternehmen folgen in v1.1 (Zwei-Schlüssel-Signaturen).
- WalletConnect entfällt in v1 (spart reown/valtio, `lib/walletconnect.ts`, `globalErrorHandler.ts`); Registrierung und Aufträge sind ohnehin an App-Formate gebunden.
- Gerätegeheimnis-Registrierung entfällt.
- Neubau auf dem Zweig `claude/app-neubau`, in Etappen nach Abschnitt 5; Paketname und Signierschlüssel bleiben.
- Backend-Lücken aus Abschnitt 2 werden in der Kette parallel geschlossen (Netzkennung und Serverzeit in `/api/status`, `Retry-After`, Fehlercodes, Aktivitäts-/Treuhandstatus, EIP-712-Aufträge mit V8).
