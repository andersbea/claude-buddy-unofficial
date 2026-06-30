# Claude Web Buddy

A browser version of [`claude-desktop-buddy`](https://github.com/anthropics/claude-desktop-buddy).
The original is ESP32 firmware for a physical desk pet that connects to Claude
Desktop over Bluetooth (Nordic UART Service) and reacts to what Claude is doing —
sleeping when idle, waking during a session, getting impatient on approval
prompts, and letting you approve/deny right from the device.

This web app reproduces that experience in the browser:

- **Seven animated states** — `sleep · idle · busy · attention · celebrate · dizzy · heart`
- **Multiple ASCII species** (bufo, blip, moth, crab), one animation set per state
- **Live stats** — sessions, running/waiting turns, token counts
- **Recent message feed** and a raw **wire log**
- **On-device approval** — approve/deny prompts with the A/B buttons
- **Bluetooth** — connects to another device over Web Bluetooth (Nordic UART)
- **Claude Desktop protocol** — speaks the exact JSON wire format from `REFERENCE.md`

## Run it

Web Bluetooth needs a secure context (Chrome or Edge, over `https://` or
`localhost`). Serve the folder and open it:

```bash
cd web
python3 -m http.server 8000
# then open http://localhost:8000 in Chrome or Edge
```

Click **Start Claude feed** to watch the buddy react to a simulated Claude
session, **Force approval prompt** to raise an approval, and **Connect device**
to pair a real Bluetooth buddy.

## How it maps to the original

| Firmware concept | Web equivalent |
|---|---|
| ESP32 + M5StickCPlus screen | `index.html` device frame + `<pre>` screen |
| `buddies/` ASCII species (7 animations each) | `js/buddy.js` |
| `ble_bridge.cpp` (Nordic UART, line-buffered TX/RX) | `js/ble.js` |
| `data.h` wire protocol / JSON schema | `js/protocol.js` |
| State machine in `main.cpp` | `js/app.js` |
| Claude Desktop heartbeat stream | `js/simulator.js` (faithful demo source) |

## Wire protocol

Identical to the firmware's `REFERENCE.md`:

- **Service** `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- **RX** (central → device) `6e400002-…`
- **TX** (device → central) `6e400003-…`
- UTF-8 JSON, one object per line, `\n`-terminated.
- Heartbeat snapshot: `{total, running, waiting, msg, entries, tokens, tokens_today, prompt?}`
- Turn event: `{"evt":"turn","role":"assistant","content":[…]}` (dropped if > 4KB)
- Permission response: `{"cmd":"permission","id":"…","decision":"once"|"deny"}`
- On connect: `{"time":[epoch, tzOffset]}` + `{"cmd":"owner","owner":"…"}`

## The Claude Desktop link — an honest note

The real integration works because Claude Desktop is a Bluetooth **central**
that dials into the buddy **peripheral**. The **Web Bluetooth API only supports
the central role** — a web page cannot advertise as a BLE peripheral, so it can
**not** be the literal device Claude Desktop connects to.

So this app implements the integration two ways, both protocol-faithful:

1. **As a central → real devices.** `Connect device` pairs with any peripheral
   exposing the Nordic UART Service (e.g. a real ESP32 buddy). The web buddy
   mirrors Claude's state and turn events to it, and the device's hardware-button
   approvals flow back as `permission` responses. This is the live Bluetooth path.

2. **Claude Desktop feed via the simulator.** `js/simulator.js` emits the exact
   heartbeat/turn/prompt JSON Claude Desktop sends and consumes the same
   `permission` responses, so the whole UI behaves identically to a live link.

To wire it to a *real* Claude Desktop instead of the simulator, run a small
native bridge that exposes the buddy peripheral to Claude Desktop and relays its
frames to this page over a WebSocket — then point `js/app.js`'s message source at
that socket instead of `ClaudeSimulator`. Everything downstream of
`Protocol.LineParser` is source-agnostic, so no other changes are needed.
