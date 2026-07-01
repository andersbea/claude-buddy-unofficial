/*
 * protocol.ts — Hardware Buddy wire protocol (Nordic UART Service).
 *
 * The single source of truth for the wire format: UUIDs, the seven canonical
 * states, line framing, and message builders. Mirrors the upstream REFERENCE.md
 * (https://github.com/anthropics/claude-desktop-buddy/blob/main/REFERENCE.md).
 *
 * Everything on the wire is UTF-8 JSON — one object per line, '\n'-terminated.
 */

/** Nordic UART Service UUIDs (lowercased; Web Bluetooth requires lowercase). */
export const NUS = {
  SERVICE: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  /** central writes here (desktop/web → device) */
  RX: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  /** device notifies here (device → desktop/web) */
  TX: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
} as const;

/** The seven canonical buddy states, in escalation order. */
export const STATES = [
  'sleep', 'idle', 'busy', 'attention', 'celebrate', 'dizzy', 'heart',
] as const;
export type BuddyState = (typeof STATES)[number];

/** turn events serializing larger than this are dropped before relay (per spec). */
export const TURN_MAX_BYTES = 4096;

export type Decision = 'once' | 'deny';

export interface Prompt {
  id: string;
  tool?: string;
  hint?: string;
}

/** Heartbeat snapshot the desktop pushes on change + every ~10s. */
export interface Snapshot {
  total?: number;
  running?: number;
  waiting?: number;
  msg?: string;
  entries?: string[];
  tokens?: number;
  tokens_today?: number;
  prompt?: Prompt;
}

export interface TurnEvent {
  evt: 'turn';
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
}

export interface TimeSyncMessage {
  time: [number, number];
}

export interface CommandMessage {
  cmd: string;
  [key: string]: unknown;
}

export type WireMessage =
  | Snapshot
  | TurnEvent
  | TimeSyncMessage
  | CommandMessage
  | Record<string, unknown>;

export const isTurn = (m: WireMessage): m is TurnEvent =>
  (m as TurnEvent).evt === 'turn';
export const isTimeSync = (m: WireMessage): m is TimeSyncMessage =>
  Array.isArray((m as TimeSyncMessage).time);
export const isCommand = (m: WireMessage): m is CommandMessage =>
  typeof (m as CommandMessage).cmd === 'string';

/**
 * Line accumulator: feed it raw chunks (Uint8Array / ArrayBuffer / string), it
 * emits complete JSON objects via onMessage. Bytes accumulate until a newline.
 */
export class LineParser {
  private decoder = new TextDecoder('utf-8');
  private encoder = new TextEncoder();
  private pending: number[] = []; // bytes buffered until the next '\n'

  constructor(
    private onMessage: (msg: WireMessage) => void,
    private onError?: (err: unknown, line: string) => void,
  ) {}

  feed(chunk: Uint8Array | ArrayBuffer | DataView | string): void {
    // Robust across realms (jsdom's TextEncoder Uint8Array isn't `instanceof`
    // the module's Uint8Array) and accepts the DataView that Web Bluetooth emits.
    let bytes: Uint8Array;
    if (typeof chunk === 'string') {
      bytes = this.encoder.encode(chunk);
    } else if (chunk instanceof ArrayBuffer) {
      bytes = new Uint8Array(chunk);
    } else {
      const view = chunk as ArrayBufferView;
      bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    // Accumulate bytes until a newline, then decode the whole line at once. This
    // is correct even when a multi-byte UTF-8 char is split across BLE chunks.
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x0a) {
        this.flush();
      } else {
        this.pending.push(bytes[i]);
      }
    }
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    const line = this.decoder.decode(new Uint8Array(this.pending)).trim();
    this.pending.length = 0;
    if (!line) return;
    try {
      this.onMessage(JSON.parse(line) as WireMessage);
    } catch (err) {
      this.onError?.(err, line);
    }
  }

  reset(): void {
    this.pending.length = 0;
  }
}

/** Encode an object as a single newline-terminated UTF-8 line. */
export function encodeLine(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + '\n');
}

/** UTF-8 byte length of an object serialized for the wire (for the turn cap). */
export function wireByteLength(obj: unknown): number {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}

export interface StateOpts {
  justFinished?: boolean;
}

/**
 * Derive a buddy state from a heartbeat snapshot. NOTE: `sleep` means "bridge
 * not connected" and is decided by the connection layer, not here — this only
 * maps live snapshot activity to idle/busy/attention/celebrate.
 */
export function stateFromSnapshot(snap: Snapshot, opts: StateOpts = {}): BuddyState {
  if (snap.prompt?.id) return 'attention';
  if ((snap.waiting ?? 0) > 0) return 'attention';
  if ((snap.running ?? 0) > 0) return 'busy';
  if (opts.justFinished) return 'celebrate';
  return 'idle';
}

// ---- message builders (device/web → desktop) ----

export const permission = (id: string, decision: Decision): CommandMessage =>
  ({ cmd: 'permission', id, decision });

/** Time sync the desktop sends on connect: [epoch_seconds, tz_offset_seconds]. */
export function timeSync(date = new Date()): TimeSyncMessage {
  return { time: [Math.floor(date.getTime() / 1000), -date.getTimezoneOffset() * 60] };
}

/** Ack builder (device → desktop). Every cmd expects {ack:<cmd>, ok, ...}. */
export function ack(cmd: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { ack: cmd, ok: true, ...fields };
}
