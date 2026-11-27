#!/usr/bin/env bash
# Prueft, ob ein Build-Lauf veroeffentlicht werden darf (release-apk.yml).
#
# Seit dem 27.11.2026 (Entscheidung des Betreibers) gibt nur noch das
# SIGNIEREN eine menschliche Freigabe (Umgebung app-signatur in
# build-apk.yml). Das Veroeffentlichen laeuft ohne zweite Freigabe. Was die
# zweite Freigabe sicherte, prueft jetzt dieses Skript, fail-closed:
#
#   - der Lauf ist build-apk.yml in DIESEM Repo (kein Fork, kein anderer
#     Workflow, der ein Artefakt gleichen Namens hochlaedt),
#   - auf dem Zweig aequitas-app (nur gemergter Code),
#   - der Job "signieren" lief erfolgreich (er ist der einzige mit dem
#     Release-Schluessel und nur mit Freigabe),
#   - der Tag ist neuer als das neueste Release (kein Zurueckspielen einer
#     alten, ebenfalls signierten APK als "neueste").
#
# Danach prueft release-apk.yml weiter selbst: Fingerabdruck des
# Release-Schluessels aus der APK, Tag gleich Version in app.json des
# gebauten Commits.
#
# Aufruf: release_lauf_pruefen.sh LAUF.json JOBS.json REPO TAG NEUESTER_TAG
#   LAUF.json  = gh api repos/REPO/actions/runs/ID
#   JOBS.json  = gh api repos/REPO/actions/runs/ID/jobs
#   NEUESTER_TAG = Tag des neuesten Releases ("" wenn keins)
set -euo pipefail

fehler() { echo "::error title=Release abgelehnt::$1"; exit 1; }

[ "$#" -eq 5 ] || fehler "Aufruf: LAUF.json JOBS.json REPO TAG NEUESTER_TAG"
lauf="$1"; jobs="$2"; repo="$3"; tag="$4"; neuester="$5"

[[ "$tag" =~ ^v([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,4})$ ]] || fehler "Tag $tag hat nicht die Form v1.2.3"
neu=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}")

wert() { jq -er "$2" "$1" 2>/dev/null || fehler "Feld $2 fehlt in $1"; }

[ "$(wert "$lauf" .path)" = ".github/workflows/build-apk.yml" ] || fehler "Lauf ist nicht build-apk.yml"
[ "$(wert "$lauf" .repository.full_name)" = "$repo" ] || fehler "Lauf gehoert zu einem anderen Repo"
[ "$(wert "$lauf" .head_repository.full_name)" = "$repo" ] || fehler "Lauf baut Code aus einem Fork"
[ "$(wert "$lauf" .head_branch)" = "aequitas-app" ] || fehler "Lauf baut nicht aequitas-app"

# Genau ein Job "signieren", und der erfolgreich (zwei Jobs ergaeben zwei
# Zeilen, keiner eine leere: beides ist nicht "success").
[ "$(jq -er '.jobs[] | select(.name == "signieren") | .conclusion' "$jobs" 2>/dev/null)" = "success" ] || fehler "Job signieren nicht erfolgreich"

if [ -n "$neuester" ]; then
  [[ "$neuester" =~ ^v([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,4})$ ]] || fehler "Neuester Tag $neuester unlesbar"
  alt=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}")
  groesser=0
  for i in 0 1 2; do
    if ((10#${neu[$i]} > 10#${alt[$i]})); then groesser=1; break; fi
    if ((10#${neu[$i]} < 10#${alt[$i]})); then break; fi
  done
  [ "$groesser" = 1 ] || fehler "Tag $tag ist nicht neuer als das neueste Release $neuester"
fi

echo "Lauf darf veroeffentlicht werden: build-apk.yml auf aequitas-app, signiert, $tag > ${neuester:-nichts}"
