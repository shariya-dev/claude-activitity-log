import { describe, expect, it } from 'vitest';
import { checkPermissions } from '../../../../src/platform/win32/permissions.js';
import { MemoryFileOps } from './fakes.js';

describe('checkPermissions', () => {
  const claude = 'C:\\Users\\Zoë Smith\\.claude';

  it('reports readable paths without a hint', async () => {
    const files = new MemoryFileOps();
    files.addDir(`${claude}\\projects`);
    files.addFile('C:\\Users\\Zoë Smith\\.claude.json', '{}');
    expect(await checkPermissions([claude, 'C:\\Users\\Zoë Smith\\.claude.json'], files)).toEqual([
      { path: claude, readable: true },
      { path: 'C:\\Users\\Zoë Smith\\.claude.json', readable: true },
    ]);
  });

  it('gives a shell-neutral ACL hint naming the user when access is denied', async () => {
    const files = new MemoryFileOps();
    files.addDir(claude);
    files.denied.add(claude.toLowerCase());
    const [result] = await checkPermissions([claude], files, 'DEV-PC\\Zoë');
    expect(result?.readable).toBe(false);
    expect(result?.hint).toMatch(/Access denied/);
    expect(result?.hint).toContain(`icacls "${claude}" /grant "DEV-PC\\Zoë:(OI)(CI)RX"`);
    expect(result?.hint).not.toMatch(/%USERNAME%|\$env:/);
  });

  it('explains a missing path', async () => {
    const [result] = await checkPermissions(['D:\\nope'], new MemoryFileOps());
    expect(result).toEqual({
      path: 'D:\\nope',
      readable: false,
      hint: expect.stringMatching(/not found/i),
    });
  });

  it('never throws on unexpected errors', async () => {
    const files = new MemoryFileOps();
    files.isDirectory = async () => {
      throw new Error('weird');
    };
    const [result] = await checkPermissions(['C:\\x'], files);
    expect(result?.readable).toBe(false);
    expect(result?.hint).toContain('weird');
  });
});
