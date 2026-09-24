/**
 * Reads the account from the global config's `oauthAccount` (claude-data-contract §9). Only
 * the five mapped fields are kept; every other key (billing, tiers, roles, …) is dropped
 * right after the parse. Missing file, invalid JSON or no usable account → null.
 */
import type { AccountRecord } from '../contract/index.js';
import { accountKey } from '../detect/keys.js';
import { type FsLike, nodeFs } from './fs.js';

export async function readAccount(
  globalConfigPath: string,
  observedAt: Date,
  fs: FsLike = nodeFs,
): Promise<AccountRecord | null> {
  let oauth: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(globalConfigPath, 'utf8'));
    const candidate = isRecord(parsed) ? parsed.oauthAccount : undefined;
    if (!isRecord(candidate)) return null;
    oauth = candidate;
  } catch {
    return null;
  }

  const account_uuid = str(oauth.accountUuid, 64);
  const email = str(oauth.emailAddress, 191);
  const account_key = accountKey(account_uuid, email);
  if (account_key === null) return null;

  return {
    account_key,
    account_uuid,
    email,
    display_name: str(oauth.displayName, 191),
    organization_uuid: str(oauth.organizationUuid, 64),
    organization_name: str(oauth.organizationName, 191),
    observed_at: observedAt.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string within the schema max length, else null. */
function str(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}
