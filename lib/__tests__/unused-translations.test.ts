import fs from 'fs';
import path from 'path';
import en from '../i18n/locales/en';

// app/(tabs)/wallet.tsx's doSend() goes straight from input validation
// (isValidAddress/parseAEQToWei) to signer.sendTransaction() -- no
// Alert.alert or any other confirmation step in between showing the
// recipient address and amount before an irreversible on-chain transfer
// fires. Every other destructive/consequential action in this app DOES
// confirm first (see wallet.tsx's own confirmDisconnect(), which uses
// Alert.alert with wallet.removeWalletTitle/disconnectTitle before wiping a
// wallet or dropping a session).
//
// wallet.confirmSendTitle ("Confirm transaction") and wallet.confirmSendMsg
// ("Send {amount} AEQ to {address}?") exist as fully-formed keys in
// lib/i18n/types.ts and are translated into all 12 locales (grep confirms:
// en, de, es, fr, pt, ru, zh, ar, hi, id, it, tr all define both) -- clearly
// built for exactly this purpose -- but are never read by t() anywhere in
// app/ or components/. The confirmation step they were written for does not
// exist in the shipped send flow: tapping SEND fires the transfer straight
// away, with only regex-shape address validation (isValidAddress) between a
// typo and an irreversible transfer.
//
// This test currently FAILS. It is meant to: it proves these keys are dead
// (present in every locale, referenced nowhere), which is the fingerprint
// of a confirmation dialog that was built and then never wired in, not a
// deliberate design choice.
describe('wallet send-confirmation copy', () => {
  const APP_SOURCE = collectSourceFiles(path.join(__dirname, '../../app'))
    .concat(collectSourceFiles(path.join(__dirname, '../../components')))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

  function collectSourceFiles(dir: string): string[] {
    let out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out = out.concat(collectSourceFiles(full));
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it.each(['confirmSendTitle', 'confirmSendMsg'] as const)(
    "wallet.%s is actually used by some screen, not just translated",
    (key) => {
      expect(en.wallet[key]).toEqual(expect.any(String)); // sanity: the key exists
      expect(APP_SOURCE).toMatch(new RegExp(`wallet\\.${key}\\b`));
    }
  );
});
