/**
 * umzugGrundSchluessel: Ablehnungen der Kette (umzug.go, "rejected: <regel>:
 * <text>") werden verstaendliche Texte in der Sprache des Menschen; Unbekanntes
 * bleibt, wie es kam. Die Regel muss als ganzes Wort vorkommen.
 */
import { umzugGrundSchluessel } from '../umzug';

describe('umzugGrundSchluessel', () => {
  it.each([
    ['rejected: umzug_code: 0xabcd…1234: Wiederherstellungscode passt nicht', 'umzug.codeFalsch'],
    ['rejected: umzug_code_fest: 0xabcd…1234: hat schon einen Wiederherstellungscode, er ist nicht aenderbar', 'umzug.codeEinmal'],
    ['rejected: umzug_pruefung: 0xabcd…1234: ohne Code nur nach strenger Pruefung', 'umzug.nurMitCode'],
    ['rejected: umzug_offen: fuer diesen Menschen ist schon ein Umzug offen', 'umzug.grundOffen'],
    ['rejected: umzug_jahresgrenze: schon 2 Umzuege in 365 Tagen', 'umzug.grundJahr'],
    ['rejected: umzug_zeit: 0xabcd…1234: bescheinigt 1, Block 2', 'umzug.grundAbgelaufen'],
    ['rejected: umzug_bescheinigung: 0xabcd…: bescheinigung: abgelaufen', 'umzug.grundAbgelaufen'],
    ['rejected: umzug_fest: dieser Umzug ist nicht mehr widerrufbar', 'umzug.grundFest'],
    ['rejected: umzug_nicht_offen: kein passender offener Umzug', 'umzug.grundBeendet'],
    ['too many requests from this address', 'umzug.grundZuViele'],
  ])('%s', (meldung, schluessel) => {
    expect(umzugGrundSchluessel(meldung)).toBe(schluessel);
  });

  it.each([undefined, '', 'HTTP 502', 'internal error, please retry shortly', 'rejected: umzug_neu_unbekannt: x', 'rejected: umzug_codeX: x'])(
    'unbekannt bleibt: %s',
    (meldung) => {
      expect(umzugGrundSchluessel(meldung as any)).toBeNull();
    },
  );
});
