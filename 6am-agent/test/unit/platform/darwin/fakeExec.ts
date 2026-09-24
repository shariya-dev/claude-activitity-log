import type { ExecFn, ExecResult } from '../../../../src/platform/darwin/exec.js';

export interface ExecCall {
  file: string;
  args: readonly string[];
  input: string | undefined;
}

type Responder = (call: ExecCall) => Partial<ExecResult> | undefined;

/** Records every call; the responder picks the result (default: exit 0, empty output). */
export function fakeExec(responder: Responder = () => undefined): ExecFn & { calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const fn = async (file: string, args: readonly string[], opts?: { input?: string }) => {
    const call = { file, args: [...args], input: opts?.input };
    calls.push(call);
    return { code: 0, stdout: '', stderr: '', ...responder(call) };
  };
  return Object.assign(fn, { calls });
}
