import path from 'node:path';
import type { CommandRunner, RunOptions, RunResult } from '../../../../src/platform/win32/exec.js';
import type { Win32FileOps } from '../../../../src/platform/win32/fileOps.js';

export interface RecordedCall {
  file: string;
  args: readonly string[];
  opts: RunOptions | undefined;
}

type Responder = (call: RecordedCall) => Partial<RunResult> | Error;

/** Scripted `CommandRunner`: the first responder whose predicate matches answers the call. */
export class FakeRunner {
  readonly calls: RecordedCall[] = [];
  private readonly rules: { match: (call: RecordedCall) => boolean; respond: Responder }[] = [];

  on(
    match: (call: RecordedCall) => boolean,
    respond: Responder | Partial<RunResult> | Error,
  ): this {
    this.rules.push({
      match,
      respond: typeof respond === 'function' ? respond : () => respond,
    });
    return this;
  }

  readonly run: CommandRunner = async (file, args, opts) => {
    const call = { file, args, opts };
    this.calls.push(call);
    const rule = this.rules.find((r) => r.match(call));
    const result = rule === undefined ? { code: 0 } : rule.respond(call);
    if (result instanceof Error) throw result;
    return { code: 0, stdout: '', stderr: '', ...result };
  };
}

export const isBinary = (name: string) => (call: RecordedCall) =>
  path.win32.basename(call.file).toLowerCase() === name.toLowerCase();

export const hasArgs =
  (name: string, ...args: string[]) =>
  (call: RecordedCall) =>
    isBinary(name)(call) && args.every((a) => call.args.includes(a));

function fsError(code: string, p: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: ${p}`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

/** In-memory Windows filesystem keyed by case-insensitive win32 paths. */
export class MemoryFileOps implements Win32FileOps {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  readonly denied = new Set<string>();

  private key(p: string): string {
    return path.win32.normalize(p).toLowerCase();
  }

  addDir(p: string): void {
    let current = path.win32.normalize(p);
    while (!this.dirs.has(this.key(current))) {
      this.dirs.add(this.key(current));
      const parent = path.win32.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  addFile(p: string, data: string | Uint8Array): void {
    this.addDir(path.win32.dirname(p));
    this.files.set(
      this.key(p),
      typeof data === 'string' ? new TextEncoder().encode(data) : Uint8Array.from(data),
    );
  }

  read(p: string): Uint8Array | undefined {
    return this.files.get(this.key(p));
  }

  readText(p: string): string | undefined {
    const data = this.read(p);
    return data === undefined ? undefined : new TextDecoder().decode(data);
  }

  private guard(p: string): void {
    if (this.denied.has(this.key(p))) throw fsError('EPERM', p);
  }

  async mkdir(p: string): Promise<void> {
    this.guard(p);
    this.addDir(p);
  }

  async readFile(p: string): Promise<Uint8Array> {
    this.guard(p);
    const data = this.read(p);
    if (data === undefined) throw fsError('ENOENT', p);
    return data;
  }

  async writeFile(p: string, data: string | Uint8Array): Promise<void> {
    this.guard(p);
    if (!this.dirs.has(this.key(path.win32.dirname(p)))) throw fsError('ENOENT', p);
    this.addFile(p, data);
  }

  async rename(from: string, to: string): Promise<void> {
    const data = await this.readFile(from);
    this.files.delete(this.key(from));
    await this.writeFile(to, data);
  }

  async rm(p: string): Promise<void> {
    this.guard(p);
    this.files.delete(this.key(p));
  }

  async isDirectory(p: string): Promise<boolean> {
    this.guard(p);
    if (this.dirs.has(this.key(p))) return true;
    if (this.files.has(this.key(p))) return false;
    throw fsError('ENOENT', p);
  }

  async probeRead(p: string): Promise<void> {
    await this.isDirectory(p);
  }
}
