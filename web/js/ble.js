/*
 * ble.js — Web Bluetooth central for the Nordic UART Service.
 *
 * Web Bluetooth can only act as a *central* (it connects out to peripherals).
 * This connects to another device exposing the Nordic UART Service — e.g. a
 * real ESP32 buddy — so the web buddy can mirror state to it and receive its
 * button-press permission responses over the very same wire protocol that
 * Claude Desktop uses.
 */
(function (global) {
  'use strict';

  const { NUS, LineParser, encodeLine } = global.Protocol;

  function BleLink(handlers) {
    handlers = handlers || {};
    let device = null;
    let rxChar = null; // we write here  (-> device)
    let txChar = null; // device notifies (<- device)
    const parser = LineParser(
      (msg) => handlers.onMessage && handlers.onMessage(msg),
      (err, line) => handlers.onLog && handlers.onLog('warn', 'bad line: ' + line)
    );

    function supported() {
      return typeof navigator !== 'undefined' && !!navigator.bluetooth;
    }

    async function connect() {
      if (!supported()) {
        throw new Error('Web Bluetooth is not available. Use Chrome/Edge over https:// or localhost.');
      }
      log('info', 'requesting device…');
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [NUS.SERVICE] }],
        optionalServices: [NUS.SERVICE],
      });
      device.addEventListener('gattserverdisconnected', onDisconnected);

      log('info', 'connecting to ' + (device.name || 'device') + '…');
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(NUS.SERVICE);
      rxChar = await service.getCharacteristic(NUS.RX);
      txChar = await service.getCharacteristic(NUS.TX);

      await txChar.startNotifications();
      txChar.addEventListener('characteristicvaluechanged', (e) => {
        parser.feed(e.target.value.buffer);
      });

      log('ok', 'connected to ' + (device.name || 'device'));
      if (handlers.onConnect) handlers.onConnect(device);
      return device;
    }

    function onDisconnected() {
      rxChar = txChar = null;
      log('warn', 'device disconnected');
      if (handlers.onDisconnect) handlers.onDisconnect();
    }

    async function disconnect() {
      if (device && device.gatt && device.gatt.connected) {
        device.gatt.disconnect();
      } else {
        onDisconnected();
      }
    }

    // Send one protocol object as a framed line. Chunk to respect MTU.
    async function send(obj) {
      if (!rxChar) throw new Error('not connected');
      const bytes = encodeLine(obj);
      const CHUNK = 180; // safe under common 185-byte ATT MTU
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const slice = bytes.slice(i, i + CHUNK);
        if (rxChar.writeValueWithoutResponse) {
          await rxChar.writeValueWithoutResponse(slice);
        } else {
          await rxChar.writeValue(slice);
        }
      }
    }

    function connected() {
      return !!(device && device.gatt && device.gatt.connected);
    }

    function log(level, m) { handlers.onLog && handlers.onLog(level, m); }

    return { supported, connect, disconnect, send, connected, get device() { return device; } };
  }

  global.BleLink = BleLink;
})(window);
