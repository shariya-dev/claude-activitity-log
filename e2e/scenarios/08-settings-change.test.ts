import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateSettings } from '../lib/backend.js';
import { assistantMessage, turn, userPrompt } from '../lib/lines.js';
import {
  appendLines,
  createScenario,
  HEARTBEAT_PATH,
  payload,
  SESSION,
  SYNC_PATH,
  waitFor,
  type Scenario,
} from '../setup.js';

const PROMPT_ON = 'Lorem ipsum prompt written while tracking is ON.';
const PROMPT_OFF = 'Lorem ipsum prompt written after tracking was turned OFF again.';

// The admin changes tracking settings centrally; the agent learns the new version from the next
// heartbeat (the service restarts here so that heartbeat comes first instead of 60 s later)
// and applies it at scan time.
describe('08 settings change: prompt tracking (AC27, AC28, AC29, contract §5)', () => {
  let scn: Scenario;

  beforeAll(async () => {
    scn = await createScenario('s08');
    await scn.pair();
  });
  afterAll(async () => {
    await scn?.cleanup();
  });

  /** Runs the service until it acknowledged a sync carrying `messageId`, then stops it. */
  async function runUntilSynced(messageId: string | null) {
    const before = scn.captures(SYNC_PATH).length;
    const daemon = await scn.startAgentDaemon();
    const ack = await waitFor('the sync', () =>
      scn
        .acknowledgedSyncs()
        .filter((c) => scn.captures(SYNC_PATH).indexOf(c) >= before)
        .find(
          (c) =>
            messageId === null || payload(c).usage.some((u) => u.source_message_id === messageId),
        ),
    );
    const stopped = await daemon.stop();
    expect(stopped.code, daemon.output()).toBe(0);
    return ack;
  }

  it('prompt tracking is OFF by default: the initial sync carries no prompt text', async () => {
    const ack = await runUntilSynced(null);
    expect(payload(ack).messages).toEqual([]);
    expect(await scn.messageCount()).toBe(0);
    for (const c of scn.captures()) {
      for (const prompt of scn.expected.prompts) expect(c.requestBody.includes(prompt)).toBe(false);
    }
  });

  it('turning it ON: the next sync carries the new prompt and the backend stores it encrypted', async () => {
    const version = await updateSettings(scn.ctx.backend, { prompt: true });
    const prompt = userPrompt(SESSION.basic, PROMPT_ON);
    const reply = assistantMessage(SESSION.basic, {
      input: 1,
      output: 2,
      cacheCreation: 3,
      cacheRead: 4,
    });
    appendLines(scn.sessionFile(SESSION.basic), [prompt, ...reply.lines]);

    const ack = await runUntilSynced(reply.id);
    const heartbeat = scn.captures(HEARTBEAT_PATH).at(-1);
    expect((heartbeat?.responseJson as { settings_version: number }).settings_version).toBe(
      version,
    );
    expect(payload(ack).sync.settings_version).toBe(version);
    expect(payload(ack).messages).toEqual([
      expect.objectContaining({ source_message_id: prompt.uuid, role: 'user', content: PROMPT_ON }),
    ]);

    // Only the new prompt: text scanned while tracking was OFF is not backfilled.
    expect(await scn.messageCount()).toBe(1);
    const [stored] = await scn.sql<{ source_message_id: string; content: string }>(
      `SELECT m.source_message_id, m.content FROM session_messages m
       JOIN claude_sessions s ON s.id = m.claude_session_id WHERE s.device_id = ?`,
      [await scn.deviceId()],
    );
    expect(stored?.source_message_id).toBe(prompt.uuid);
    expect(stored?.content).not.toContain(PROMPT_ON);
  });

  it('turning it OFF again: no prompt text is sent and none is stored', async () => {
    const version = await updateSettings(scn.ctx.backend, { prompt: false });
    const firstNew = scn.captures().length;
    const offTurn = turn(SESSION.basic, PROMPT_OFF, {
      input: 1,
      output: 2,
      cacheCreation: 3,
      cacheRead: 4,
    });
    appendLines(scn.sessionFile(SESSION.basic), offTurn.lines);

    const ack = await runUntilSynced(offTurn.messageId);
    expect(payload(ack).sync.settings_version).toBe(version);
    expect(payload(ack).messages).toEqual([]);
    for (const c of scn.captures().slice(firstNew)) {
      expect(c.requestBody.includes(PROMPT_OFF)).toBe(false);
    }
    expect(await scn.messageCount()).toBe(1);
  });
});
