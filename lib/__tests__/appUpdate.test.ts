import { istNeuer, neuesteVersion, updateVerfuegbar, DOWNLOAD_URL } from '../appUpdate';
import { API_BASE, WEBAPP } from '../config';

function antwort(status: number, text: string) {
  return { ok: status >= 200 && status < 300, status, text: async () => text } as unknown as Response;
}

describe('istNeuer', () => {
  it('compares versions numerically', () => {
    expect(istNeuer('1.17.0', '1.16.0')).toBe(true);
    expect(istNeuer('1.10.0', '1.9.9')).toBe(true);
    expect(istNeuer('2.0.0', '1.99.99')).toBe(true);
    expect(istNeuer('1.16.0', '1.16.0')).toBe(false);
    expect(istNeuer('1.15.9', '1.16.0')).toBe(false);
  });
  it('is false for anything that is not a plain version', () => {
    for (const [a, b] of [['v1.17.0', '1.16.0'], ['1.17', '1.16.0'], ['1.17.0-rc1', '1.16.0'], ['', '1.0.0'], ['1.17.0', '']]) {
      expect(istNeuer(a, b)).toBe(false);
    }
  });
});

describe('neuesteVersion', () => {
  it('asks the own node, not GitHub', async () => {
    const f = jest.fn().mockResolvedValue(antwort(200, '{"version":"1.17.0"}'));
    expect(await neuesteVersion(f as any)).toBe('1.17.0');
    expect(f).toHaveBeenCalledWith(`${API_BASE}/app-version`);
    expect(DOWNLOAD_URL).toBe(`${WEBAPP}/download/app.apk`);
  });
  it('takes nothing but a plain version', async () => {
    for (const body of ['{"version":"<b>x</b>"}', '{"version":""}', '{}', 'kaputt', '{"version":"1.2.3","x":"' + 'a'.repeat(2000) + '"}']) {
      expect(await neuesteVersion(jest.fn().mockResolvedValue(antwort(200, body)) as any)).toBeNull();
    }
    expect(await neuesteVersion(jest.fn().mockResolvedValue(antwort(500, '')) as any)).toBeNull();
    expect(await neuesteVersion(jest.fn().mockRejectedValue(new Error('offline')) as any)).toBeNull();
  });
});

describe('updateVerfuegbar', () => {
  const f = (v: string) => jest.fn().mockResolvedValue(antwort(200, JSON.stringify({ version: v }))) as any;
  it('reports only a newer version', async () => {
    expect(await updateVerfuegbar(f('1.17.0'), '1.16.0')).toBe('1.17.0');
    expect(await updateVerfuegbar(f('1.16.0'), '1.16.0')).toBeNull();
    expect(await updateVerfuegbar(f('1.15.0'), '1.16.0')).toBeNull();
    expect(await updateVerfuegbar(f('1.17.0'), '')).toBeNull();
  });
});
