import { ethers } from 'ethers';
import { CHAIN_ID_DEC, V7_CONTRACT } from '@/lib/config';
import { gueltigeKennung } from '@/src/api/netz';

// EIP-712-Unterschrift der Registrierung fuer den Registervertrag V8
// (Aequitas: contracts/AequitasV8.sol, x/humanity/keeper/vertrag_v8.go).
//
// Die Wallet stimmt zu, dass GENAU sie mit GENAU diesem Beweis (commitment =
// pubSignals[0], nullifier = pubSignals[1]) Mensch wird, bis zu einer Frist,
// und nur in DIESEM Netz: die Domaene traegt salt = keccak256(netz_kennung).
// Nach einem Neustart der Kette bei null gilt eine alte Unterschrift nicht,
// auch bei gleicher Chain-ID und Adresse.
//
// Die Domaene wird hier aus festen Werten gebaut, nicht vom Knoten
// uebernommen (eip712Domain() am Vertrag). Ein Knoten kann so nur die
// netz_kennung vorgeben, und die ist gegen das Format und die gespeicherte
// Kennung geprueft (src/api/netz.ts). Jeder Knoten prueft die Unterschrift
// beim Nachspielen selbst gegen dieselbe Domaene.
//
// Gemeinsamer Pruefvektor mit Go: TestV8_GoldenVektorMitDerApp
// (vertrag_v8_test.go) <-> __tests__/registerV8.test.ts.

export const REGISTER_V8_TYPES = {
  Register: [
    { name: 'human', type: 'address' },
    { name: 'commitment', type: 'uint256' },
    { name: 'nullifier', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** Wie AequitasV8.MAX_SIGNATURE_LIFETIME: hoechstens einen Tag. */
export const MAX_FRIST_S = 24 * 60 * 60;

/**
 * Wie lange die App ihre Unterschrift gelten laesst. Der Knoten verlangt
 * jetzt <= Frist <= jetzt + 1 Tag (nach SEINER Uhr). 30 Minuten decken die
 * 15 Minuten, die der Beweis am Knoten gilt, und eine Geraeteuhr, die bis
 * 30 Minuten nach- oder bis gut 23 Stunden vorgeht.
 */
export const FRIST_S = 30 * 60;

// BN254-Skalarkoerper, wie AequitasV8.SNARK_SCALAR_FIELD.
const FELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
// secp256k1 n/2 (EIP-2): der Knoten nimmt nur niedrige s.
const HALBES_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

export type RegisterVertrag = 'v7' | 'v8';

/**
 * Welche Unterschrift der Knoten verlangt (/api/status "register_vertrag").
 * Fehlt das Feld, ist es ein Knoten vor V8 und damit V7. Ein unbekannter
 * Wert ist kein Grund zu raten: dann wird nicht unterschrieben.
 */
export function registerVertrag(status: unknown): RegisterVertrag | null {
  if (!status || typeof status !== 'object') return null;
  const v = (status as Record<string, unknown>).register_vertrag;
  if (v === undefined || v === null) return 'v7';
  return v === 'v7' || v === 'v8' ? v : null;
}

/** salt = keccak256(netz_kennung), wie NETZ_SALT im Vertrag. */
export function netzSalt(kennung: string): string {
  if (!gueltigeKennung(kennung)) throw new Error('Netzkennung ungueltig');
  return ethers.keccak256(ethers.toUtf8Bytes(kennung));
}

export function registerV8Domain(kennung: string): ethers.TypedDataDomain {
  return {
    name: 'Aequitas',
    version: '8',
    chainId: CHAIN_ID_DEC,
    verifyingContract: V7_CONTRACT, // V8 liegt an der V7-Adresse
    salt: netzSalt(kennung),
  };
}

function feldwert(name: string, s: string): bigint {
  if (typeof s !== 'string' || !/^[0-9]{1,80}$/.test(s)) throw new Error(`${name}: keine Dezimalzahl`);
  const x = BigInt(s);
  if (x <= 0n || x >= FELD) throw new Error(`${name}: ausserhalb des Feldes`);
  return x;
}

export interface RegisterV8Nachricht {
  human: string;
  commitment: bigint;
  nullifier: bigint;
  nonce: bigint;
  deadline: bigint;
}

/**
 * Baut die Nachricht aus den oeffentlichen Signalen des Beweises. Die Nonce
 * ist immer 0: V8 kennt keinen Weg, eine Registrierung zurueckzunehmen, und
 * der Knoten prueft beim Nachspielen genau Nonce 0.
 */
export function registerV8Nachricht(human: string, pubSignals: readonly string[], deadline: number): RegisterV8Nachricht {
  if (!ethers.isAddress(human)) throw new Error('Wallet ungueltig');
  if (!Array.isArray(pubSignals) || pubSignals.length < 2) throw new Error('oeffentliche Signale fehlen');
  if (!Number.isSafeInteger(deadline) || deadline <= 0) throw new Error('Frist ungueltig');
  return {
    human: ethers.getAddress(human),
    commitment: feldwert('commitment', pubSignals[0]),
    nullifier: feldwert('nullifier', pubSignals[1]),
    nonce: 0n,
    deadline: BigInt(deadline),
  };
}

/** Frist ab jetzt (Unix-Sekunden). */
export function registerV8Frist(jetztMs: number = Date.now()): number {
  return Math.floor(jetztMs / 1000) + FRIST_S;
}

export function registerV8Digest(kennung: string, n: RegisterV8Nachricht): string {
  return ethers.TypedDataEncoder.hash(registerV8Domain(kennung), REGISTER_V8_TYPES as any, n as any);
}

/**
 * Bringt eine Unterschrift in die Form, die Vertrag und Knoten verlangen
 * (65 Byte, v 27/28, niedriges s), und prueft, dass sie von `human` ueber
 * GENAU diese Nachricht stammt. Eine fremde Wallet (WalletConnect) kann v als
 * 0/1 liefern -- das wird angeglichen. Alles andere schliesst ab: hohes s,
 * falscher Unterzeichner, falsche Laenge.
 */
export function registerV8Signatur(kennung: string, n: RegisterV8Nachricht, roh: string): string {
  if (typeof roh !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(roh)) throw new Error('Signatur muss 65 Byte haben');
  const bytes = ethers.getBytes(roh);
  if (bytes[64] === 0 || bytes[64] === 1) bytes[64] += 27;
  if (bytes[64] !== 27 && bytes[64] !== 28) throw new Error('Signatur: v ungueltig');
  const s = BigInt(ethers.hexlify(bytes.slice(32, 64)));
  const r = BigInt(ethers.hexlify(bytes.slice(0, 32)));
  if (r === 0n || s === 0n || s > HALBES_N) throw new Error('Signatur: r/s ungueltig oder hohes s');
  const sig = ethers.hexlify(bytes);
  const signer = ethers.recoverAddress(registerV8Digest(kennung, n), sig);
  if (signer !== n.human) throw new Error('Signatur stammt nicht von dieser Wallet');
  return sig;
}

/** Was die Wallet per eth_signTypedData_v4 / Wallet.signTypedData unterschreibt. */
export function registerV8TypedData(kennung: string, n: RegisterV8Nachricht) {
  return {
    domain: registerV8Domain(kennung),
    types: REGISTER_V8_TYPES,
    message: n,
  };
}
