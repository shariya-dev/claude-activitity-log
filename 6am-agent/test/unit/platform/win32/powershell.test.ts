import { describe, expect, it } from 'vitest';
import {
  decodePowerShellCommand,
  powershellArgs,
  powershellErrorText,
} from '../../../../src/platform/win32/powershell.js';

describe('powershellArgs', () => {
  it('passes the script only as -EncodedCommand, without loading a profile', () => {
    const args = powershellArgs('Write-Output \'Zoë & "x"\'');
    expect(args.slice(0, 4)).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
    ]);
    expect(args).toHaveLength(5);
    expect(decodePowerShellCommand(args)).toBe('Write-Output \'Zoë & "x"\'');
  });
});

describe('powershellErrorText', () => {
  it('extracts the error text from CLIXML stderr (captured from a real PowerShell run)', () => {
    const stderr =
      '#< CLIXML\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
      '<S S="Error">_x001B_[31;1mParentContainsErrorRecordException: _x001B_[31;1mException calling ' +
      '"Protect" with "3" argument(s): "Operation is not supported on this platform."_x001B_[0m_x000A_</S>' +
      '<S S="Error">second &amp; line_x000D__x000A_</S></Objs>';
    expect(powershellErrorText(stderr)).toBe(
      'ParentContainsErrorRecordException: Exception calling "Protect" with "3" argument(s): ' +
        '"Operation is not supported on this platform." second & line',
    );
  });

  it('returns plain stderr trimmed, and a placeholder when empty', () => {
    expect(powershellErrorText('  boom\r\n')).toBe('boom');
    expect(powershellErrorText('')).toBe('no error output');
  });
});
