import { deviceLocale, translate } from '../index';
import de from '../locales/de';
import en from '../locales/en';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'fr' }] }));

function schluessel(o: object, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'string' ? [p + k] : 'other' in (v as object) ? [p + k] : schluessel(v as object, `${p}${k}.`),
  );
}

describe('i18n', () => {
  it('Englisch ist vollstaendig (gleiche Schluessel wie Deutsch)', () => {
    expect(schluessel(en).sort()).toEqual(schluessel(de).sort());
  });
  it('ersetzt ALLE Vorkommen eines Platzhalters', () => {
    expect(translate('de', 'errors.rejected.message', { reason: 'a {reason}' })).toBe('a {reason}');
  });
  it('faellt fuer fehlende Sprachen auf Englisch zurueck', () => {
    expect(translate('fr', 'common.retry')).toBe('Try again');
  });
  it('waehlt die Pluralform', () => {
    expect(translate('de', 'time.minutesAgo', { count: 1 })).toBe('vor 1 Minute');
    expect(translate('de', 'time.minutesAgo', { count: 5 })).toBe('vor 5 Minuten');
  });
  it('fehlender Schluessel ist auffaellig, nicht still', () => {
    expect(translate('de', 'gibt.es.nicht' as never)).toBe('⟦gibt.es.nicht⟧');
  });
  it('startet in der Geraetesprache', () => {
    expect(deviceLocale()).toBe('fr');
  });
});
