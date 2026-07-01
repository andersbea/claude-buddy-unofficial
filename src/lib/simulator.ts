/*
 * simulator.ts — Claude Desktop integration stand-in (browser mode only).
 *
 * Emits the exact same JSON Claude Desktop sends (heartbeat snapshots, turns,
 * time sync, approval prompts) and consumes the same permission responses, so
 * the rest of the app is source-agnostic. A web page can't be a BLE peripheral,
 * so this drives the browser build.
 */
import type { Decision, Snapshot, TurnEvent, WireMessage } from './protocol';

const TOOLS = [
  { tool: 'Bash', hint: 'rm -rf build/ && make' },
  { tool: 'Edit', hint: 'modify src/server.ts' },
  { tool: 'Write', hint: 'create migrations/004.sql' },
  { tool: 'WebFetch', hint: 'fetch api.example.com/v2/users' },
  { tool: 'Bash', hint: 'git push origin main' },
];

const ASSISTANT_LINES = [
  'Reading the project structure to get oriented.',
  'Found the bug — an off-by-one in the pagination cursor.',
  'Patching the handler and adding a regression test.',
  'Tests pass. 14 passed, 0 failed.',
  'Need your approval to run this command.',
  'Refactored the auth middleware into its own module.',
  'Looks good — shipping it.',
];

type Phase = 'idle' | 'working' | 'waiting' | 'finishing';

export class ClaudeSimulator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private phase: Phase = 'idle';
  private pending: { id: string; tool: string; hint: string } | null = null;
  private stats = {
    total: 0, running: 0, waiting: 0, msg: '', entries: 0, tokens: 0, tokens_today: 18420,
  };

  constructor(private emit: (msg: WireMessage) => void) {}

  running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    this.stop();
    this.emit({ time: [Math.floor(Date.now() / 1000), -new Date().getTimezoneOffset() * 60] });
    this.snapshot();
    this.timer = setInterval(() => this.tick(), 2600);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Accept a permission response, just like a real device button press. */
  resolve(id: string, decision: Decision): boolean {
    if (!this.pending || this.pending.id !== id) return false;
    const tool = this.pending.tool;
    this.pending = null;
    this.stats.waiting = 0;
    if (decision === 'deny') {
      this.stats.running = 0;
      this.stats.msg = `${tool} denied`;
      this.turn(`Understood — skipping ${tool}.`);
      this.phase = 'finishing';
    } else {
      this.stats.running = 1;
      this.stats.msg = `${tool} approved`;
      this.turn(`Running ${tool}…`);
      this.phase = 'working';
    }
    this.snapshot();
    return true;
  }

  /** Force an approval prompt on demand. */
  triggerPrompt(): void {
    const t = TOOLS[Math.floor(Math.random() * TOOLS.length)];
    this.pending = { id: 'p' + Date.now(), tool: t.tool, hint: t.hint };
    this.stats.waiting = 1;
    this.stats.running = 0;
    this.stats.msg = 'Approval needed: ' + t.tool;
    this.phase = 'waiting';
    this.turn('Need your approval to run: ' + t.hint);
    this.snapshot();
  }

  private snapshot(): void {
    const snap: Snapshot = {
      total: this.stats.total,
      running: this.stats.running,
      waiting: this.stats.waiting,
      msg: this.stats.msg,
      entries: [],
      tokens: this.stats.tokens,
      tokens_today: this.stats.tokens_today,
    };
    if (this.pending) snap.prompt = this.pending;
    this.emit(snap);
  }

  private turn(text: string): void {
    const ev: TurnEvent = { evt: 'turn', role: 'assistant', content: [{ type: 'text', text }] };
    this.emit(ev);
  }

  private tick(): void {
    this.seq++;
    if (this.phase === 'idle') {
      if (Math.random() < 0.5) {
        this.phase = 'working';
        this.stats.total++;
        this.stats.running = 1;
        this.stats.msg = 'Session started';
        this.turn(ASSISTANT_LINES[0]);
      }
    } else if (this.phase === 'working') {
      this.stats.tokens += 200 + Math.floor(Math.random() * 1500);
      this.stats.tokens_today += 300;
      this.stats.entries++;
      const line = ASSISTANT_LINES[1 + (this.seq % (ASSISTANT_LINES.length - 2))];
      this.stats.msg = line;
      this.turn(line);
      if (Math.random() < 0.35) {
        const t = TOOLS[Math.floor(Math.random() * TOOLS.length)];
        this.pending = { id: 'p' + Date.now(), tool: t.tool, hint: t.hint };
        this.stats.waiting = 1;
        this.stats.running = 0;
        this.stats.msg = 'Approval needed: ' + t.tool;
        this.phase = 'waiting';
        this.turn('Need your approval to run: ' + t.hint);
      } else if (Math.random() < 0.3) {
        this.phase = 'finishing';
        this.stats.running = 0;
        this.stats.msg = 'Done';
        this.turn('All set — task complete.');
      }
    } else if (this.phase === 'finishing') {
      this.phase = 'idle';
      this.stats.running = 0;
      this.stats.waiting = 0;
    }
    this.snapshot();
  }
}
