declare const __AGENT_VERSION__: string | undefined;

/** Stamped from package.json by scripts/build.ts; the unbundled fallback must match it (cli.test.ts). */
export const AGENT_VERSION: string =
  typeof __AGENT_VERSION__ === 'string' ? __AGENT_VERSION__ : '1.0.0';
