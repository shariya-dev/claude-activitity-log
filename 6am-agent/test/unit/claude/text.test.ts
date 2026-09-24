import { describe, expect, it } from 'vitest';
import { truncateUnits, wellFormed } from '../../../src/core/claude/text.js';

describe('text helpers', () => {
  it('replaces lone surrogates and keeps pairs', () => {
    expect(wellFormed('a\uD83Db\uDE00c😀')).toBe('a�b�c😀');
  });

  it('truncates without splitting a surrogate pair', () => {
    expect(truncateUnits('ab😀', 3)).toBe('ab');
    expect(truncateUnits('abc😀', 3)).toBe('abc');
    expect(truncateUnits('ab', 3)).toBe('ab');
  });
});
