/*
 * ble-peripheral.js — native BLE *peripheral* transport (Capacitor / Android).
 *
 * This is the mirror image of ble.js. Where ble.js makes the browser a BLE
 * central that dials OUT to a device, this makes the phone the buddy *device*:
 * it advertises the Nordic UART Service and accepts a connection from a central
 * (Claude Desktop, or the web app running on another machine).
 *
 * Role mapping (see protocol.js / BlePeripheralPlugin.java):
 *   - central WRITES to RX  -> plugin 'rx' event -> Protocol.LineParser -> onMessage
 *   - we NOTIFY on TX        -> send() -> plugin.notify()
 *
 * Only active in the native Capacitor WebView; in a plain browser isNative()
 * returns false and app.js keeps using the simulator + central path.
 */
(function (global) {
  'use strict';

  const Cap = global.Capacitor;

  function isNative() {
    return !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  }

  // base64 <-> bytes, kept local so this file has no dependencies beyond Protocol.
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function BlePeripheralLink(handlers) {
    handlers = handlers || {};
    const P = global.Protocol;
    // Prefer registerPlugin (present when @capacitor/core is bundled); fall back
    // to the native bridge's Plugins proxy, which is what a no-bundler app gets.
    const plugin = (typeof Cap.registerPlugin === 'function' && Cap.registerPlugin('BlePeripheral'))
      || (Cap.Plugins && Cap.Plugins.BlePeripheral);
    if (!plugin) throw new Error('BlePeripheral native plugin not available');

    const parser = P.LineParser(
      (msg) => handlers.onMessage && handlers.onMessage(msg),
      (err, line) => handlers.onLog && handlers.onLog('warn', 'bad line from central: ' + line)
    );

    let advertising = false;
    let connected = false;

    plugin.addListener('rx', (ev) => {
      if (ev && ev.value) parser.feed(b64ToBytes(ev.value));
    });
    plugin.addListener('connected', (ev) => {
      connected = true;
      parser.reset();
      handlers.onConnect && handlers.onConnect((ev && ev.deviceId) || 'central');
    });
    plugin.addListener('disconnected', (ev) => {
      connected = false;
      parser.reset();
      handlers.onDisconnect && handlers.onDisconnect((ev && ev.deviceId) || 'central');
    });

    async function start(name) {
      const init = await plugin.initialize();
      if (!init.supported) throw new Error('This device cannot act as a BLE peripheral');
      if (!init.enabled) throw new Error('Bluetooth is off — turn it on, then start advertising');
      // The desktop picker filters to names starting with "Claude" (REFERENCE.md),
      // so the advertised name MUST start with it.
      let advName = name || 'Claude Buddy';
      if (!/^claude/i.test(advName)) advName = 'Claude ' + advName;
      const res = await plugin.startAdvertising({ name: advName });
      advertising = !!res.advertising;
      return advName;
    }

    async function stop() {
      try { await plugin.stopAdvertising(); } finally { advertising = false; connected = false; }
    }

    // Send one protocol object upstream to the connected central via TX notify.
    async function send(obj) {
      await plugin.notify({ value: bytesToB64(P.encodeLine(obj)) });
    }

    // Drop stale links and (re)advertise so a stuck central reconnects cleanly.
    async function reconnect() {
      const res = await plugin.reconnect();
      advertising = !!(res && res.advertising);
    }

    // Erase the OS bond (desktop "Forget") so the next pairing is fresh.
    async function unpair() {
      if (plugin.unpair) { try { await plugin.unpair(); } catch (_) {} }
    }

    // User-driven recovery from the phone:
    async function disconnect() {
      return plugin.disconnectCentral ? plugin.disconnectCentral() : null;
    }
    async function forget() {
      return plugin.forgetClaude ? plugin.forgetClaude() : { forgot: 0 };
    }

    return {
      start, stop, send, reconnect, unpair, disconnect, forget,
      advertising: () => advertising,
      connected: () => connected,
    };
  }

  global.BlePeripheral = { isNative, BlePeripheralLink };
})(window);
