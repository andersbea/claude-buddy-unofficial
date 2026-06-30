# Building the Android buddy (phone-as-peripheral)

This turns the web buddy into a native Android app that advertises the **Nordic
UART Service** as a BLE **peripheral**, so a central (Claude Desktop, or the web
app on another machine) can connect to the phone as if it were a real ESP32 buddy.

It is a [Capacitor](https://capacitorjs.com) wrapper around the React app
(`src/`, built to `dist/`). The only thing that changes between web and native is
the message/Bluetooth layer:

| | Browser | Native (this app) |
|---|---|---|
| BLE role | — (uses the simulator) | **peripheral** — advertises + accepts (`BlePeripheralPlugin.java`) |
| Message source | `src/lib/simulator.ts` | the connected central's RX writes |
| Approvals (A/B) | `sim.resolve` | TX **notify** to the central |

`src/lib/protocol.ts`, `src/lib/buddy.ts` and the components are shared — the
`useBuddy` hook switches behaviour at runtime on `isNative()`.

## Why a native app at all

Web Bluetooth (in any browser, Android Chrome included) can only be a BLE
*central*. It has no API to advertise as a peripheral. To be the device Claude
Desktop connects *to*, you need native BLE peripheral APIs — hence Capacitor +
the custom `BlePeripheral` plugin (`android/app/src/main/java/se/swimbird/claudebuddy/BlePeripheralPlugin.java`).

## Prerequisites

- **Android Studio** (bundles a compatible JDK — easiest path). Install it, then
  open it once so it downloads the Android SDK.
  - Note: this machine has JDK 25, which is newer than Gradle/AGP support. Build
    through Android Studio so it uses its **bundled JDK 21**, or point
    `org.gradle.java.home` / `JAVA_HOME` at a JDK 17 or 21 for command-line builds.
- An **Android 12+ phone** with **Developer options → USB debugging** enabled.
- Node 18+ (already used to scaffold).

## Build & install

```bash
# from the repo root
npm install                 # installs React/Vite/Capacitor/etc.
npm run build               # build the web app into dist/ (Capacitor's webDir)
npx cap sync android        # copy dist/ assets + update native project

# then either:
npx cap open android        # opens Android Studio → press Run ▶ with phone plugged in
# or, with the SDK + a JDK 17/21 on PATH and a device connected:
npx cap run android
```

After any web change, re-run `npm run build && npx cap copy android` before
rebuilding — the native app serves a *copy* of `dist/` under
`android/app/src/main/assets/public`. (Editing `src/` alone does nothing to the
installed APK until you rebuild + copy.)

## Using it

1. Launch **Claude Buddy** on the phone. Grant the Bluetooth permission prompt
   (Android 12+ asks for "Nearby devices").
2. Tap **Start advertising**. Status shows "advertising — waiting for a connection".
3. Connect a central to it (see below). Incoming state animates the buddy; the
   **A / B** buttons send approve/deny back to the central.

## End-to-end test loop (no Claude Desktop)

The old in-browser "Connect device" central isn't ported to the React app yet, so
to exercise the phone's BLE path without Claude Desktop, drive it from the Mac
with a small [`bleak`](https://github.com/hbldh/bleak) script (subscribe to TX,
send `{"cmd":"status"}` / a `prompt` heartbeat to RX, read the device's replies).
This is exactly how the protocol path was validated during the bonding/"No
response" debugging — see the [[build-state]] memory for the scripts and gotchas.

Otherwise, test against **Claude Desktop** directly: enable Developer Mode
(Help → Troubleshooting), Developer → Open Hardware Buddy, and connect to the
advertised "Claude …" device. Heads-up: clearing a stale pairing requires
**System Settings → Bluetooth → Forget**, not just Claude Desktop's "Forget".

This exercises exactly the same wire protocol Claude Desktop uses.

## Connecting the real Claude Desktop

The full wire spec is vendored at `docs/REFERENCE.md` (from
[anthropics/claude-desktop-buddy](https://github.com/anthropics/claude-desktop-buddy)).
Key points, and how this app handles them:

1. **Enable the bridge in Claude Desktop:** Help → Troubleshooting → **Enable
   Developer Mode**, then **Developer → Open Hardware Buddy…**, click **Connect**,
   and pick "Claude Buddy" from the scan list. (The picker filters to names
   starting with `Claude` — our default advertised name.)
2. **No pairing required.** Per the spec, "the desktop app connects whether or
   not your device requests link encryption." So this app connects unbonded out
   of the box. Bonding (LE Secure Connections) is a *recommended* security
   upgrade — see below — not a prerequisite.
3. **Acks are required and implemented.** The desktop polls `{"cmd":"status"}`
   every couple of seconds and sends `name`/`owner`/`unpair`; each expects a
   matching `{"ack":…,"ok":true}`. `app.js` → `handleCommand()` answers all of
   them. The folder-push protocol is declined (we don't ack `char_begin`).

If Desktop connects but the buddy doesn't react, watch the wire log — incoming
heartbeats should appear. If it connects then drops, the status ack is the first
suspect.

### Still optional / not done

- **Link encryption (bonding).** We report `sec: false` in the status ack. To
  make transcript snippets sniff-proof, mark the NUS characteristics + TX CCCD
  encrypted-only and advertise DisplayOnly IO capability so the OS triggers a
  passkey pairing. Requires extending `BlePeripheralPlugin.java`.
- **Real battery/system stats.** The status ack omits `bat`/`sys`/`stats`; a
  phone could report real battery via a Capacitor plugin.

## Permissions / privacy notes

- Declared in `AndroidManifest.xml`: `BLUETOOTH_ADVERTISE` + `BLUETOOTH_CONNECT`
  (Android 12+), legacy `BLUETOOTH`/`BLUETOOTH_ADMIN` (≤ Android 11).
- **No location permission** is requested — this app only advertises and serves a
  GATT server, it never scans, so location isn't required.
