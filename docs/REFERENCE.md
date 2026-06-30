# Hardware Buddy BLE Protocol — reference

This project implements Anthropic's **Hardware Buddy** BLE wire protocol. The full,
authoritative spec lives upstream — refer to it rather than a copy:

➡ https://github.com/anthropics/claude-desktop-buddy/blob/main/REFERENCE.md

It covers the heartbeat snapshot, turn events, permission decisions, commands/acks,
the folder-push transport, and security/pairing.

## Quick reference

Transport is the **Nordic UART Service** (UTF-8 JSON, one object per line, `\n`-terminated):

| Role                          | UUID                                   |
| ----------------------------- | -------------------------------------- |
| Service                       | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| RX (central → device, write)  | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` |
| TX (device → central, notify) | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` |

Advertise a name starting with `Claude` so the desktop picker can filter to you. A
permission prompt arrives inside a heartbeat as `waiting > 0` plus a `prompt` object
(`{id, tool, hint}`); answer with `{"cmd":"permission","id":<id>,"decision":"once"|"deny"}`.
