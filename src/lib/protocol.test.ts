import { describe, it, expect, vi } from 'vitest';
import {
  LineParser, encodeLine, wireByteLength, stateFromSnapshot,
  permission, timeSync, ack, NUS, STATES, TURN_MAX_BYTES,
  type WireMessage,
} from './protocol';

describe('LineParser', () => {
  it('emits one object per newline-terminated line', () => {
    const out: WireMessage[] = [];
    const p = new LineParser((m) => out.push(m));
    p.feed('{"a":1}\n{"b":2}\n');
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('reassembles a line split across chunks', () => {
    const out: WireMessage[] = [];
    const p = new LineParser((m) => out.push(m));
    p.feed('{"to');
    p.feed('tal":17}');
    expect(out).toHaveLength(0); // no newline yet
    p.feed('\n');
    expect(out).toEqual([{ total: 17 }]);
  });

  it('decodes UTF-8 byte chunks (as BLE notifications arrive)', () => {
    const out: WireMessage[] = [];
    const p = new LineParser((m) => out.push(m));
    p.feed(encodeLine({ msg: 'hi' }));
    expect(out).toEqual([{ msg: 'hi' }]);
  });

  it('reports parse errors without throwing, and continues', () => {
    const out: WireMessage[] = [];
    const onErr = vi.fn();
    const p = new LineParser((m) => out.push(m), onErr);
    p.feed('not json\n{"ok":true}\n');
    expect(onErr).toHaveBeenCalledTimes(1);
    expect(out).toEqual([{ ok: true }]);
  });

  it('reset() clears the buffer', () => {
    const out: WireMessage[] = [];
    const p = new LineParser((m) => out.push(m));
    p.feed('{"partial":');
    p.reset();
    p.feed('1}\n');
    expect(out).toHaveLength(0);
  });
});

describe('encodeLine / wireByteLength', () => {
  it('round-trips through the parser', () => {
    const out: WireMessage[] = [];
    const p = new LineParser((m) => out.push(m));
    const obj = { evt: 'turn', content: [{ text: 'héllo' }] };
    p.feed(encodeLine(obj));
    expect(out[0]).toEqual(obj);
  });

  it('measures UTF-8 size (multi-byte chars counted as bytes)', () => {
    expect(wireByteLength({ x: 'a' })).toBe(JSON.stringify({ x: 'a' }).length);
    // '€' is 1 JS char but 3 UTF-8 bytes → 2 more bytes than string length.
    expect(wireByteLength({ x: '€' })).toBe(JSON.stringify({ x: '€' }).length + 2);
  });

  it('TURN_MAX_BYTES is the 4KB spec cap', () => {
    expect(TURN_MAX_BYTES).toBe(4096);
  });
});

describe('stateFromSnapshot', () => {
  it('attention when a prompt is pending', () => {
    expect(stateFromSnapshot({ prompt: { id: 'x' } })).toBe('attention');
  });
  it('attention when waiting > 0', () => {
    expect(stateFromSnapshot({ waiting: 1 })).toBe('attention');
  });
  it('busy when running > 0 and not waiting', () => {
    expect(stateFromSnapshot({ running: 2 })).toBe('busy');
  });
  it('celebrate when justFinished', () => {
    expect(stateFromSnapshot({ running: 0, waiting: 0 }, { justFinished: true })).toBe('celebrate');
  });
  it('idle otherwise', () => {
    expect(stateFromSnapshot({ total: 17, running: 0, waiting: 0 })).toBe('idle');
  });
});

describe('builders + constants', () => {
  it('permission echoes id + decision', () => {
    expect(permission('req_1', 'once')).toEqual({ cmd: 'permission', id: 'req_1', decision: 'once' });
    expect(permission('req_1', 'deny')).toEqual({ cmd: 'permission', id: 'req_1', decision: 'deny' });
  });
  it('timeSync is [epoch_seconds, tz_offset_seconds]', () => {
    const d = new Date('2026-06-30T12:00:00Z');
    const [epoch, tz] = timeSync(d).time;
    expect(epoch).toBe(Math.floor(d.getTime() / 1000));
    expect(tz).toBe(-d.getTimezoneOffset() * 60);
  });
  it('ack merges fields onto {ack, ok:true}', () => {
    expect(ack('status', { data: { name: 'x' } })).toEqual({ ack: 'status', ok: true, data: { name: 'x' } });
  });
  it('NUS uuids are lowercase', () => {
    expect(NUS.SERVICE).toBe(NUS.SERVICE.toLowerCase());
  });
  it('exactly seven canonical states', () => {
    expect(STATES).toHaveLength(7);
    expect(STATES).toContain('sleep');
    expect(STATES).toContain('heart');
  });
});
