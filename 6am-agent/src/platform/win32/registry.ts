import { type CommandRunner, firstErrorLine, system32 } from './exec.js';

/**
 * Parses `reg.exe query` output. Value lines look like `    Name    REG_SZ    data`; the type
 * tokens are not localised. Key header lines and blank lines are skipped.
 */
export function parseRegQuery(stdout: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^ {2,}(\S(?:.*?\S)?) {2,}(REG_[A-Z0-9_]+)(?: {2,}(.*))?$/.exec(line);
    if (match === null) continue;
    const [, name, , data] = match;
    if (name !== undefined) values.set(name, (data ?? '').trim());
  }
  return values;
}

/**
 * Reads values from the 64-bit registry view (`/reg:64`), so a 32-bit runtime would still see
 * `MachineGuid`. With `valueName`, only that value is queried.
 */
export async function queryRegistry(
  run: CommandRunner,
  env: NodeJS.ProcessEnv,
  key: string,
  valueName?: string,
): Promise<Map<string, string>> {
  const args = ['query', key, ...(valueName === undefined ? [] : ['/v', valueName]), '/reg:64'];
  const result = await run(system32(env, 'reg.exe'), args);
  if (result.code !== 0) {
    const what = valueName === undefined ? key : `${key} /v ${valueName}`;
    throw new Error(`reg.exe query ${what} failed: ${firstErrorLine(result)}`);
  }
  return parseRegQuery(result.stdout);
}
