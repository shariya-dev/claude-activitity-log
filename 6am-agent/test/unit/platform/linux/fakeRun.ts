import type { CommandResult, RunCommand } from '../../../../src/platform/linux/exec.js';

export interface RecordedCall {
  cmd: string;
  args: string[];
  input: string | undefined;
  env?: Record<string, string>;
}

export type Responder = (call: RecordedCall) => Partial<CommandResult> | undefined;

export function fakeRun(responder: Responder = () => undefined): {
  run: RunCommand;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const run: RunCommand = async (cmd, args, opts) => {
    const call: RecordedCall = { cmd, args: [...args], input: opts?.input };
    if (opts?.env) {
      call.env = opts.env;
    }
    calls.push(call);
    return { code: 0, stdout: '', stderr: '', ...responder(call) };
  };

  return { run, calls };
}
