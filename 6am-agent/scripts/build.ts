import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const pkg = JSON.parse(await readFile(`${root}package.json`, 'utf8')) as { version: string };

await build({
  absWorkingDir: root,
  entryPoints: ['src/cli/main.ts'],
  outfile: 'dist/agent.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  minify: false,
  sourcemap: true,
  define: { __AGENT_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info',
});
