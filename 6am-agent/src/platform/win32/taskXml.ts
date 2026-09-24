/**
 * Task Scheduler 1.2 XML for the per-user "6amAgent" task (agent.md §1, D11: a per-user logon
 * task, not a SYSTEM service, so the agent runs as the developer and needs no admin rights).
 *
 * No console window: node.exe is a console program, and a task with an interactive token would
 * open a console for it (or Windows Terminal, when that is the default terminal). The action runs
 * `%SystemRoot%\System32\conhost.exe --headless`, which hosts node's console without any window.
 * `--headless` is supported by conhost on Windows 10 1809+ and Windows 11. wscript/VBScript
 * wrappers are avoided on purpose (VBScript is being removed from Windows).
 *
 * Restart: RestartOnFailure (1 min, 999×) covers a failed start; the LogonTrigger also repeats
 * every 5 minutes with MultipleInstancesPolicy=IgnoreNew, which relaunches the agent after a
 * crash while never starting a second instance.
 */
import path from 'node:path';

export interface TaskXmlOptions {
  /** SID (preferred) or DOMAIN\user of the current user. */
  userId: string;
  nodePath: string;
  entryPath: string;
  workingDirectory: string;
  systemRoot: string;
}

/** Escapes element text (the XML only interpolates into element content, never attributes). */
export function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Quotes one argument so CommandLineToArgvW / the MSVC runtime parse it back unchanged:
 * backslashes are literal except directly before a quote, where they are doubled.
 */
export function quoteWindowsArg(arg: string, always = false): string {
  if (!always && arg !== '' && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes += 1;
    } else if (ch === '"') {
      out += `${'\\'.repeat(backslashes * 2 + 1)}"`;
      backslashes = 0;
    } else {
      out += `${'\\'.repeat(backslashes)}${ch}`;
      backslashes = 0;
    }
  }
  return `${out}${'\\'.repeat(backslashes * 2)}"`;
}

export function assertExecutablePath(label: string, value: string): void {
  if (!path.win32.isAbsolute(value) || !/^([A-Za-z]:\\|\\\\)/.test(value)) {
    throw new Error(`${label} must be an absolute Windows path: ${value}`);
  }
  if (/["\r\n]/.test(value)) {
    throw new Error(`${label} must not contain a quote or line break: ${value}`);
  }
}

export function buildTaskXml(o: TaskXmlOptions): string {
  assertExecutablePath('nodePath', o.nodePath);
  assertExecutablePath('entryPath', o.entryPath);
  const conhost = path.win32.join(o.systemRoot, 'System32', 'conhost.exe');
  const args = [
    '--headless',
    quoteWindowsArg(o.nodePath, true),
    quoteWindowsArg(o.entryPath, true),
    'run',
  ].join(' ');
  const user = xmlEscape(o.userId);

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>6AM Technologies</Author>
    <Description>6AM Agent: syncs Claude Code activity to the 6AM Technologies monitoring dashboard.</Description>
    <URI>\\6amAgent</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <Enabled>true</Enabled>
      <UserId>${user}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(conhost)}</Command>
      <Arguments>${xmlEscape(args)}</Arguments>
      <WorkingDirectory>${xmlEscape(o.workingDirectory)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/** schtasks /XML expects UTF-16; a BOM makes the encoding unambiguous for non-ASCII paths. */
export function encodeTaskXml(xml: string): Uint8Array {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]);
}
