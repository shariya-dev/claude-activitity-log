import { describe, expect, it } from 'vitest';
import { execFileRun } from '../../../../src/platform/darwin/exec.js';

describe('execFileRun', () => {
  it('feeds input on stdin and returns stdout with exit 0', async () => {
    await expect(execFileRun('/bin/cat', [], { input: 'secret-on-stdin' })).resolves.toEqual({
      code: 0,
      stdout: 'secret-on-stdin',
      stderr: '',
    });
  });

  it('resolves with the exit code instead of rejecting', async () => {
    const res = await execFileRun('/bin/sh', ['-c', 'echo oops >&2; exit 44']);
    expect(res).toEqual({ code: 44, stdout: '', stderr: 'oops\n' });
  });

  it('survives a child that exits without reading its stdin', async () => {
    const res = await execFileRun('/bin/sh', ['-c', 'exit 3'], { input: 'x'.repeat(1 << 20) });
    expect(res.code).toBe(3);
  });

  it('rejects when the binary cannot be spawned, without output in the message', async () => {
    await expect(execFileRun('/nonexistent/bin', [])).rejects.toThrow(
      '/nonexistent/bin could not run: ENOENT',
    );
  });
});
