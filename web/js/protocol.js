/*
 * protocol.js — Hardware Buddy wire protocol (Nordic UART Service).
 *
 * Mirrors the framing and JSON schemas documented in the firmware's
 * REFERENCE.md so this web buddy is wire-compatible with Claude Desktop
 * and with real ESP32 buddy devices.
 *
 *   Everything on the wire is UTF-8 JSON — one object per line, '\n'-terminated.
 *   Accumulate bytes until a newline appears, then parse.
 */
(function (global) {
  'use strict';

  // Nordic UART Service UUIDs (lowercased; Web Bluetooth requires lowercase).
  const NUS = {
    SERVICE: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    // RX = central writes here  (desktop/web -> device)
    RX: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    // TX = device notifies here (device -> desktop/web)
    TX: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  };

  // The seven canonical buddy states, in escalation order.
  const STATES = ['sleep', 'idle', 'busy', 'attention', 'celebrate', 'dizzy', 'heart'];

  /*
   * A line accumulator: feed it raw chunks (Uint8Array or string), it emits
   * complete JSON objects via the onMessage callback.
   */
  function LineParser(onMessage, onError) {
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    function feed(chunk) {
      if (chunk instanceof Uint8Array || chunk instanceof ArrayBuffer) {
        buffer += decoder.decode(
          chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk,
          { stream: true }
        );
      } else {
        buffer += String(chunk);
      }

      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          onMessage(JSON.parse(line));
        } catch (err) {
          if (onError) onError(err, line);
        }
      }
    }

    return { feed, reset: () => { buffer = ''; } };
  }

  // Encode an object as a single newline-terminated UTF-8 line.
  function encodeLine(obj) {
    return new TextEncoder().encode(JSON.stringify(obj) + '\n');
  }

  /*
   * Derive a buddy state from a heartbeat snapshot.
   * Snapshot fields: total, running, waiting, msg, entries, tokens, tokens_today,
   * and optional `prompt` {id, tool, hint} when approval is pending.
   */
  function stateFromSnapshot(snap, opts) {
    opts = opts || {};
    if (snap.prompt && snap.prompt.id) return 'attention'; // approval pending
    if (snap.waiting > 0) return 'attention';
    if (snap.running > 0) return 'busy';
    if (opts.justFinished) return 'celebrate';
    if (opts.idleMs != null && opts.idleMs > (opts.sleepAfterMs || 90000)) return 'sleep';
    return 'idle';
  }

  // ---- message builders (device/web -> desktop) ----

  // Respond to a pending permission prompt.
  function permission(id, decision) {
    // decision: "once" (approve) | "deny"
    return { cmd: 'permission', id: id, decision: decision };
  }

  function setName(name)   { return { cmd: 'name', name: name }; }
  function setOwner(owner) { return { cmd: 'owner', name: owner }; }
  function unpair()        { return { cmd: 'unpair' }; }
  function statusRequest() { return { cmd: 'status' }; }

  // Time sync the desktop sends on connect: [epoch_seconds, tz_offset_seconds].
  function timeSync(date) {
    const d = date || new Date();
    // getTimezoneOffset() is in minutes; the wire format wants seconds.
    return { time: [Math.floor(d.getTime() / 1000), -d.getTimezoneOffset() * 60] };
  }

  // ---- ack builder (device -> desktop) ----
  // Every command the desktop sends expects a matching ack: {ack:<cmd>, ok, n?, ...}.
  function ack(cmd, fields) {
    return Object.assign({ ack: cmd, ok: true }, fields || {});
  }

  global.Protocol = {
    NUS, STATES,
    LineParser, encodeLine,
    stateFromSnapshot,
    permission, setName, setOwner, unpair, statusRequest, timeSync, ack,
  };
})(window);
