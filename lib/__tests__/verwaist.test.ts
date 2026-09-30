import { raeumeVerwaisteEinschreibungAuf, type AufraeumWerkzeuge } from '../verwaist';

function werkzeuge(teil: Partial<AufraeumWerkzeuge>): AufraeumWerkzeuge & { loesche: jest.Mock } {
  return {
    gespeicherteKennung: async () => '12345',
    pruefe: async () => ({ registered: false }),
    bioAus: (k) => k,
    loesche: jest.fn().mockResolvedValue({ status: 'deleted' }),
    ...teil,
  } as AufraeumWerkzeuge & { loesche: jest.Mock };
}

describe('raeumeVerwaisteEinschreibungAuf', () => {
  it('does nothing when this device never enrolled', async () => {
    const w = werkzeuge({ gespeicherteKennung: async () => null });
    expect(await raeumeVerwaisteEinschreibungAuf(w)).toBe('keine');
    expect(w.loesche).not.toHaveBeenCalled();
  });

  it('erases an enrolment the chain does not know (failed chain step)', async () => {
    const w = werkzeuge({});
    expect(await raeumeVerwaisteEinschreibungAuf(w)).toBe('geloescht');
    expect(w.loesche).toHaveBeenCalledWith('12345');
  });

  it('never erases an enrolment the chain knows as registered', async () => {
    const w = werkzeuge({ pruefe: async () => ({ registered: true }) });
    expect(await raeumeVerwaisteEinschreibungAuf(w)).toBe('registriert');
    expect(w.loesche).not.toHaveBeenCalled();
  });

  it('fails closed: an unreachable chain erases nothing', async () => {
    const w = werkzeuge({ pruefe: async () => { throw new Error('503'); } });
    expect(await raeumeVerwaisteEinschreibungAuf(w)).toBe('unklar');
    expect(w.loesche).not.toHaveBeenCalled();
  });

  it('fails closed: an answer without a clear yes/no erases nothing', async () => {
    const w = werkzeuge({ pruefe: async () => ({}) as { registered: boolean } });
    expect(await raeumeVerwaisteEinschreibungAuf(w)).toBe('unklar');
    expect(w.loesche).not.toHaveBeenCalled();
  });

  it('reports a failed erase as unclear instead of pretending success', async () => {
    const w = werkzeuge({ loesche: jest.fn().mockRejectedValue(new Error('500')) });
    expect(await raeumeVerwaisteEinschreibungAuf(w)).toBe('unklar');
  });

  it('treats not_found as done (nothing of this person is held any more)', async () => {
    const w = werkzeuge({ loesche: jest.fn().mockResolvedValue({ status: 'not_found' }) });
    expect(await raeumeVerwaisteEinschreibungAuf(w)).toBe('geloescht');
  });
});
