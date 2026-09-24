import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readAccount } from '../../../src/core/claude/accountReader.js';
import type { FsLike } from '../../../src/core/claude/fs.js';
import { AccountRecordSchema } from '../../../src/core/contract/index.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures/claude');
const OBSERVED = new Date('2026-09-24T10:00:00.000Z');

const expected = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, 'expected', name), 'utf8'));

function fakeFs(readFile: FsLike['readFile']): FsLike {
  const unused = () => Promise.reject(new Error('not used'));
  return { readdir: unused, stat: unused, open: unused, readFile };
}

const withContent = (content: string) => fakeFs(async () => content);
const withOauth = (oauthAccount: unknown) => withContent(JSON.stringify({ oauthAccount }));

describe('readAccount (fixtures)', () => {
  it('maps claude.json to expected/account.json', async () => {
    const rec = await readAccount(path.join(FIXTURES, 'claude.json'), OBSERVED);
    expect(rec).not.toBeNull();
    const { observed_at, ...rest } = rec!;
    expect(rest).toEqual(expected('account.json'));
    expect(observed_at).toBe('2026-09-24T10:00:00.000Z');
    expect(AccountRecordSchema.parse(rec)).toEqual(rec);
    expect(Object.keys(rec!).sort()).toEqual(
      [
        'account_key',
        'account_uuid',
        'display_name',
        'email',
        'observed_at',
        'organization_name',
        'organization_uuid',
      ].sort(),
    );
  });

  it('maps claude-email-only.json to expected/account-email-only.json', async () => {
    const rec = await readAccount(path.join(FIXTURES, 'claude-email-only.json'), OBSERVED);
    const { observed_at, ...rest } = rec!;
    expect(rest).toEqual(expected('account-email-only.json'));
    expect(observed_at).toBe(OBSERVED.toISOString());
    expect(AccountRecordSchema.safeParse(rec).success).toBe(true);
  });

  it('maps claude-no-account.json to expected/account-none.json (null)', async () => {
    const rec = await readAccount(path.join(FIXTURES, 'claude-no-account.json'), OBSERVED);
    expect(rec).toEqual(expected('account-none.json'));
    expect(rec).toBeNull();
  });

  it('returns null for a missing file', async () => {
    await expect(readAccount(path.join(FIXTURES, 'nope.json'), OBSERVED)).resolves.toBeNull();
  });
});

describe('readAccount (fake fs)', () => {
  it('returns null on read errors without retrying', async () => {
    const readFile = vi.fn<FsLike['readFile']>().mockRejectedValue(new Error('EACCES'));
    await expect(readAccount('/x/.claude.json', OBSERVED, fakeFs(readFile))).resolves.toBeNull();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith('/x/.claude.json', 'utf8');
  });

  it.each([
    ['invalid json', '{not json'],
    ['json null', 'null'],
    ['json array', '[]'],
    ['json string', '"x"'],
    ['oauthAccount null', '{"oauthAccount":null}'],
    ['oauthAccount string', '{"oauthAccount":"x"}'],
    ['oauthAccount array', '{"oauthAccount":["a"]}'],
    ['oauthAccount empty', '{"oauthAccount":{}}'],
  ])('returns null for %s', async (_name, content) => {
    await expect(readAccount('/c', OBSERVED, withContent(content))).resolves.toBeNull();
  });

  it('treats non-string, empty and over-long fields as null', async () => {
    const rec = await readAccount(
      '/c',
      OBSERVED,
      withOauth({
        accountUuid: 'u'.repeat(64),
        emailAddress: 42,
        displayName: '',
        organizationUuid: 'o'.repeat(65),
        organizationName: 'n'.repeat(192),
      }),
    );
    expect(rec).toEqual({
      account_key: expect.stringMatching(/^[0-9a-f]{64}$/),
      account_uuid: 'u'.repeat(64),
      email: null,
      display_name: null,
      organization_uuid: null,
      organization_name: null,
      observed_at: OBSERVED.toISOString(),
    });
    expect(AccountRecordSchema.safeParse(rec).success).toBe(true);
  });

  it('accepts fields exactly at the max length', async () => {
    const rec = await readAccount(
      '/c',
      OBSERVED,
      withOauth({
        emailAddress: 'e'.repeat(191),
        displayName: 'd'.repeat(191),
        organizationUuid: 'o'.repeat(64),
        organizationName: 'n'.repeat(191),
      }),
    );
    expect(rec?.email).toHaveLength(191);
    expect(rec?.display_name).toHaveLength(191);
    expect(rec?.organization_uuid).toHaveLength(64);
    expect(rec?.organization_name).toHaveLength(191);
    expect(AccountRecordSchema.safeParse(rec).success).toBe(true);
  });

  it('falls back to email when the uuid is over-long', async () => {
    const rec = await readAccount(
      '/c',
      OBSERVED,
      withOauth({ accountUuid: 'u'.repeat(65), emailAddress: 'A@B.c' }),
    );
    expect(rec?.account_uuid).toBeNull();
    expect(rec?.email).toBe('A@B.c');
  });

  it('returns null when neither uuid nor email is usable', async () => {
    const rec = await readAccount(
      '/c',
      OBSERVED,
      withOauth({ accountUuid: '', emailAddress: null, displayName: 'Dev', organizationName: 'O' }),
    );
    expect(rec).toBeNull();
  });

  it('never returns keys beyond the record fields', async () => {
    const rec = await readAccount(
      '/c',
      OBSERVED,
      withOauth({ accountUuid: 'u1', billingType: 'x', seatTier: 'y', fullName: 'F' }),
    );
    expect(JSON.stringify(rec)).not.toMatch(/billing|seatTier|fullName|"x"|"y"|"F"/);
  });
});
