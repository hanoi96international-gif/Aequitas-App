// Missbrauch/Fehlerfall (Beta-Pruefung 14.10.2026): ein unbekannter fataler
// Fehler darf nicht verschluckt werden.
describe('globalErrorHandler', () => {
  let installiert: ((e: unknown, f?: boolean) => void) | undefined;
  const vorher = jest.fn();
  beforeEach(() => {
    jest.resetModules();
    vorher.mockReset();
    (globalThis as any).ErrorUtils = {
      getGlobalHandler: () => vorher,
      setGlobalHandler: (h: (e: unknown, f?: boolean) => void) => { installiert = h; },
    };
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.isolateModules(() => { require('../globalErrorHandler'); });
  });
  afterEach(() => { delete (globalThis as any).ErrorUtils; jest.restoreAllMocks(); });

  it('reicht einen unbekannten fatalen Fehler an den Standard-Handler weiter', () => {
    const e = new TypeError('Cannot read property balance of undefined');
    installiert!(e, true);
    expect(vorher).toHaveBeenCalledWith(e, true);
  });

  it('faengt nur den bekannten WalletConnect-Fehler ab', () => {
    const e = new TypeError('Cannot convert undefined value to object');
    e.stack = 'at Subscriber.init (node_modules/@walletconnect/core/dist/index.js:1)';
    installiert!(e, true);
    expect(vorher).not.toHaveBeenCalled();
  });

  it('nicht-fatale Fehler gehen wie bisher weiter', () => {
    const e = new Error('x');
    installiert!(e, false);
    expect(vorher).toHaveBeenCalledWith(e, false);
  });
});
