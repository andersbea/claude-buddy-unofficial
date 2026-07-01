import { describe, it, expect, vi } from 'vitest';
import { ClaudeSimulator } from './simulator';
import { isTimeSync, isTurn, type Snapshot, type WireMessage } from './protocol';

const isSnapshot = (m: WireMessage): m is Snapshot =>
  !isTimeSync(m) && !isTurn(m) && !('cmd' in (m as object));

describe('ClaudeSimulator', () => {
  it('start() emits a time sync then a snapshot, and toggles running()', () => {
    const out: WireMessage[] = [];
    const sim = new ClaudeSimulator((m) => out.push(m));
    expect(sim.running()).toBe(false);

    sim.start();
    expect(sim.running()).toBe(true);
    expect(isTimeSync(out[0])).toBe(true);
    expect(isSnapshot(out[1])).toBe(true);

    sim.stop();
    expect(sim.running()).toBe(false);
  });

  it('triggerPrompt() emits a snapshot carrying a prompt', () => {
    const out: WireMessage[] = [];
    const sim = new ClaudeSimulator((m) => out.push(m));

    sim.triggerPrompt();
    const snap = out.filter(isSnapshot).at(-1)!;
    expect(snap.prompt?.id).toBeTruthy();
    expect(snap.waiting).toBe(1);
  });

  it('resolve() only accepts the pending id and then clears the prompt', () => {
    const out: WireMessage[] = [];
    const sim = new ClaudeSimulator((m) => out.push(m));

    sim.triggerPrompt();
    const id = out.filter(isSnapshot).at(-1)!.prompt!.id;

    expect(sim.resolve('not-the-id', 'once')).toBe(false);
    expect(sim.resolve(id, 'once')).toBe(true);

    const after = out.filter(isSnapshot).at(-1)!;
    expect(after.prompt).toBeUndefined();
    expect(after.running).toBe(1); // approving resumes work
  });

  it('the interval tick is not scheduled until start()', () => {
    vi.useFakeTimers();
    try {
      const out: WireMessage[] = [];
      const sim = new ClaudeSimulator((m) => out.push(m));
      vi.advanceTimersByTime(10_000);
      expect(out).toHaveLength(0);
      sim.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
