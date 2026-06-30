# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A reimplementation of `claude-desktop-buddy` (ESP32 firmware for a physical desk pet). It ships in **two forms from one shared UI** under `web/`:

1. **Browser app** — vanilla JS, no bundler. Acts as a BLE *central* and uses `js/simulator.js` as a stand-in Claude feed.
2. **Native Android app** — the same `web/` wrapped with **Capacitor**, acting as a BLE *peripheral* so Claude Desktop can connect *to the phone*. See `BUILDING-ANDROID.md`.

The web side has **no build step and no test suite** — files are served as-is. The repo root holds the Capacitor project (`package.json`, `capacitor.config.json`, `android/`); `web/` is Capacitor's `webDir`.

## Running

**Browser** (Web Bluetooth needs a secure context — Chrome/Edge over `https://` or `localhost`):

```bash
cd web && python3 -m http.server 8000   # open http://localhost:8000
```

**Android**: `npx cap sync android && npx cap open android` (then Run ▶). Re-run `npx cap copy android` after any `web/` change — the native app serves a *copy* under `android/app/src/main/assets/public`. Full details + the end-to-end BLE test loop are in `BUILDING-ANDROID.md`.

In the UI: **Start Claude feed** runs the simulated session, **Force approval prompt** raises an approval, **Connect device** pairs a real Bluetooth peripheral (browser/central mode), **Start advertising** exposes the phone as a buddy peripheral (native mode).

## Architecture

Plain `<script>` tags load five files in dependency order (`web/index.html`); each attaches a single global to `window` (`Protocol`, `Buddy`, `BleLink`, `ClaudeSimulator`, plus the `app.js` IIFE). There are no modules or imports.

The central design principle: **everything downstream of `Protocol.LineParser` is source-agnostic.** Messages are UTF-8 JSON, one object per line, `\n`-terminated — the exact wire format from the firmware's `REFERENCE.md`. Both message sources (the simulator and a real BLE device) produce the same parsed objects, so the rest of the app doesn't know or care which is feeding it.

Data flow (`web/js/app.js` is the wiring hub):

```
Claude Desktop feed (simulator or real) --\
                                           >-- handleMessage() --> buddy state / stats / messages
ESP32 buddy device (Web Bluetooth)      --/
                                           \-- approvals flow back as Protocol.permission() responses,
                                               mirrored to the BLE device to keep a physical buddy in sync
```

- **`protocol.js`** — `Protocol` global: NUS UUIDs, the seven canonical states, `LineParser` (byte/string accumulator that emits parsed JSON objects on `\n`), `encodeLine`, `stateFromSnapshot` (maps a heartbeat to a buddy state), and message builders (`permission`, `setName`, `setOwner`, `timeSync`, …). The single source of truth for the wire format.
- **`buddy.js`** — `Buddy` global: `SPECIES` (bufo/blip/moth/crab, each with 7 ASCII state animations + colors + per-state tempo) and `Animator(el)`, which cycles frames on a `<pre>` element.
- **`ble.js`** — `BleLink`: Web Bluetooth **central** for the Nordic UART Service. Connects out to a peripheral, feeds RX notifications through a `LineParser`, chunks writes under the ATT MTU.
- **`simulator.js`** — `ClaudeSimulator`: a state-machine demo source emitting the *exact* JSON Claude Desktop sends. `resolve(id, decision)` consumes permission responses just like a real device button press. Browser mode only.
- **`ble-peripheral.js`** — `BlePeripheral`: native-only transport, the mirror image of `ble.js`. The phone *is* the device: a central's RX writes feed `Protocol.LineParser` → `onMessage`; approvals go back via `send()` → TX notify. Bridges to the native plugin via `Capacitor.registerPlugin('BlePeripheral')`; `isNative()` is false in a plain browser.
- **`app.js`** — IIFE that owns the DOM, routes messages, manages the approval flow and the 90s idle→sleep timer (firmware default). Branches on `const native = BlePeripheral.isNative()`: in browser mode the simulator + central drive it; in native mode the peripheral is both the message source and the upstream sink for approvals (`resolvePrompt` notifies the central directly instead of `sim.resolve`).

### Native plugin (`android/app/src/main/java/se/swimbird/claudebuddy/`)

- **`BlePeripheralPlugin.java`** — custom Capacitor plugin (Java, to avoid adding Kotlin Gradle config). Runs a `BluetoothGattServer` advertising NUS: RX = central writes (emitted to JS as `rx` events, base64), TX = notify (queued + paced by `onNotificationSent`, chunked to the negotiated MTU). Methods `initialize`/`startAdvertising`/`stopAdvertising`/`notify`/`isSupported`; events `rx`/`connected`/`disconnected`. Requests `BLUETOOTH_ADVERTISE`+`BLUETOOTH_CONNECT` at runtime on API 31+; no location permission (it never scans).
- **`MainActivity.java`** — registers the plugin via `registerPlugin(BlePeripheralPlugin.class)` *before* `super.onCreate`.

## Key constraints

- **Web Bluetooth is central-only.** A web *page* cannot advertise as a BLE peripheral — this is why the browser build uses the simulator and connects *out* to peripherals, and why being the device Claude Desktop dials into requires the **native** build (Capacitor + the `BlePeripheral` plugin). When touching the BLE layer, remember the two modes are mirror images: `ble.js` (central, writes RX / reads TX) vs `ble-peripheral.js` + the plugin (peripheral, reads RX / notifies TX).
- **Wire spec is upstream** at [anthropics/claude-desktop-buddy `REFERENCE.md`](https://github.com/anthropics/claude-desktop-buddy/blob/main/REFERENCE.md) — the authoritative source for the protocol; `docs/REFERENCE.md` is just a pointer + the NUS UUIDs. Notable: the desktop connects **without pairing** (bonding is an optional security upgrade), and **every `cmd` message it sends expects a matching ack** (`status` is polled every ~2s). Native mode answers these in `app.js` → `handleCommand()`. Not yet implemented: LE Secure bonding (we report `sec:false`) and real battery stats. Connecting requires Developer Mode in Claude Desktop (Help → Troubleshooting). See `BUILDING-ANDROID.md`.
- **Wire compatibility is the contract.** When changing message shapes, keep `protocol.js` aligned with the firmware's `REFERENCE.md` and the schemas in `web/README.md` (heartbeat snapshot fields, `turn` events dropped if >4KB, `permission`/`owner`/`time` messages). The simulator must emit, and `LineParser` consumers must accept, the same shapes a real device does.
- **The seven states** (`sleep · idle · busy · attention · celebrate · dizzy · heart`) are canonical — every species in `buddy.js` must define all seven, and they're listed in escalation order in `Protocol.STATES`.
