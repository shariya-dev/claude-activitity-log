/**
 * Stable, opaque keys the backend dedups on (sync-api-v1 §4.1, §4.2). Pure functions; the
 * callers decide which category gates apply before calling them.
 */
import { createHash } from 'node:crypto';

/** sha256 of the UTF-8 bytes, lowercase hex. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** sha256(accountUuid), else sha256(lowercased email), else null (no account). */
export function accountKey(accountUuid: string | null, email: string | null): string | null {
  if (accountUuid) return sha256Hex(accountUuid);
  if (email) return sha256Hex(email.toLowerCase());
  return null;
}

const SCHEME_URL = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/s;
// scp-like `[user@]host:path`. No slash may come before the colon.
const SCP_LIKE = /^(?:[^@/]*@)?([^@/:]+):(.*)$/s;
const DRIVE_LETTER = /^[A-Za-z]$/;

/**
 * Normalizes a git remote per sync-api-v1 §4.2: drops scheme, userinfo, port, a trailing `/`
 * and a trailing `.git`; rewrites scp-style to `host/path`; lowercases the host only.
 * Returns null for local paths, `file://` and anything without both a host and a path, so
 * credentials can never survive into the result.
 */
export function normalizeGitRemote(url: string): string | null {
  const input = url.trim();
  let host: string;
  let rawPath: string;

  const scheme = SCHEME_URL.exec(input);
  if (scheme) {
    if (scheme[1]!.toLowerCase() === 'file') return null;
    const rest = scheme[2]!;
    const authorityEnd = rest.search(/[/?#]/);
    const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
    rawPath = authorityEnd === -1 ? '' : rest.slice(authorityEnd);
    const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
    const parsed = splitHostPort(hostPort);
    if (parsed === null) return null;
    host = parsed;
    rawPath = rawPath.replace(/[?#].*$/s, '');
  } else {
    const scp = SCP_LIKE.exec(input);
    if (!scp || DRIVE_LETTER.test(scp[1]!)) return null;
    host = scp[1]!;
    rawPath = scp[2]!;
  }

  if (host === '') return null;
  let path = rawPath.replace(/^\/+/, '');
  if (path.endsWith('/')) path = path.slice(0, -1);
  if (path.endsWith('.git')) path = path.slice(0, -4);
  path = path.replace(/\/+$/, '');
  if (path === '') return null;
  return `${host.toLowerCase()}/${path}`;
}

/** `host[:port]` or `[v6][:port]` → host; null when the port is not numeric (a mangled URL). */
function splitHostPort(hostPort: string): string | null {
  let host = hostPort;
  let port = '';
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    if (close === -1) return null;
    host = hostPort.slice(0, close + 1);
    port = hostPort.slice(close + 1);
  } else {
    const colon = hostPort.indexOf(':');
    if (colon !== -1) {
      host = hostPort.slice(0, colon);
      port = hostPort.slice(colon);
    }
  }
  if (port !== '' && !/^:\d*$/.test(port)) return null;
  return host;
}

/** D13: Git ON and the repo has a remote. */
export function projectKeyFromRemote(normalizedRemote: string): string {
  return sha256Hex(normalizedRemote);
}

/** D13 otherwise: sha256(device_id + "\n" + absolute_cwd). */
export function projectKeyFromCwd(deviceUid: string, cwd: string): string {
  return sha256Hex(`${deviceUid}\n${cwd}`);
}

/** Last non-empty segment, splitting on `/` and `\` whatever the OS; the input if none. */
export function lastSegment(pathOrRemote: string): string {
  const segments = pathOrRemote.split(/[/\\]/).filter((s) => s !== '');
  return segments.length > 0 ? segments[segments.length - 1]! : pathOrRemote;
}
