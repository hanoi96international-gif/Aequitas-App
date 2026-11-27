#!/usr/bin/env bash
# Tests fuer release_lauf_pruefen.sh: der Gutfall und jeder Angriff, den die
# entfallene zweite Freigabe vorher abgefangen haette.
set -euo pipefail
cd "$(dirname "$0")"
t="$(mktemp -d)"
trap 'rm -rf "$t"' EXIT
REPO="hanoi96international-gif/Aequitas-App"
ok=0; schlecht=0

lauf() { # path repo head_repo branch
  printf '{"path":"%s","repository":{"full_name":"%s"},"head_repository":{"full_name":"%s"},"head_branch":"%s"}' "$1" "$2" "$3" "$4" > "$t/lauf.json"
}
jobs() { printf '{"jobs":[%s]}' "$1" > "$t/jobs.json"; }
SIG='{"name":"build","conclusion":"success"},{"name":"signieren","conclusion":"success"}'

soll() { # erwartung beschreibung tag neuester
  if bash ./release_lauf_pruefen.sh "$t/lauf.json" "$t/jobs.json" "$REPO" "$3" "$4" >/dev/null 2>&1; then ist=an; else ist=ab; fi
  if [ "$ist" = "$1" ]; then ok=$((ok + 1)); else echo "FALSCH: $2 (erwartet $1, war $ist)"; schlecht=$((schlecht + 1)); fi
}

gut() { lauf .github/workflows/build-apk.yml "$REPO" "$REPO" aequitas-app; jobs "$SIG"; }

gut; soll an "Gutfall" v1.33.0 v1.32.0
gut; soll an "Gutfall ohne bisheriges Release" v1.33.0 ""
gut; soll an "Patch neuer" v1.32.1 v1.32.0
gut; soll an "Major neuer, Minor kleiner" v2.0.0 v1.33.9
gut; soll an "zweistellig (10 > 9)" v1.10.0 v1.9.0

# Herkunft des Laufs
lauf .github/workflows/ci.yml "$REPO" "$REPO" aequitas-app; jobs "$SIG"; soll ab "anderer Workflow" v1.33.0 v1.32.0
lauf .github/workflows/build-apk.yml "$REPO" "fremd/Aequitas-App" aequitas-app; jobs "$SIG"; soll ab "Fork" v1.33.0 v1.32.0
lauf .github/workflows/build-apk.yml "fremd/x" "fremd/x" aequitas-app; jobs "$SIG"; soll ab "anderes Repo" v1.33.0 v1.32.0
lauf .github/workflows/build-apk.yml "fremd/x" "$REPO" aequitas-app; jobs "$SIG"; soll ab "Lauf eines anderen Repos mit unserem Code" v1.33.0 v1.32.0
gut; jobs '{"name":"signieren","conclusion":"success"},{"name":"signieren","conclusion":"success"}'; soll ab "zwei erfolgreiche Jobs signieren" v1.33.0 v1.32.0
lauf .github/workflows/build-apk.yml "$REPO" "$REPO" claude/irgendwas; jobs "$SIG"; soll ab "nicht gemergter Zweig" v1.33.0 v1.32.0
printf '{"repository":{"full_name":"%s"}}' "$REPO" > "$t/lauf.json"; jobs "$SIG"; soll ab "Felder fehlen" v1.33.0 v1.32.0
echo 'kein json' > "$t/lauf.json"; soll ab "Lauf kein JSON" v1.33.0 v1.32.0

# Signieren
gut; jobs '{"name":"build","conclusion":"success"}'; soll ab "nie signiert" v1.33.0 v1.32.0
gut; jobs '{"name":"signieren","conclusion":"skipped"}'; soll ab "signieren uebersprungen" v1.33.0 v1.32.0
gut; jobs '{"name":"signieren","conclusion":null}'; soll ab "signieren wartet noch" v1.33.0 v1.32.0
gut; jobs '{"name":"signieren","conclusion":"failure"}'; soll ab "signieren fehlgeschlagen" v1.33.0 v1.32.0
gut; jobs '{"name":"signieren","conclusion":"success"},{"name":"signieren","conclusion":"failure"}'; soll ab "zwei Jobs signieren" v1.33.0 v1.32.0
gut; echo '{}' > "$t/jobs.json"; soll ab "Jobs fehlen" v1.33.0 v1.32.0

# Zurueckspielen und Form
gut; soll ab "gleiche Version" v1.32.0 v1.32.0
gut; soll ab "aeltere Version" v1.31.5 v1.32.0
gut; soll ab "aelter trotz groesserem Patch" v1.9.99 v1.10.0
gut; soll ab "Tag ohne v" 1.33.0 v1.32.0
gut; soll ab "Tag mit Einschub" 'v1.33.0"; curl x #' v1.32.0
gut; soll ab "neuester Tag unlesbar" v1.33.0 app-v1.18.6

# Falsche Zahl der Argumente
if bash ./release_lauf_pruefen.sh "$t/lauf.json" >/dev/null 2>&1; then echo "FALSCH: zu wenige Argumente angenommen"; schlecht=$((schlecht + 1)); else ok=$((ok + 1)); fi

echo "release_lauf_pruefen: $ok richtig, $schlecht falsch"
[ "$schlecht" = 0 ]
