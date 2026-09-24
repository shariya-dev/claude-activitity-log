import { describe, expect, it } from 'vitest';
import { createAdapter } from '../../../../src/platform/win32/index.js';
import { FakeRunner, MemoryFileOps } from './fakes.js';

describe('win32 createAdapter', () => {
  const env = {
    SystemRoot: 'C:\\Windows',
    USERPROFILE: 'C:\\Users\\Zoë Smith',
    LOCALAPPDATA: 'C:\\Users\\Zoë Smith\\AppData\\Local',
    CLAUDE_CONFIG_DIR: 'D:\\claude',
  };

  it('wires paths, credentials and service for the current user', () => {
    const adapter = createAdapter({
      env,
      homedir: () => 'C:\\ignored',
      run: new FakeRunner().run,
      files: new MemoryFileOps(),
    });
    expect(adapter.id).toBe('windows');
    expect(adapter.claudeDataCandidates()).toEqual(['D:\\claude', 'C:\\Users\\Zoë Smith\\.claude']);
    expect(adapter.claudeGlobalConfigCandidates()).toEqual([
      'D:\\claude\\.claude.json',
      'C:\\Users\\Zoë Smith\\.claude.json',
    ]);
    expect(adapter.appDataDir()).toBe('C:\\Users\\Zoë Smith\\AppData\\Local\\6amAgent');
    expect(adapter.logDir()).toBe('C:\\Users\\Zoë Smith\\AppData\\Local\\6amAgent\\logs');
    expect(adapter.credentials.backend).toBe('dpapi');
  });

  it('builds with real dependencies without spawning anything', () => {
    const adapter = createAdapter();
    expect(adapter.id).toBe('windows');
    expect(typeof adapter.service.install).toBe('function');
  });
});
