# Building the Android buddy (phone-as-peripheral)

This turns the web buddy into a native Android app that advertises the **Nordic
UART Service** as a BLE **peripheral**, so a central (Claude Desktop, or the web
app on another machine) can connect to the phone as if it were a real ESP32 buddy.

It is a [Capacitor](https://capacitorjs.com) wrapper around the existing `web/`
UI. The only thing that changes between web and native is the Bluetooth layer:

| | Browser (`web/`) | Native (this app) |
|---|---|---|
| BLE role | central — dials *out* (`js/ble.js`) | **peripheral** — advertises + accepts (`BlePeripheralPlugin.java`) |
| Message source | `js/simulator.js` | the connected central's RX writes |
| Approvals (A/B) | `sim.resolve` / relay | TX **notify** to the central |

`js/protocol.js`, `js/buddy.js` and the UI are shared verbatim — `app.js`
switches behaviour at runtime on `Capacitor.isNativePlatform()`.

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
npm install                 # already done once; installs Capacitor
npx cap sync android        # copy web/ assets + update native project

# then either:
npx cap open android        # opens Android Studio → press Run ▶ with phone plugged in
# or, with the SDK + a JDK 17/21 on PATH and a device connected:
npx cap run android
```

After changing anything under `web/`, re-run `npx cap copy android` (or `sync`)
before rebuilding — the native app serves a *copy* under
`android/app/src/main/assets/public`.

## Using it

1. Launch **Claude Buddy** on the phone. Grant the Bluetooth permission prompt
   (Android 12+ asks for "Nearby devices").
2. Tap **Start advertising**. Status shows "advertising — waiting for a connection".
3. Connect a central to it (see below). Incoming state animates the buddy; the
   **A / B** buttons send approve/deny back to the central.

## End-to-end test loop (no Claude Desktop, no HTTPS needed)

You can verify the whole BLE path using your Mac's web app as the central —
`localhost` is a secure context, so Web Bluetooth works there without HTTPS:

1. **Phone:** Claude Buddy → *Start advertising*.
2. **Mac:** serve the web app and open it in Chrome:
   ```bash
   cd web && python3 -m http.server 8000   # then open http://localhost:8000
   ```
3. **Mac:** click **Connect device**, pick "Claude Buddy" from the chooser.
4. **Mac:** click **Start Claude feed**. The simulated session streams over BLE to
   the phone — the phone's buddy reacts (busy / attention / etc.).
5. When an approval is raised, press **A**/**B** *on the phone*; the decision flows
   back to the Mac as a `permission` response (logged in the Mac's wire log).

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
