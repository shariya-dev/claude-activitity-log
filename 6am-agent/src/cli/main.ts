import { runCli } from './cli.js';

const controller = new AbortController();
let signalled = false;

// Graceful shutdown: the first SIGTERM/SIGINT stops the runtime (the current HTTP request may
// finish within 10 s) and closes SQLite; a second one exits immediately.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (signalled) process.exit(signal === 'SIGINT' ? 130 : 143);
    signalled = true;
    controller.abort();
  });
}

runCli(process.argv.slice(2), { signal: controller.signal }).then(
  (code) => {
    // Everything is closed by now; don't wait for idle keep-alive sockets.
    process.exit(code);
  },
  (err: unknown) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
