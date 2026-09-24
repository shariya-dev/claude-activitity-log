import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const OS_RELEASE_PATHS = ['/etc/os-release', '/usr/lib/os-release'];
export const MACHINE_ID_PATHS = ['/etc/machine-id', '/var/lib/dbus/machine-id'];

/** Parses os-release(5): KEY=VALUE lines with shell-style quoting. */
export function parseOsRelease(text: string): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());

    if (match?.[1] === undefined || match[2] === undefined) {
      continue;
    }

    fields[match[1]] = unquote(match[2]);
  }

  return fields;
}

function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }

  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\([\\"$`])/g, '$1');
  }

  return raw;
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

export async function platformVersion(o: {
  osReleasePaths: string[];
  kernelRelease: () => string;
}): Promise<string> {
  for (const file of o.osReleasePaths) {
    const text = await readOptional(file);

    if (text !== null) {
      const pretty = parseOsRelease(text).PRETTY_NAME;
      return pretty ? pretty : o.kernelRelease();
    }
  }

  return o.kernelRelease();
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * sha256 of /etc/machine-id (or the dbus copy). Minimal containers ship without one, so as a
 * last resort a random id is persisted (0600) in the app data dir and reused.
 */
export async function machineFingerprint(o: {
  machineIdPaths: string[];
  fallbackIdPath: string;
}): Promise<string> {
  for (const file of o.machineIdPaths) {
    const id = (await readOptional(file))?.trim();

    if (id && id !== 'uninitialized') {
      return sha256(id);
    }
  }

  const persisted = (await readOptional(o.fallbackIdPath))?.trim();

  if (persisted) {
    return sha256(persisted);
  }

  // Write a temp file, then link() it into place: creation is atomic and never overwrites, so
  // concurrent first runs (pair + service) agree on whichever id landed first.
  const id = randomUUID().replaceAll('-', '');
  const tmp = `${o.fallbackIdPath}.${id}.tmp`;
  await mkdir(path.dirname(o.fallbackIdPath), { recursive: true, mode: 0o700 });
  await writeFile(tmp, `${id}\n`, { mode: 0o600, flag: 'wx' });

  try {
    await link(tmp, o.fallbackIdPath);
    return sha256(id);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
    return sha256((await readFile(o.fallbackIdPath, 'utf8')).trim());
  } finally {
    await rm(tmp, { force: true });
  }
}
