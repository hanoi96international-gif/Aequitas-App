# Legt den Android-Signaturschluessel an und hinterlegt die vier Secrets.
#
# Du gibst genau EIN Passwort vor. Alles andere ist vorbereitet.
#
# Aufruf in PowerShell:
#     powershell -ExecutionPolicy Bypass -File .\scripts\signaturschluessel-anlegen.ps1
#
# WARUM DAS SEIN MUSS
#
# Android bindet eine Installation an die Signatur. Ein Update mit einem
# anderen Schluessel wird nicht als Update erkannt, sondern abgelehnt -- die
# einzige Moeglichkeit waere dann Deinstallieren und neu installieren. Dabei
# geht der lokale Schluesselspeicher der App mit: Wallet samt Seed-Phrase.
# Deshalb ERST signieren, DANN Tester einladen.
#
# WAS DIESES SKRIPT NICHT TUT
#
# Es waehlt kein Passwort fuer dich und schreibt es nirgendwo hin. keytool
# fragt danach, du tippst es, und es steht in keiner Kommandozeile und in
# keiner Datei. Fuer die GitHub-Secrets fragt das Skript noch einmal und
# prueft VORHER, ob es zum Schluesselspeicher passt -- ein Tippfehler faellt
# damit hier auf und nicht erst beim Build.

$ErrorActionPreference = 'Stop'

$Repo     = 'hanoi96international-gif/Aequitas-App'
$Alias    = 'aequitas'
$Keystore = Join-Path $HOME 'aequitas-release.jks'

Write-Host ''
Write-Host '=== Aequitas: Signaturschluessel anlegen ===' -ForegroundColor Cyan
Write-Host ''

# --- 0) Werkzeuge -----------------------------------------------------------
foreach ($werkzeug in @('keytool', 'gh')) {
    if (-not (Get-Command $werkzeug -ErrorAction SilentlyContinue)) {
        Write-Host "FEHLER: $werkzeug ist nicht im PATH." -ForegroundColor Red
        exit 1
    }
}

# --- 1) Nichts ueberschreiben ----------------------------------------------
# Ein vorhandener Schluesselspeicher darf NIE ueberschrieben werden: damit
# waere die Signatur jeder bereits veroeffentlichten App unwiederbringlich weg.
if (Test-Path $Keystore) {
    Write-Host "Es gibt bereits einen Schluesselspeicher:" -ForegroundColor Yellow
    Write-Host "  $Keystore"
    Write-Host ''
    Write-Host 'Der wird NICHT ueberschrieben. Wenn das der richtige ist, kannst du'
    Write-Host 'unten bei Schritt 3 weitermachen. Wenn nicht, benenne ihn erst um.'
    exit 1
}

# --- 2) Schluessel erzeugen -------------------------------------------------
Write-Host 'Schritt 1 von 3: Schluessel erzeugen' -ForegroundColor Green
Write-Host ''
Write-Host 'keytool fragt gleich nach einem Passwort und laesst es dich'
Write-Host 'wiederholen. Danach fragt es nach dem Schluessel-Passwort --'
Write-Host 'dort einfach ENTER druecken, dann ist es dasselbe.'
Write-Host ''
Write-Host 'Das Passwort waehlst DU. Es wird nirgends gespeichert.' -ForegroundColor Yellow
Write-Host ''

& keytool -genkeypair -v `
    -keystore $Keystore `
    -keyalg RSA -keysize 4096 -validity 10000 `
    -alias $Alias `
    -dname 'CN=Aequitas, O=Aequitas, C=DE'

if (-not $?) {
    Write-Host 'FEHLER: keytool ist fehlgeschlagen. Nichts wurde hinterlegt.' -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $Keystore)) {
    Write-Host 'FEHLER: der Schluesselspeicher wurde nicht angelegt.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host "Angelegt: $Keystore" -ForegroundColor Green

# --- 3) Passwort einmal erfragen und SOFORT pruefen -------------------------
Write-Host ''
Write-Host 'Schritt 2 von 3: dasselbe Passwort fuer die GitHub-Secrets' -ForegroundColor Green
Write-Host ''
$sicher = Read-Host -AsSecureString 'Passwort noch einmal eingeben'
$bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sicher)
$klar   = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

try {
    # Erst pruefen, dann hinterlegen. Ein Tippfehler waere sonst erst beim
    # Build aufgefallen -- mit einer Fehlermeldung, die nicht nach
    # "falsches Passwort" aussieht.
    $null = & keytool -list -keystore $Keystore -storepass $klar -alias $Alias 2>&1
    if (-not $?) {
        Write-Host ''
        Write-Host 'FEHLER: dieses Passwort passt nicht zum Schluesselspeicher.' -ForegroundColor Red
        Write-Host 'Es wurde nichts hinterlegt. Skript einfach nochmal starten --' -ForegroundColor Red
        Write-Host 'der Schluessel bleibt erhalten, nur Schritt 3 fehlt dann noch.' -ForegroundColor Red
        exit 1
    }

    # Fingerabdruck merken: damit laesst sich spaeter pruefen, ob eine APK
    # wirklich mit DIESEM Schluessel signiert ist.
    $fp = (& keytool -list -v -keystore $Keystore -storepass $klar -alias $Alias |
           Select-String 'SHA256:' | Select-Object -First 1).ToString().Trim()

    # --- 4) Secrets hinterlegen --------------------------------------------
    Write-Host ''
    Write-Host 'Schritt 3 von 3: Secrets hinterlegen' -ForegroundColor Green

    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($Keystore))

    $b64  | & gh secret set ANDROID_KEYSTORE_BASE64   -R $Repo
    $klar | & gh secret set ANDROID_KEYSTORE_PASSWORD -R $Repo
    $klar | & gh secret set ANDROID_KEY_PASSWORD      -R $Repo
    $Alias| & gh secret set ANDROID_KEY_ALIAS         -R $Repo
}
finally {
    # Klartext aus dem Speicher raeumen, egal wie das Skript endet.
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $klar = $null
    $b64  = $null
    [GC]::Collect()
}

Write-Host ''
Write-Host '=== Fertig ===' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Fingerabdruck deines Schluessels (nicht geheim, zum Nachpruefen):'
Write-Host "  $fp" -ForegroundColor Yellow
Write-Host ''
Write-Host 'JETZT NOCH WICHTIG:' -ForegroundColor Red
Write-Host "  Sichere $Keystore an ZWEI getrennten Orten."
Write-Host '  Geht die Datei verloren, kannst du fuer bereits installierte Apps'
Write-Host '  NIE WIEDER ein Update veroeffentlichen -- es gibt keinen'
Write-Host '  Wiederherstellungsweg, auch nicht ueber Google.'
Write-Host ''
Write-Host 'Danach kann der naechste APK-Build laufen. Die Warnung'
Write-Host '"Release-Build mit Debug-Schluessel" darf dann nicht mehr auftauchen.'
Write-Host ''
