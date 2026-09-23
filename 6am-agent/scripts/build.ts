import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

await build({
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
