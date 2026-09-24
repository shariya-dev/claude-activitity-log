import { describe, expect, it } from 'vitest';
import {
  appDataDir,
  claudeDataCandidates,
  claudeGlobalConfigCandidates,
  logDir,
} from '../../../../src/platform/win32/paths.js';

const home = 'C:\\Users\\Ана Ölçer';
const base = { homedir: () => 'C:\\fallback-home' };

describe('win32 paths', () => {
  it('orders Claude data candidates: CLAUDE_CONFIG_DIR, then %USERPROFILE%\\.claude', () => {
    const env = { CLAUDE_CONFIG_DIR: 'D:\\Claude Data\\cfg', USERPROFILE: home };
    expect(claudeDataCandidates({ ...base, env })).toEqual([
      'D:\\Claude Data\\cfg',
      `${home}\\.claude`,
    ]);
  });

  it('ignores an empty or blank CLAUDE_CONFIG_DIR', () => {
    for (const value of ['', '   ']) {
      const env = { CLAUDE_CONFIG_DIR: value, USERPROFILE: home };
      expect(claudeDataCandidates({ ...base, env })).toEqual([`${home}\\.claude`]);
    }
  });

  it('drops a CLAUDE_CONFIG_DIR that duplicates the default, case-insensitively', () => {
    const env = { CLAUDE_CONFIG_DIR: `${home.toUpperCase()}\\.CLAUDE\\`, USERPROFILE: home };
    expect(claudeDataCandidates({ ...base, env })).toEqual([`${home.toUpperCase()}\\.CLAUDE`]);
  });

  it('falls back to os.homedir() when USERPROFILE is missing', () => {
    expect(claudeDataCandidates({ ...base, env: {} })).toEqual(['C:\\fallback-home\\.claude']);
  });

  it('ignores a relative CLAUDE_CONFIG_DIR (the service cwd is not the shell cwd)', () => {
    const env = { CLAUDE_CONFIG_DIR: 'relative\\dir', USERPROFILE: home };
    expect(claudeDataCandidates({ ...base, env })).toEqual([`${home}\\.claude`]);
  });

  it('orders global config candidates: CLAUDE_CONFIG_DIR\\.claude.json, then home', () => {
    const env = { CLAUDE_CONFIG_DIR: 'D:\\cfg', USERPROFILE: home };
    expect(claudeGlobalConfigCandidates({ ...base, env })).toEqual([
      'D:\\cfg\\.claude.json',
      `${home}\\.claude.json`,
    ]);
    expect(claudeGlobalConfigCandidates({ ...base, env: { USERPROFILE: home } })).toEqual([
      `${home}\\.claude.json`,
    ]);
  });

  it('keeps app data and logs under %LOCALAPPDATA%\\6amAgent', () => {
    const env = { LOCALAPPDATA: `${home}\\AppData\\Local`, USERPROFILE: home };
    expect(appDataDir({ ...base, env })).toBe(`${home}\\AppData\\Local\\6amAgent`);
    expect(logDir({ ...base, env })).toBe(`${home}\\AppData\\Local\\6amAgent\\logs`);
  });

  it('derives %LOCALAPPDATA% from the profile when it is not set', () => {
    expect(appDataDir({ ...base, env: { USERPROFILE: home } })).toBe(
      `${home}\\AppData\\Local\\6amAgent`,
    );
  });
});
