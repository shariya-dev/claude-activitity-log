import { describe, expect, it } from 'vitest';
import {
  appDataDir,
  claudeDataCandidates,
  claudeGlobalConfigCandidates,
  configHome,
} from '../../../../src/platform/linux/paths.js';

const home = '/home/dev';

describe('linux paths', () => {
  it('orders Claude data candidates: CLAUDE_CONFIG_DIR, ~/.claude, XDG, ~/.config/claude', () => {
    const env = { CLAUDE_CONFIG_DIR: '/data/claude', XDG_CONFIG_HOME: '/xdg' };

    expect(claudeDataCandidates({ env, homedir: home })).toEqual([
      '/data/claude',
      '/home/dev/.claude',
      '/xdg/claude',
      '/home/dev/.config/claude',
    ]);
  });

  it('skips unset, empty and relative env values and removes duplicates', () => {
    expect(claudeDataCandidates({ env: { CLAUDE_CONFIG_DIR: '' }, homedir: home })).toEqual([
      '/home/dev/.claude',
      '/home/dev/.config/claude',
    ]);
    expect(
      claudeDataCandidates({ env: { XDG_CONFIG_HOME: 'relative/xdg' }, homedir: home }),
    ).toEqual(['/home/dev/.claude', '/home/dev/.config/claude']);
    expect(
      claudeDataCandidates({
        env: { CLAUDE_CONFIG_DIR: '/home/dev/.claude', XDG_CONFIG_HOME: '/home/dev/.config' },
        homedir: home,
      }),
    ).toEqual(['/home/dev/.claude', '/home/dev/.config/claude']);
  });

  it('lists the global config inside CLAUDE_CONFIG_DIR first, then ~/.claude.json', () => {
    expect(
      claudeGlobalConfigCandidates({ env: { CLAUDE_CONFIG_DIR: '/data/claude' }, homedir: home }),
    ).toEqual(['/data/claude/.claude.json', '/home/dev/.claude.json']);
    expect(claudeGlobalConfigCandidates({ env: {}, homedir: home })).toEqual([
      '/home/dev/.claude.json',
    ]);
  });

  it('keeps app data under XDG_STATE_HOME, defaulting to ~/.local/state', () => {
    expect(appDataDir({ env: { XDG_STATE_HOME: '/state' }, homedir: home })).toBe(
      '/state/6am-agent',
    );
    expect(appDataDir({ env: {}, homedir: home })).toBe('/home/dev/.local/state/6am-agent');
  });

  it('resolves the config home from XDG_CONFIG_HOME, defaulting to ~/.config', () => {
    expect(configHome({ env: { XDG_CONFIG_HOME: '/xdg' }, homedir: home })).toBe('/xdg');
    expect(configHome({ env: {}, homedir: home })).toBe('/home/dev/.config');
  });
});
