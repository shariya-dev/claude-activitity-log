/**
 * Reads the raw `origin` URL from `<cwd>/.git/config`. Only called when the Git category is
 * ON (CLAUDE.md invariant 8). One read, no retries, never throws; the caller normalizes.
 */
import { join } from 'node:path';
import { type FsLike, nodeFs } from './fs.js';

const SECTION = /^\[\s*([^\s\]"]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/;
const KEY_VALUE = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=(.*))?$/;

export async function readOriginRemote(cwd: string, fs: FsLike = nodeFs): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(join(cwd, '.git', 'config'), 'utf8');
  } catch {
    return null;
  }
  return parseOriginUrl(text);
}

function parseOriginUrl(text: string): string | null {
  let inOrigin = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const section = SECTION.exec(line);
    if (section) {
      inOrigin = section[1]!.toLowerCase() === 'remote' && section[2] === 'origin';
      continue;
    }
    if (!inOrigin) continue;
    const kv = KEY_VALUE.exec(line);
    if (!kv || kv[1]!.toLowerCase() !== 'url') continue;
    const value = parseValue(kv[2] ?? '');
    return value === '' ? null : value;
  }
  return null;
}

/** Strips an unquoted `;`/`#` comment and double quotes, then trims. */
function parseValue(raw: string): string {
  let out = '';
  let quoted = false;
  for (const ch of raw) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (ch === ';' || ch === '#')) break;
    out += ch;
  }
  return out.trim();
}
