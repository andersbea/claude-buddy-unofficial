# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A reimplementation of `claude-desktop-buddy` (ESP32 firmware for a physical desk pet). It ships in **two forms from one shared React app** under `src/`:

1. **Browser app** — acts as a BLE *central* and uses `src/lib/simulator.ts` as a stand-in Claude feed.
2. **Native Android app** — the same app wrapped with **Capacitor**, acting as a BLE *peripheral* so Claude Desktop can connect *to the phone*. See `BUILDING-ANDROID.md`.

Stack: **React + TypeScript + Vite**, **Tailwind v4** (theming via CSS variables), **Lucide** icons, **Vitest** + Testing Library. The repo root holds the Vite + Capacitor project (`package.json`, `vite.config.ts`, `capacitor.config.json`, `android/`); `vite build` outputs to `dist/`, which is Capacitor's `webDir`.

## Running

```bash
npm install
npm run dev        # Vite dev server (Web Bluetooth needs localhost/https)
npm test           # Vitest (protocol, stats, components)
npm run typecheck  # tsc --noEmit
npm run build      # type-check + build to dist/
```

**Android**: `npm run build && npx cap sync android && npx cap open android` (then Run ▶). Re-run `npm run build && npx cap copy android` after web changes — the native app serves a *copy* of `dist/` under `android/app/src/main/assets/public`. Full details in `BUILDING-ANDROID.md`.

In the UI, the ⚙ settings sheet has: **Start Claude feed** (simulated session) + **Force prompt** in browser mode; **Start advertising** / **Disconnect** / **Forget pairing** in native mode; plus a **theme** toggle, name, and species.

## Architecture

The central design principle: **everything downstream of `protocol.LineParser` is source-agnostic.** Messages are UTF-8 JSON, one object per line, `\n`-terminated. Both message sources (the simulator and a real BLE central) produce the same parsed objects, so the rest of the app doesn't care which is feeding it.

- **`src/lib/`** — framework-free, unit-tested core:
  - `protocol.ts` — NUS UUIDs (the single source of truth), the seven states, `LineParser` (byte-accumulating parser robust to split multi-byte UTF-8), `encodeLine`, `stateFromSnapshot`, and message builders (`permission`, `setName`, `timeSync`, `ack`, …) with full TS types.
  - `buddy.ts` — `SPECIES` (bufo/blip/moth/crab, each with 7 ASCII state animations + tempo) and frame helpers.
  - `stats.ts` — pure gamified-stat reducers/derivations (mood/fed/energy/level → `appr/deny/vel/nap/lvl`).
  - `simulator.ts` — `ClaudeSimulator`: emits the exact JSON Claude Desktop sends; `resolve()` consumes permission responses. Browser only.
  - `ble/peripheral.ts` — native transport: a central's RX writes feed `LineParser`; approvals/acks go back via `send()` → TX notify. Bridges the native plugin via `registerPlugin('BlePeripheral')`; `isNative()` is false in a plain browser.
  - `icons.ts` — single source for all Lucide icons.
- **`src/hooks/`** — `useBuddy` (the wiring hub: routes messages via `handleMessage`, owns the connection controller, the 90s idle→sleep timer, approvals, stats, name persistence, IMU), `useBuddyAnimation`, `useTheme`.
- **`src/components/`** — small reusable components: `Pips`, `Gauge`, `Counters`, `Ticker`, `BuddyScreen`, `StatusStrip`, `ApprovalPrompt`, `ConnectButton`, `ActionZone`, `SettingsSheet`, `Device`.

`useBuddy` branches on `isNative()`: in browser mode the simulator drives it; in native mode the peripheral is both the message source and the sink for approvals (`resolvePrompt` notifies the central directly instead of `sim.resolve`).

### Native plugin (`android/app/src/main/java/se/swimbird/claudebuddy/`)

- **`BlePeripheralPlugin.java`** — custom Capacitor plugin (Java, to avoid adding Kotlin Gradle config). Runs a `BluetoothGattServer` advertising NUS: RX = central writes (emitted to JS as `rx` events, base64), TX = notify (queued + paced by `onNotificationSent`, chunked to the negotiated MTU). Methods `initialize`/`startAdvertising`/`stopAdvertising`/`notify`/`isSupported`; events `rx`/`connected`/`disconnected`. Requests `BLUETOOTH_ADVERTISE`+`BLUETOOTH_CONNECT` at runtime on API 31+; no location permission (it never scans).
- **`MainActivity.java`** — registers the plugin via `registerPlugin(BlePeripheralPlugin.class)` *before* `super.onCreate`.

## Key constraints

- **Web Bluetooth is central-only.** A web *page* cannot advertise as a BLE peripheral — this is why the browser build uses the simulator, and why being the device Claude Desktop dials into requires the **native** build (Capacitor + the `BlePeripheral` plugin). (The browser-as-central "connect to a real ESP32" path from the old vanilla app is not yet ported to React.)
- **Wire spec is upstream** at [anthropics/claude-desktop-buddy `REFERENCE.md`](https://github.com/anthropics/claude-desktop-buddy/blob/main/REFERENCE.md) — the authoritative source; `docs/REFERENCE.md` is a pointer + the NUS UUIDs. Notable: **every `cmd` message the desktop sends expects a matching ack** (`status` is polled every ~2s), answered in `useBuddy` → `handleCommand()`. **The status ack must include `bat` and `sys`** or the desktop panel shows "No response" (despite the spec calling them optional). The device runs **unencrypted / no-bond by design** (`sec:false`) — bonding was tried and reverted because it makes macOS cache the GATT and skip re-subscribing after the phone app restarts. Connecting requires Developer Mode in Claude Desktop (Help → Troubleshooting). See `BUILDING-ANDROID.md` and the [[build-state]] memory.
- **Wire compatibility is the contract.** When changing message shapes, keep `src/lib/protocol.ts` aligned with the upstream `REFERENCE.md` (heartbeat snapshot fields, `turn` events dropped if >4KB via `wireByteLength`/`TURN_MAX_BYTES`, `permission`/`owner`/`time` messages). The simulator must emit, and `LineParser` consumers must accept, the same shapes a real device does. Cover changes with tests in `src/lib/*.test.ts`.
- **The seven states** (`sleep · idle · busy · attention · celebrate · dizzy · heart`) are canonical — every species in `buddy.ts` must define all seven (asserted by `buddy.test.ts`), and they're listed in escalation order in `STATES`. `sleep` means "bridge not connected" and is driven by the connection layer, not `stateFromSnapshot`.
