import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildTaskXml,
  encodeTaskXml,
  quoteWindowsArg,
} from '../../../../src/platform/win32/taskXml.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = readFileSync(path.join(here, 'fixtures', 'task.golden.xml'), 'utf8');

const install = 'C:\\Users\\Zoë O&Brien\\AppData\\Local\\Programs\\6amAgent';
const options = {
  userId: 'S-1-5-21-1004336348-1177238915-682003330-1001',
  nodePath: `${install}\\runtime\\node.exe`,
  entryPath: `${install}\\app\\agent.cjs`,
  workingDirectory: 'C:\\Users\\Zoë O&Brien\\AppData\\Local\\6amAgent',
  systemRoot: 'C:\\Windows',
};

/** Minimal well-formedness check: balanced tags, one root, no raw `<` or bare `&` in text. */
function assertWellFormed(xml: string): void {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  const stack: string[] = [];
  let roots = 0;
  const token = /<(\/?)([A-Za-z][\w.:-]*)((?:\s+[\w:.-]+="[^"<&]*")*)\s*(\/?)>|([^<]+)/gy;
  let consumed = 0;
  for (const m of body.matchAll(token)) {
    consumed += m[0].length;
    const [, closing, name, , selfClosing, text] = m;
    if (text !== undefined) {
      expect(text).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
      if (stack.length === 0) expect(text.trim()).toBe('');
      continue;
    }
    if (closing === '/') {
      expect(stack.pop()).toBe(name);
    } else if (selfClosing !== '/') {
      if (stack.length === 0) roots += 1;
      stack.push(name ?? '');
    }
  }
  expect(consumed).toBe(body.length);
  expect(stack).toEqual([]);
  expect(roots).toBe(1);
}

describe('buildTaskXml', () => {
  it('matches the golden file', () => {
    expect(buildTaskXml(options)).toBe(golden);
  });

  it('is well-formed XML', () => {
    assertWellFormed(buildTaskXml(options));
  });

  it('starts at logon of the current user and restarts on failure every minute, 999 times', () => {
    const xml = buildTaskXml(options);
    expect(xml).toMatch(
      /<LogonTrigger>[\s\S]*<UserId>S-1-5-21-1004336348-1177238915-682003330-1001<\/UserId>[\s\S]*<\/LogonTrigger>/,
    );
    expect(xml).toMatch(
      /<RestartOnFailure>\s*<Interval>PT1M<\/Interval>\s*<Count>999<\/Count>\s*<\/RestartOnFailure>/,
    );
    expect(xml).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>');
    expect(xml).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>');
    expect(xml).toContain('<Hidden>true</Hidden>');
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>');
    expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>');
  });

  it('launches node through headless conhost so no console window appears', () => {
    const xml = buildTaskXml(options);
    expect(xml).toContain('<Command>C:\\Windows\\System32\\conhost.exe</Command>');
    expect(xml).toMatch(
      /<Arguments>--headless "[^"]+\\node\.exe" "[^"]+\\agent\.cjs" run<\/Arguments>/,
    );
  });

  it('escapes XML metacharacters in paths and user ids', () => {
    const xml = buildTaskXml({
      ...options,
      userId: 'CONTOSO\\a<b>&"c\'',
      workingDirectory: 'C:\\<odd> & "dir"',
    });
    assertWellFormed(xml);
    expect(xml).toContain(`<UserId>CONTOSO\\a&lt;b&gt;&amp;"c'</UserId>`);
    expect(xml).toContain('<WorkingDirectory>C:\\&lt;odd&gt; &amp; "dir"</WorkingDirectory>');
  });

  it('rejects relative or quote-containing executable paths', () => {
    expect(() => buildTaskXml({ ...options, nodePath: 'runtime\\node.exe' })).toThrow(/absolute/);
    expect(() => buildTaskXml({ ...options, entryPath: 'C:\\a"b\\agent.cjs' })).toThrow(/quote/);
  });
});

describe('encodeTaskXml', () => {
  it('encodes as UTF-16LE with a byte-order mark, preserving non-ASCII paths', () => {
    const bytes = encodeTaskXml('<a>Zoë 山田</a>');
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(Buffer.from(bytes.subarray(2)).toString('utf16le')).toBe('<a>Zoë 山田</a>');
  });
});

describe('quoteWindowsArg (CommandLineToArgvW rules)', () => {
  it.each([
    ['plain', 'plain'],
    ['', '""'],
    ['with space', '"with space"'],
    ['C:\\Program Files\\x\\', '"C:\\Program Files\\x\\\\"'],
    ['say "hi"', '"say \\"hi\\""'],
    ['a\\\\"b', '"a\\\\\\\\\\"b"'],
    ['tab\there', '"tab\there"'],
    ['Zoë', 'Zoë'],
  ])('%j → %s', (input, expected) => {
    expect(quoteWindowsArg(input)).toBe(expected);
  });

  it('always quotes when asked, for paths that must stay one argument', () => {
    expect(quoteWindowsArg('C:\\x\\node.exe', true)).toBe('"C:\\x\\node.exe"');
  });
});
