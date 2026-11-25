// Die Einrichtungsbefehle, die der Tab "Knoten" zum Kopieren zeigt
// (Aequitas-Repo: deploy/knoten, deploy/validator, deploy/verifier).
//
// SICHERHEIT: Der Text wird in eine Root-Shell auf dem eigenen Server
// eingefuegt. Darum steht die Wallet nur darin, wenn sie GENAU eine Adresse ist
// (0x + 40 Hex-Zeichen), sonst gar nicht -- dann fragt das Skript selbst. Nie
// wird etwas anderes eingesetzt.

const REPO = 'https://github.com/hanoi96international-gif/Aequitas.git';
const ADRESSE = /^0x[0-9a-fA-F]{40}$/;

function walletTeil(wallet?: string | null): string {
  return wallet && ADRESSE.test(wallet) ? ' ' + wallet.toLowerCase() : '';
}

function befehl(ordner: 'knoten' | 'validator' | 'verifier', zusatz: string): string {
  return `curl -fsSL https://get.docker.com | sh
git clone ${REPO}
cd Aequitas/deploy/${ordner} && bash einrichten.sh${zusatz}`;
}

/** Knotenbetreiber: Validator und Verifier mit einem Befehl (docs/KNOTEN_EINRICHTEN.md). */
export function knotenBefehl(wallet?: string | null): string {
  return befehl('knoten', walletTeil(wallet));
}

/** Nur der Validator (docs/VALIDATOR_EINRICHTEN.md). */
export function validatorBefehl(wallet?: string | null): string {
  return befehl('validator', walletTeil(wallet));
}

/** Nur der Verifier (docs/VERIFIER_EINRICHTEN.md); fragt die Wallet selbst. */
export const VERIFIER_BEFEHL = befehl('verifier', '');
