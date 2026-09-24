import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  accountKey,
  lastSegment,
  normalizeGitRemote,
  projectKeyFromCwd,
  projectKeyFromRemote,
  sha256Hex,
} from '../../../src/core/detect/keys.js';

const ref = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it('returns lowercase 64-char hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('accountKey', () => {
  it('hashes the account uuid when present', () => {
    expect(accountKey('0b7c1a2e-4f3d-4a8b-9c1d-0000000000a1', 'dev@example.com')).toBe(
      'e07c7614a4539888af7664774a0d69b4ec1afc13cdf977d31040c6b58f61e15c',
    );
  });

  it('falls back to the lowercased email', () => {
    expect(accountKey(null, 'Dev@Example.com')).toBe(
      'eb2b6c0d061bbd5caa545b6d1184a1887b11dba0b1d7fd8ca5b42ebf0ad7d3a8',
    );
  });

  it('returns null with neither', () => {
    expect(accountKey(null, null)).toBeNull();
  });
});

describe('normalizeGitRemote', () => {
  it.each([
    ['ssh://git@host:22/org/repo', 'host/org/repo'],
    ['https://user:secret@GitHub.com/Example/acme-api.git', 'github.com/Example/acme-api'],
    ['git@github.com:example/acme-api.git', 'github.com/example/acme-api'],
    ['https://github.com/example/acme-api', 'github.com/example/acme-api'],
    ['https://github.com/example/acme-api/', 'github.com/example/acme-api'],
    ['https://github.com/example/acme-api.git/', 'github.com/example/acme-api'],
    ['http://Example.COM:8080/Org/Repo.git', 'example.com/Org/Repo'],
    ['git://host.example/org/repo.git', 'host.example/org/repo'],
    ['  git@GitLab.com:Group/Sub/Repo.git  \n', 'gitlab.com/Group/Sub/Repo'],
    ['ssh://token@host/org/repo', 'host/org/repo'],
    ['HTTPS://user@Host.io/a/b', 'host.io/a/b'],
    ['host.xz:org/repo.git', 'host.xz/org/repo'],
    ['ssh://git@[::1]:22/org/repo', '[::1]/org/repo'],
    ['git+ssh://git@host/org/repo.git', 'host/org/repo'],
    ['https://u:p@ss@host.com/org/repo', 'host.com/org/repo'],
    ['git@host:/abs/org/repo.git', 'host/abs/org/repo'],
    ['https://host.com//org/repo?x=1#frag', 'host.com/org/repo'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeGitRemote(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['/srv/repo.git'],
    ['../repo'],
    ['./repo'],
    ['repo'],
    ['file:///srv/repo.git'],
    ['C:\\repos\\thing.git'],
    ['C:/repos/thing.git'],
    ['https://github.com'],
    ['https://github.com/'],
    ['https://github.com/.git'],
    ['git@github.com:'],
    ['https:///org/repo'],
    ['https://user:pw@/org/repo'],
    ['FILE:///srv/repo'],
    ['https://u:p/w@host/x'],
    ['https://host:abc/org/repo'],
    ['ssh://git@[::1/org/repo'],
  ])('%j -> null', (input) => {
    expect(normalizeGitRemote(input)).toBeNull();
  });

  it('never keeps credentials', () => {
    const out = normalizeGitRemote('https://alice:hunter2@github.com/org/repo.git');
    expect(out).toBe('github.com/org/repo');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('alice');
  });
});

describe('project keys', () => {
  it('derives from the normalized remote', () => {
    expect(projectKeyFromRemote('github.com/example/acme-api')).toBe(
      ref('github.com/example/acme-api'),
    );
  });

  it('derives from device uid + newline + cwd (contract example)', () => {
    const key = projectKeyFromCwd('dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W', '/home/dev/work/acme-api');
    expect(key.startsWith('d653e136')).toBe(true);
    expect(key.endsWith('fe95c')).toBe(true);
    expect(key).toBe(ref('dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W\n/home/dev/work/acme-api'));
  });
});

describe('lastSegment', () => {
  it.each([
    ['/home/dev/demo-app/', 'demo-app'],
    ['/home/dev/demo-app', 'demo-app'],
    ['C:\\Users\\x\\proj', 'proj'],
    ['C:\\Users\\x\\proj\\', 'proj'],
    ['github.com/example/acme-api', 'acme-api'],
    ['mixed/path\\leaf', 'leaf'],
    ['single', 'single'],
    ['/', '/'],
    ['', ''],
    ['\\\\', '\\\\'],
  ])('%j -> %j', (input, expected) => {
    expect(lastSegment(input)).toBe(expected);
  });
});
