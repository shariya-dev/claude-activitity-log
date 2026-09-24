import { describe, expect, it } from 'vitest';
import {
  appDataDir,
  claudeDataCandidates,
  claudeGlobalConfigCandidates,
  logDir,
} from '../../../../src/platform/darwin/paths.js';

const home = '/Users/dev';

describe('darwin paths', () => {
  it('lists ~/.claude then the XDG locations when CLAUDE_CONFIG_DIR is unset', () => {
    expect(claudeDataCandidates({}, home)).toEqual([
      '/Users/dev/.claude',
      '/Users/dev/.config/claude',
    ]);
  });

  it('puts CLAUDE_CONFIG_DIR first', () => {
    expect(claudeDataCandidates({ CLAUDE_CONFIG_DIR: '/opt/claude-cfg' }, home)).toEqual([
      '/opt/claude-cfg',
      '/Users/dev/.claude',
      '/Users/dev/.config/claude',
    ]);
  });

  it('ignores an empty CLAUDE_CONFIG_DIR and honours XDG_CONFIG_HOME', () => {
    expect(
      claudeDataCandidates({ CLAUDE_CONFIG_DIR: '', XDG_CONFIG_HOME: '/Users/dev/xdg' }, home),
    ).toEqual(['/Users/dev/.claude', '/Users/dev/xdg/claude', '/Users/dev/.config/claude']);
  });

  it('does not repeat a candidate', () => {
    expect(claudeDataCandidates({ CLAUDE_CONFIG_DIR: '/Users/dev/.claude/' }, home)).toEqual([
      '/Users/dev/.claude',
      '/Users/dev/.config/claude',
    ]);
  });

  it('global config candidates honour CLAUDE_CONFIG_DIR first', () => {
    expect(claudeGlobalConfigCandidates({}, home)).toEqual(['/Users/dev/.claude.json']);
    expect(claudeGlobalConfigCandidates({ CLAUDE_CONFIG_DIR: '/opt/c' }, home)).toEqual([
      '/opt/c/.claude.json',
      '/Users/dev/.claude.json',
    ]);
  });

  it('keeps app data and logs in the per-user Library', () => {
    expect(appDataDir(home)).toBe('/Users/dev/Library/Application Support/6amAgent');
    expect(logDir(home)).toBe('/Users/dev/Library/Logs/6amAgent');
  });
});
