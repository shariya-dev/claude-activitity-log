/**
 * DPAPI (CurrentUser scope) credential store. The plaintext reaches PowerShell only as base64 on
 * stdin, never in argv or the environment. The ciphertext is stored as base64 in
 * %LOCALAPPDATA%\6amAgent\cred\<key>.bin, whose ACL is inherited from the user profile.
 */
import path from 'node:path';
import type { CredentialStore } from '../types.js';
import type { CommandRunner } from './exec.js';
import type { Win32FileOps } from './fileOps.js';
import { PS_PRELUDE, powershellErrorText, runPowerShell } from './powershell.js';

export { decodePowerShellCommand } from './powershell.js';

export interface DpapiDeps {
  run: CommandRunner;
  env: NodeJS.ProcessEnv;
  files: Win32FileOps;
  appDataDir: string;
}

// stdin: base64 of the input bytes · stdout: base64 of the output bytes. Base64 keeps the
// pipe ASCII, so the console code page cannot corrupt non-ASCII secrets.
function dpapiScript(method: 'Protect' | 'Unprotect'): string {
  return [
    PS_PRELUDE,
    'Add-Type -AssemblyName System.Security;',
    '$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());',
    `$out = [Security.Cryptography.ProtectedData]::${method}($data, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser);`,
    '[Console]::Out.Write([Convert]::ToBase64String($out));',
  ].join(' ');
}

const PROTECT_SCRIPT = dpapiScript('Protect');
const UNPROTECT_SCRIPT = dpapiScript('Unprotect');

// Empty output is valid: unprotecting an empty secret yields no bytes.
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function assertKey(key: string): void {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/.test(key) || RESERVED_NAMES.test(key)) {
    throw new Error(`Invalid credential key: ${JSON.stringify(key)}`);
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

export class DpapiCredentialStore implements CredentialStore {
  readonly backend = 'dpapi';
  private readonly dir: string;

  constructor(private readonly deps: DpapiDeps) {
    this.dir = path.win32.join(deps.appDataDir, 'cred');
  }

  private file(key: string): string {
    assertKey(key);
    return path.win32.join(this.dir, `${key}.bin`);
  }

  private async transform(script: string, inputBase64: string, what: string): Promise<string> {
    const result = await runPowerShell(this.deps.run, this.deps.env, script, inputBase64);
    const output = result.stdout.trim();
    if (result.code !== 0 || !BASE64.test(output)) {
      // stderr only: stdout may hold (partial) secret material.
      const reason = result.code !== 0 ? powershellErrorText(result.stderr) : 'bad output';
      throw new Error(`DPAPI ${what} failed: ${reason}`);
    }
    return output;
  }

  async get(key: string): Promise<string | null> {
    const file = this.file(key);
    let ciphertext: string;
    try {
      ciphertext = Buffer.from(await this.deps.files.readFile(file))
        .toString('utf8')
        .trim();
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    const plain = await this.transform(UNPROTECT_SCRIPT, ciphertext, 'unprotect');
    return Buffer.from(plain, 'base64').toString('utf8');
  }

  async set(key: string, value: string): Promise<void> {
    const file = this.file(key);
    const ciphertext = await this.transform(
      PROTECT_SCRIPT,
      Buffer.from(value, 'utf8').toString('base64'),
      'protect',
    );
    await this.deps.files.mkdir(this.dir);
    const temp = `${file}.tmp`;
    await this.deps.files.writeFile(temp, ciphertext);
    await this.deps.files.rename(temp, file);
  }

  async delete(key: string): Promise<void> {
    await this.deps.files.rm(this.file(key));
  }
}
