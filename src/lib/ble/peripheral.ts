/*
 * peripheral.ts — native BLE *peripheral* transport (Capacitor / Android).
 *
 * The phone IS the buddy device: it advertises the Nordic UART Service and a
 * central (Claude Desktop) connects to it. Central RX writes feed a LineParser
 * → onMessage; approvals/acks go back via send() → TX notify. Bridges to the
 * native plugin (see android/.../BlePeripheralPlugin.java).
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { LineParser, encodeLine, type WireMessage } from '../protocol';

interface BlePeripheralPlugin {
  initialize(): Promise<{ supported: boolean; enabled: boolean }>;
  isSupported(): Promise<{ supported: boolean; enabled: boolean }>;
  startAdvertising(opts: { name: string }): Promise<{ advertising: boolean }>;
  stopAdvertising(): Promise<void>;
  notify(opts: { value: string }): Promise<void>;
  unpair(): Promise<void>;
  disconnectCentral(): Promise<{ disconnected: number }>;
  forgetClaude(): Promise<{ forgot: number }>;
  addListener(
    event: 'rx',
    cb: (ev: { value: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'connected' | 'disconnected',
    cb: (ev: { deviceId?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const Plugin = registerPlugin<BlePeripheralPlugin>('BlePeripheral');

export const isNative = (): boolean => Capacitor.isNativePlatform();

const b64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const bytesToB64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

export type LogLevel = 'ok' | 'info' | 'warn' | 'err';

export interface PeripheralHandlers {
  onMessage?: (msg: WireMessage) => void;
  onConnect?: (deviceId: string) => void;
  onDisconnect?: (deviceId: string) => void;
  onLog?: (level: LogLevel, msg: string) => void;
}

export interface PeripheralLink {
  start(name: string): Promise<string>;
  stop(): Promise<void>;
  send(obj: unknown): Promise<void>;
  /** Erase the OS bond (desktop "Forget") so the next pairing is fresh. */
  unpair(): Promise<void>;
  disconnect(): Promise<{ disconnected: number }>;
  forget(): Promise<{ forgot: number }>;
  advertising(): boolean;
  connected(): boolean;
  /** Remove the plugin event listeners (call on teardown). */
  destroy(): Promise<void>;
}

export function createPeripheralLink(handlers: PeripheralHandlers = {}): PeripheralLink {
  const parser = new LineParser(
    (msg) => handlers.onMessage?.(msg),
    (_err, line) => handlers.onLog?.('warn', 'bad line from central: ' + line),
  );

  let advertising = false;
  let connected = false;

  // Keep the listener handles so they can be removed on teardown — otherwise a
  // remount (incl. React StrictMode's dev double-mount) would stack duplicate
  // listeners and handle every message more than once.
  const handles = [
    Plugin.addListener('rx', (ev) => {
      if (ev?.value) parser.feed(b64ToBytes(ev.value));
    }),
    Plugin.addListener('connected', (ev) => {
      connected = true;
      parser.reset();
      handlers.onConnect?.(ev?.deviceId ?? 'central');
    }),
    Plugin.addListener('disconnected', (ev) => {
      connected = false;
      parser.reset();
      handlers.onDisconnect?.(ev?.deviceId ?? 'central');
    }),
  ];

  return {
    async start(name: string): Promise<string> {
      const init = await Plugin.initialize();
      if (!init.supported) throw new Error('This device cannot act as a BLE peripheral');
      if (!init.enabled) throw new Error('Bluetooth is off — turn it on, then start advertising');
      // The desktop picker filters to names starting with "Claude" (REFERENCE.md).
      let advName = name || 'Claude Buddy';
      if (!/^claude/i.test(advName)) advName = 'Claude ' + advName;
      const res = await Plugin.startAdvertising({ name: advName });
      advertising = !!res.advertising;
      return advName;
    },
    async stop(): Promise<void> {
      try {
        await Plugin.stopAdvertising();
      } finally {
        advertising = false;
        connected = false;
      }
    },
    async send(obj: unknown): Promise<void> {
      await Plugin.notify({ value: bytesToB64(encodeLine(obj)) });
    },
    async unpair(): Promise<void> {
      await Plugin.unpair();
    },
    async destroy(): Promise<void> {
      for (const h of handles) {
        try { (await h).remove(); } catch { /* ignore */ }
      }
    },
    disconnect: () => Plugin.disconnectCentral(),
    forget: () => Plugin.forgetClaude(),
    advertising: () => advertising,
    connected: () => connected,
  };
}
