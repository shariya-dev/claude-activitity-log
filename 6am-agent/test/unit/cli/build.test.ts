import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_TARGETS,
  archiveName,
  assembleTarget,
  ensureRuntime,
  fakeAdapterStubPlugin,
  hostTarget,
  parseArgs,
  parseShasums,
  resolveBuildConfig,
  resolveTargets,
  sha256File,
} from '../../../scripts/build.js';

const VERSION = 'v24.0.0';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'agent-build-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** A synthetic Node release archive for linux-x64 containing `<dir>/bin/node`. */
function makeLinuxArchive(): { archive: Buffer; name: string } {
  const name = archiveName('linux-x64', VERSION);
  const src = join(tmp, 'src');
  const dir = `node-${VERSION}-linux-x64`;
  mkdirSync(join(src, dir, 'bin'), { recursive: true });
  writeFileSync(join(src, dir, 'bin', 'node'), '#!/bin/sh\necho fake-node\n');
  writeFileSync(join(src, dir, 'README.md'), 'not extracted');
  const archivePath = join(tmp, name);
  execFileSync('tar', ['-czf', archivePath, '-C', src, dir]);
  return { archive: readFileSync(archivePath), name };
}

function fakeFetch(files: Record<string, Buffer | string>) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    const file = url.slice(url.lastIndexOf('/') + 1);
    const body = files[file];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: 200 });
  });
}

function fetchedFiles(fetchImpl: ReturnType<typeof fakeFetch>): string[] {
  return fetchImpl.mock.calls.map(([u]) => {
    const url = String(u);
    return url.slice(url.lastIndexOf('/') + 1);
  });
}

describe('archiveName', () => {
  it('names the official archive per OS', () => {
    expect(archiveName('darwin-arm64', 'v24.21.0')).toBe('node-v24.21.0-darwin-arm64.tar.gz');
    expect(archiveName('linux-x64', 'v24.21.0')).toBe('node-v24.21.0-linux-x64.tar.gz');
    expect(archiveName('win-x64', 'v24.21.0')).toBe('node-v24.21.0-win-x64.zip');
    expect(archiveName('win-arm64', 'v24.21.0')).toBe('node-v24.21.0-win-arm64.zip');
  });
});

describe('parseShasums', () => {
  it('maps file names to lowercase hex digests', () => {
    const a = 'a'.repeat(64);
    const b = 'B'.repeat(64);
    const text = `${a}  node-v24.21.0-linux-x64.tar.gz\n${b}  node-v24.21.0-win-x64.zip\n\ngarbage line\n`;
    const map = parseShasums(text);
    expect(map.get('node-v24.21.0-linux-x64.tar.gz')).toBe(a);
    expect(map.get('node-v24.21.0-win-x64.zip')).toBe('b'.repeat(64));
    expect(map.size).toBe(2);
  });
});

describe('resolveTargets / parseArgs', () => {
  it('--all gives the six targets', () => {
    expect(resolveTargets({ all: true })).toEqual([...ALL_TARGETS]);
    expect(ALL_TARGETS).toHaveLength(6);
  });

  it('accepts a known target and rejects an unknown one', () => {
    expect(resolveTargets({ target: 'win-arm64' })).toEqual(['win-arm64']);
    expect(() => resolveTargets({ target: 'solaris-sparc' })).toThrow(/unknown target/);
  });

  it('defaults to the host target', () => {
    expect(resolveTargets({}, { platform: 'win32', arch: 'x64' })).toEqual(['win-x64']);
    expect(hostTarget({ platform: 'darwin', arch: 'arm64' })).toBe('darwin-arm64');
    expect(hostTarget({ platform: 'linux', arch: 'x64' })).toBe('linux-x64');
    expect(() => hostTarget({ platform: 'aix', arch: 'ppc64' })).toThrow(/unsupported host/);
  });

  it('parses the CLI flags', () => {
    expect(
      parseArgs(['--target', 'linux-x64', '--config', 'c.json', '--node-version', 'v24.1.0']),
    ).toEqual({ target: 'linux-x64', all: false, config: 'c.json', nodeVersion: 'v24.1.0' });
    expect(parseArgs(['--all']).all).toBe(true);
    expect(parseArgs([]).nodeVersion).toBe('v24.21.0');
    expect(() => parseArgs(['--node-version', 'v22.1.0'])).toThrow(/v24/);
    expect(() => parseArgs(['--bogus'])).toThrow();
  });
});

describe('resolveBuildConfig', () => {
  it('uses the dev example when no --config is given', () => {
    const example = join(tmp, 'example.json');
    writeFileSync(example, JSON.stringify({ apiBaseUrl: 'http://127.0.0.1:8000', channel: 'dev' }));
    expect(resolveBuildConfig(undefined, example).channel).toBe('dev');
  });

  it('refuses a stable default without an explicit --config', () => {
    const example = join(tmp, 'example.json');
    writeFileSync(example, JSON.stringify({ apiBaseUrl: 'https://x.test', channel: 'stable' }));
    expect(() => resolveBuildConfig(undefined, example)).toThrow(/--config/);
  });

  it('validates an explicit config', () => {
    const cfg = join(tmp, 'cfg.json');
    writeFileSync(cfg, JSON.stringify({ apiBaseUrl: 'http://x.test', channel: 'stable' }));
    expect(() => resolveBuildConfig(cfg, 'unused')).toThrow(/https/);
    writeFileSync(cfg, JSON.stringify({ apiBaseUrl: 'https://x.test', channel: 'stable' }));
    expect(resolveBuildConfig(cfg, 'unused')).toEqual({
      apiBaseUrl: 'https://x.test',
      channel: 'stable',
    });
  });
});

describe('assembleTarget', () => {
  function inputs(): { bundlePath: string; runtimeBinaryPath: string; distDir: string } {
    const bundlePath = join(tmp, 'agent.cjs');
    writeFileSync(bundlePath, '"use strict";\n');
    const runtimeBinaryPath = join(tmp, 'node-bin');
    writeFileSync(runtimeBinaryPath, 'binary', { mode: 0o644 });
    return { bundlePath, runtimeBinaryPath, distDir: join(tmp, 'dist') };
  }
  const buildConfig = { apiBaseUrl: 'https://monitor.example.test', channel: 'stable' as const };

  it('writes exactly the linux-x64 layout', async () => {
    const { bundlePath, runtimeBinaryPath, distDir } = inputs();
    // Stale content from a previous build must be removed.
    mkdirSync(join(distDir, 'linux-x64', 'stale'), { recursive: true });
    writeFileSync(join(distDir, 'linux-x64', 'stale', 'old.txt'), 'x');

    const out = await assembleTarget({
      target: 'linux-x64',
      distDir,
      bundlePath,
      runtimeBinaryPath,
      buildConfig,
      version: '1.2.3',
    });

    const root = join(distDir, 'linux-x64');
    expect(listFiles(root)).toEqual([
      'VERSION',
      'app/agent.cjs',
      'app/build-config.json',
      'runtime/node',
    ]);
    expect(out.root).toBe(root);
    expect(out.runtime).toBe(join(root, 'runtime', 'node'));
    expect(readFileSync(join(root, 'VERSION'), 'utf8')).toBe('1.2.3\n');
    expect(readFileSync(join(root, 'app', 'agent.cjs'), 'utf8')).toBe('"use strict";\n');
    expect(JSON.parse(readFileSync(join(root, 'app', 'build-config.json'), 'utf8'))).toEqual(
      buildConfig,
    );
    if (process.platform !== 'win32') {
      expect(statSync(out.runtime).mode & 0o111).not.toBe(0);
    }
  });

  it('names the win runtime node.exe', async () => {
    const { bundlePath, runtimeBinaryPath, distDir } = inputs();
    await assembleTarget({
      target: 'win-x64',
      distDir,
      bundlePath,
      runtimeBinaryPath,
      buildConfig,
      version: '1.2.3',
    });
    expect(listFiles(join(distDir, 'win-x64'))).toEqual([
      'VERSION',
      'app/agent.cjs',
      'app/build-config.json',
      'runtime/node.exe',
    ]);
  });
});

describe('sha256File', () => {
  it('hashes a file', async () => {
    const f = join(tmp, 'f');
    writeFileSync(f, 'hello');
    expect(await sha256File(f)).toBe(sha256(Buffer.from('hello')));
  });
});

describe('ensureRuntime', () => {
  it('downloads, verifies and extracts only the node binary', async () => {
    const { archive, name } = makeLinuxArchive();
    const fetchImpl = fakeFetch({
      [name]: archive,
      'SHASUMS256.txt': `${sha256(archive)}  ${name}\n`,
    });
    const cacheDir = join(tmp, 'cache');

    const binary = await ensureRuntime({
      target: 'linux-x64',
      version: VERSION,
      cacheDir,
      fetchImpl,
    });

    expect(readFileSync(binary, 'utf8')).toContain('fake-node');
    expect(binary.endsWith(`${sep}node`)).toBe(true);
    expect(binary.startsWith(cacheDir)).toBe(true);
    expect(existsSync(join(cacheDir, VERSION, name))).toBe(true);
    expect(existsSync(join(cacheDir, VERSION, 'SHASUMS256.txt'))).toBe(true);
    expect(fetchedFiles(fetchImpl).sort()).toEqual(['SHASUMS256.txt', name].sort());
    if (process.platform !== 'win32') expect(statSync(binary).mode & 0o111).not.toBe(0);
  });

  it('reuses a verified cached archive without downloading it again', async () => {
    const { archive, name } = makeLinuxArchive();
    const files = { [name]: archive, 'SHASUMS256.txt': `${sha256(archive)}  ${name}\n` };
    const cacheDir = join(tmp, 'cache');
    await ensureRuntime({
      target: 'linux-x64',
      version: VERSION,
      cacheDir,
      fetchImpl: fakeFetch(files),
    });

    const second = fakeFetch(files);
    const binary = await ensureRuntime({
      target: 'linux-x64',
      version: VERSION,
      cacheDir,
      fetchImpl: second,
    });

    expect(readFileSync(binary, 'utf8')).toContain('fake-node');
    expect(fetchedFiles(second)).not.toContain(name);
  });

  it('re-downloads a cached archive whose checksum no longer matches', async () => {
    const { archive, name } = makeLinuxArchive();
    const files = { [name]: archive, 'SHASUMS256.txt': `${sha256(archive)}  ${name}\n` };
    const cacheDir = join(tmp, 'cache');
    await ensureRuntime({
      target: 'linux-x64',
      version: VERSION,
      cacheDir,
      fetchImpl: fakeFetch(files),
    });
    writeFileSync(join(cacheDir, VERSION, name), 'corrupted');

    const second = fakeFetch(files);
    const binary = await ensureRuntime({
      target: 'linux-x64',
      version: VERSION,
      cacheDir,
      fetchImpl: second,
    });

    expect(fetchedFiles(second)).toContain(name);
    expect(readFileSync(binary, 'utf8')).toContain('fake-node');
  });

  it('throws on a checksum mismatch after download and leaves no runtime', async () => {
    const { archive, name } = makeLinuxArchive();
    const fetchImpl = fakeFetch({
      [name]: archive,
      'SHASUMS256.txt': `${'0'.repeat(64)}  ${name}\n`,
    });
    const cacheDir = join(tmp, 'cache');

    await expect(
      ensureRuntime({ target: 'linux-x64', version: VERSION, cacheDir, fetchImpl }),
    ).rejects.toThrow(/checksum mismatch/i);

    expect(existsSync(join(cacheDir, VERSION, name))).toBe(false);
    const remaining = existsSync(cacheDir) ? listFiles(cacheDir) : [];
    expect(remaining.filter((f) => /(^|\/)node(\.exe)?$/.test(f))).toEqual([]);
  });

  it('throws when the release has no checksum for the archive', async () => {
    const { archive, name } = makeLinuxArchive();
    const fetchImpl = fakeFetch({ [name]: archive, 'SHASUMS256.txt': '' });
    await expect(
      ensureRuntime({
        target: 'linux-x64',
        version: VERSION,
        cacheDir: join(tmp, 'cache'),
        fetchImpl,
      }),
    ).rejects.toThrow(/no checksum/i);
  });

  it('throws on an HTTP error', async () => {
    const fetchImpl = fakeFetch({});
    await expect(
      ensureRuntime({
        target: 'linux-x64',
        version: VERSION,
        cacheDir: join(tmp, 'cache'),
        fetchImpl,
      }),
    ).rejects.toThrow(/404/);
  });

  it.skipIf(!existsSync('/usr/bin/zip'))('extracts node.exe from a win zip', async () => {
    const name = archiveName('win-x64', VERSION);
    const src = join(tmp, 'zsrc');
    const dir = `node-${VERSION}-win-x64`;
    mkdirSync(join(src, dir), { recursive: true });
    writeFileSync(join(src, dir, 'node.exe'), 'fake-node-exe');
    writeFileSync(join(src, dir, 'npm.cmd'), 'x');
    execFileSync('zip', ['-qr', join(tmp, name), dir], { cwd: src });
    const archive = readFileSync(join(tmp, name));
    const fetchImpl = fakeFetch({
      [name]: archive,
      'SHASUMS256.txt': `${sha256(archive)}  ${name}\n`,
    });

    const binary = await ensureRuntime({
      target: 'win-x64',
      version: VERSION,
      cacheDir: join(tmp, 'cache'),
      fetchImpl,
    });

    expect(binary.endsWith('node.exe')).toBe(true);
    expect(readFileSync(binary, 'utf8')).toBe('fake-node-exe');
  });
});

describe('fakeAdapterStubPlugin', () => {
  const MARKER = 'FAKE_ADAPTER_MARKER_TEXT';

  async function bundleWith(channel: 'dev' | 'stable'): Promise<string> {
    mkdirSync(join(tmp, 'test', 'helpers'), { recursive: true });
    mkdirSync(join(tmp, 'src', 'app'), { recursive: true });
    writeFileSync(
      join(tmp, 'test', 'helpers', 'fakeAdapter.ts'),
      `export function createFakeAdapter(): string { return '${MARKER}'; }\n`,
    );
    writeFileSync(
      join(tmp, 'src', 'app', 'entry.ts'),
      `import { createFakeAdapter } from '../../test/helpers/fakeAdapter.js';\n` +
        `export const make = (): string => createFakeAdapter();\n`,
    );
    const outfile = join(tmp, `out-${channel}.cjs`);
    await build({
      absWorkingDir: tmp,
      entryPoints: ['src/app/entry.ts'],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
      plugins: [fakeAdapterStubPlugin(channel)],
    });
    return readFileSync(outfile, 'utf8');
  }

  it('replaces the fake adapter with a throwing stub in stable builds', async () => {
    const out = await bundleWith('stable');
    expect(out).not.toContain(MARKER);
    expect(out).toContain('the fake adapter is not included in stable builds');
  });

  it('bundles the fake adapter normally in dev builds', async () => {
    const out = await bundleWith('dev');
    expect(out).toContain(MARKER);
    expect(out).not.toContain('not included in stable builds');
  });
});
