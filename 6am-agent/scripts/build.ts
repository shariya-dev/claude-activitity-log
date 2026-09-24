/**
 * Per-target agent build (H18).
 *
 *   npm run build                                  host target, dev config
 *   npm run build -- --target linux-x64 [--config build-config.json]
 *   npm run build -- --all --config build-config.json [--node-version v24.x.y]
 *
 * Output per target (the contract consumed by the installers, H19–H21):
 *   dist/<target>/runtime/node[.exe]      official Node 24 binary, SHA-256 verified
 *   dist/<target>/app/agent.cjs           esbuild bundle of src/cli/main.ts
 *   dist/<target>/app/build-config.json
 *   dist/<target>/VERSION
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs as parseCliArgs, promisify } from 'node:util';
import { build, type Plugin } from 'esbuild';
import { loadBuildConfig, type BuildConfig } from '../src/app/buildConfig.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_NODE_VERSION = 'v24.21.0';
export const NODE_DIST_BASE = 'https://nodejs.org/dist';

export const ALL_TARGETS = [
  'darwin-arm64',
  'darwin-x64',
  'win-x64',
  'win-arm64',
  'linux-x64',
  'linux-arm64',
] as const;
export type Target = (typeof ALL_TARGETS)[number];

type FetchImpl = (input: string) => Promise<Response>;

function isTarget(value: string): value is Target {
  return (ALL_TARGETS as readonly string[]).includes(value);
}

function isWin(target: Target): boolean {
  return target.startsWith('win-');
}

// ---------------------------------------------------------------------------
// CLI

export interface BuildArgs {
  target: string | undefined;
  all: boolean;
  config: string | undefined;
  nodeVersion: string;
}

export function parseArgs(argv: string[]): BuildArgs {
  const { values } = parseCliArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      target: { type: 'string' },
      all: { type: 'boolean', default: false },
      config: { type: 'string' },
      'node-version': { type: 'string', default: DEFAULT_NODE_VERSION },
    },
  });
  const nodeVersion = values['node-version'];
  if (!/^v24\.\d+\.\d+$/.test(nodeVersion)) {
    throw new Error(`--node-version must be a Node 24 release (v24.x.y), got "${nodeVersion}"`);
  }
  if (values.all && values.target !== undefined) {
    throw new Error('use either --target <os-arch> or --all, not both');
  }
  return { target: values.target, all: values.all, config: values.config, nodeVersion };
}

export function hostTarget(host: { platform: string; arch: string }): Target {
  const os = ({ darwin: 'darwin', win32: 'win', linux: 'linux' } as Record<string, string>)[
    host.platform
  ];
  const candidate = `${os}-${host.arch}`;
  if (os === undefined || !isTarget(candidate)) {
    throw new Error(
      `unsupported host ${host.platform}-${host.arch}; pass --target (${ALL_TARGETS.join(', ')})`,
    );
  }
  return candidate;
}

export function resolveTargets(
  opts: { target?: string | undefined; all?: boolean },
  host: { platform: string; arch: string } = { platform: process.platform, arch: process.arch },
): Target[] {
  if (opts.all === true) return [...ALL_TARGETS];
  if (opts.target !== undefined) {
    if (!isTarget(opts.target)) {
      throw new Error(
        `unknown target "${opts.target}" (expected one of: ${ALL_TARGETS.join(', ')})`,
      );
    }
    return [opts.target];
  }
  return [hostTarget(host)];
}

/**
 * `--config <file>` if given; otherwise the example config, which must be a dev config:
 * a stable build always needs an explicit `--config`.
 */
export function resolveBuildConfig(
  configPath: string | undefined,
  examplePath: string,
): BuildConfig {
  if (configPath !== undefined) return loadBuildConfig(configPath);
  const config = loadBuildConfig(examplePath);
  if (config.channel !== 'dev') {
    throw new Error(
      `${examplePath} must have channel "dev"; a stable build requires an explicit --config <file>`,
    );
  }
  return config;
}

// ---------------------------------------------------------------------------
// Node runtime: download, verify, extract

export function archiveName(target: Target, version: string): string {
  return isWin(target) ? `node-${version}-${target}.zip` : `node-${version}-${target}.tar.gz`;
}

/** `SHASUMS256.txt` → file name → lowercase hex digest. */
export function parseShasums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) map.set(m[2], m[1].toLowerCase());
  }
  return map;
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function download(fetchImpl: FetchImpl, url: string, dest: string): Promise<void> {
  const res = await fetchImpl(url);
  if (!res.ok || res.body === null) {
    throw new Error(`download failed: ${url} (HTTP ${res.status})`);
  }
  const part = `${dest}.part`;
  try {
    await pipeline(
      Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
      createWriteStream(part),
    );
    await rename(part, dest);
  } finally {
    await rm(part, { force: true });
  }
}

async function extractBinary(
  target: Target,
  archive: string,
  version: string,
  into: string,
): Promise<string> {
  const dir = `node-${version}-${target}`;
  if (!isWin(target)) {
    await execFileAsync('tar', ['-xzf', archive, '-C', into, `${dir}/bin/node`]);
    return join(into, dir, 'bin', 'node');
  }
  const member = `${dir}/node.exe`;
  try {
    // bsdtar (macOS, Windows 10+) reads zip archives.
    await execFileAsync('tar', ['-xf', archive, '-C', into, member]);
  } catch {
    await execFileAsync('unzip', ['-o', '-q', archive, member, '-d', into]);
  }
  return join(into, dir, 'node.exe');
}

export interface EnsureRuntimeOptions {
  target: Target;
  version: string;
  /** Root cache dir (e.g. `.cache/node`); files go under `<cacheDir>/<version>/`. */
  cacheDir: string;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
}

/**
 * Returns the path of a verified, executable Node binary for `target`.
 *
 * SHASUMS256.txt is cached per version. The archive is cached too, but its SHA-256 is
 * re-checked on every call: a cached archive that does not match is re-downloaded, and a
 * download that does not match is deleted and fails the build. Nothing is extracted from
 * an archive that has not just been verified.
 */
export async function ensureRuntime(opts: EnsureRuntimeOptions): Promise<string> {
  const { target, version } = opts;
  const fetchImpl: FetchImpl = opts.fetchImpl ?? ((url) => fetch(url));
  const base = `${opts.baseUrl ?? NODE_DIST_BASE}/${version}`;
  const versionDir = join(opts.cacheDir, version);
  await mkdir(versionDir, { recursive: true });

  const shasumsPath = join(versionDir, 'SHASUMS256.txt');
  if (!existsSync(shasumsPath)) {
    await download(fetchImpl, `${base}/SHASUMS256.txt`, shasumsPath);
  }
  const name = archiveName(target, version);
  const expected = parseShasums(await readFile(shasumsPath, 'utf8')).get(name);
  if (expected === undefined) {
    await rm(shasumsPath, { force: true });
    throw new Error(`no checksum for ${name} in ${base}/SHASUMS256.txt`);
  }

  const archivePath = join(versionDir, name);
  const cachedOk = existsSync(archivePath) && (await sha256File(archivePath)) === expected;
  if (!cachedOk) {
    await rm(archivePath, { force: true });
    await download(fetchImpl, `${base}/${name}`, archivePath);
    const actual = await sha256File(archivePath);
    if (actual !== expected) {
      await rm(archivePath, { force: true });
      throw new Error(`checksum mismatch for ${name}: expected ${expected}, got ${actual}`);
    }
  }

  const extractDir = join(versionDir, `extract-${target}`);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  try {
    const binary = await extractBinary(target, archivePath, version, extractDir);
    if (!existsSync(binary)) throw new Error(`${name} did not contain the node binary`);
    await chmod(binary, 0o755);
    return binary;
  } catch (err) {
    await rm(extractDir, { recursive: true, force: true });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Bundle

const STABLE_STUB =
  "export function createFakeAdapter() { throw new Error('the fake adapter is not included in stable builds'); }\n";

const FAKE_ADAPTER_FILTER = /(^|[\\/])test[\\/]helpers[\\/]fakeAdapter(\.js|\.ts)?$/;

/** Stable builds replace the dev-only `test/helpers/fakeAdapter` module with a throwing stub. */
export function fakeAdapterStubPlugin(channel: BuildConfig['channel']): Plugin {
  return {
    name: 'fake-adapter-stub',
    setup(pluginBuild) {
      if (channel !== 'stable') return;
      pluginBuild.onResolve({ filter: FAKE_ADAPTER_FILTER }, () => ({
        path: 'fakeAdapter',
        namespace: 'stable-fake-adapter-stub',
      }));
      pluginBuild.onLoad({ filter: /.*/, namespace: 'stable-fake-adapter-stub' }, () => ({
        contents: STABLE_STUB,
        loader: 'js',
      }));
    },
  };
}

export async function bundle(opts: {
  channel: BuildConfig['channel'];
  outfile: string;
  version: string;
  root: string;
}): Promise<void> {
  await build({
    absWorkingDir: opts.root,
    entryPoints: ['src/cli/main.ts'],
    outfile: opts.outfile,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    minify: false,
    sourcemap: false,
    define: { __AGENT_VERSION__: JSON.stringify(opts.version) },
    plugins: [fakeAdapterStubPlugin(opts.channel)],
    logLevel: 'warning',
  });
}

// ---------------------------------------------------------------------------
// Layout

export interface AssembledTarget {
  root: string;
  runtime: string;
  bundle: string;
  buildConfig: string;
  version: string;
}

export async function assembleTarget(opts: {
  target: Target;
  distDir: string;
  bundlePath: string;
  runtimeBinaryPath: string;
  buildConfig: BuildConfig;
  version: string;
}): Promise<AssembledTarget> {
  const root = join(opts.distDir, opts.target);
  const out: AssembledTarget = {
    root,
    runtime: join(root, 'runtime', isWin(opts.target) ? 'node.exe' : 'node'),
    bundle: join(root, 'app', 'agent.cjs'),
    buildConfig: join(root, 'app', 'build-config.json'),
    version: join(root, 'VERSION'),
  };
  await rm(root, { recursive: true, force: true });
  await mkdir(join(root, 'runtime'), { recursive: true });
  await mkdir(join(root, 'app'), { recursive: true });
  await copyFile(opts.runtimeBinaryPath, out.runtime);
  await chmod(out.runtime, 0o755);
  await copyFile(opts.bundlePath, out.bundle);
  await writeFile(out.buildConfig, `${JSON.stringify(opts.buildConfig, null, 2)}\n`);
  await writeFile(out.version, `${opts.version}\n`);
  return out;
}

// ---------------------------------------------------------------------------
// Main

async function main(argv: string[]): Promise<void> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const args = parseArgs(argv);
  const targets = resolveTargets(args);
  const buildConfig = resolveBuildConfig(args.config, join(root, 'build-config.example.json'));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    version: string;
  };

  const work = await mkdtemp(join(tmpdir(), '6am-agent-build-'));
  try {
    const bundlePath = join(work, 'agent.cjs');
    await bundle({ channel: buildConfig.channel, outfile: bundlePath, version: pkg.version, root });
    for (const target of targets) {
      const runtimeBinaryPath = await ensureRuntime({
        target,
        version: args.nodeVersion,
        cacheDir: join(root, '.cache', 'node'),
      });
      const out = await assembleTarget({
        target,
        distDir: join(root, 'dist'),
        bundlePath,
        runtimeBinaryPath,
        buildConfig,
        version: pkg.version,
      });
      console.log(
        `built ${target}: agent ${pkg.version}, node ${args.nodeVersion}, ` +
          `channel ${buildConfig.channel} (${buildConfig.apiBaseUrl}) -> ${out.root}`,
      );
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(`build failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
