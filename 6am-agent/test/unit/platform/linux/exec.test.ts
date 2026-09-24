import { describe, expect, it } from 'vitest';
import { runCommand } from '../../../../src/platform/linux/exec.js';

describe('runCommand', () => {
  it('passes input on stdin and captures stdout, stderr and the exit code', async () => {
    const result = await runCommand(
      process.execPath,
      [
        '-e',
        'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(s.toUpperCase());process.stderr.write("e");process.exit(3)})',
      ],
      { input: 'secret' },
    );

    expect(result).toEqual({ code: 3, stdout: 'SECRET', stderr: 'e' });
  });

  it('reports a missing binary as code null', async () => {
    const result = await runCommand('6am-agent-no-such-binary', []);

    expect(result.code).toBeNull();
    expect(result.stderr).toContain('ENOENT');
  });

  it('kills a command that exceeds the timeout', async () => {
    const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      timeoutMs: 200,
    });

    expect(result.code).toBeNull();
    expect(result.stderr).toContain('timed out');
  });

  it('adds env overrides on top of the inherited environment', async () => {
    const result = await runCommand(
      process.execPath,
      ['-e', 'process.stdout.write(`${process.env.XDG_RUNTIME_DIR}:${Boolean(process.env.PATH)}`)'],
      { env: { XDG_RUNTIME_DIR: '/run/user/1000' } },
    );

    expect(result.stdout).toBe('/run/user/1000:true');
  });
});
