import type { Win32FileOps } from './fileOps.js';

type PermissionResult = { path: string; readable: boolean; hint?: string };

function hintFor(p: string, error: unknown, user: string): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  switch (code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return `Not found: ${p}`;
    case 'EACCES':
    case 'EPERM':
      return (
        `Access denied: ${p}. The agent runs as ${user} and needs Read access. The folder's ` +
        `owner or an administrator can grant it (Properties > Security), or run: ` +
        `icacls "${p}" /grant "${user}:(OI)(CI)RX"`
      );
    case 'EBUSY':
      return `Locked by another process: ${p}. It will be retried on the next scan.`;
    default:
      return `Cannot read ${p}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Opens each path for reading, since Windows ACLs are not visible in the file mode. */
export async function checkPermissions(
  paths: string[],
  files: Win32FileOps,
  user = '<your Windows account>',
): Promise<PermissionResult[]> {
  const results: PermissionResult[] = [];
  for (const p of paths) {
    try {
      await files.isDirectory(p);
      await files.probeRead(p);
      results.push({ path: p, readable: true });
    } catch (error) {
      results.push({ path: p, readable: false, hint: hintFor(p, error, user) });
    }
  }
  return results;
}
