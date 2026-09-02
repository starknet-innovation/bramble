---
layout: default
title: PQ signer — Bluetooth transport
permalink: /pq-mobile-signer/ble-transport/
---

[Post-quantum mobile signer](../) · overview, milestones, and cross-cutting flows

# Bluetooth transport

The second transport for the paired-phone signer, built the way the wallet already connects a
Ledger over Bluetooth: a gesture-owning browser tab holds the live device, and the side panel drives
it through a validated per-session channel.

**This feature modifies no Ledger file.** `packages/platform/ledger-browser` and
`ledger-protocol` are owned by the wallet team and are expected to change. The tab-and-broker
pattern is therefore reused *by transcription*, and by importing only what is already generic. Two
attempts to reuse it by generalising the Ledger modules were abandoned for that reason; both would
have edited files this feature has no claim on.

## The mechanism being copied

Three files carry it today, and they are the reference:

| | |
| --- | --- |
| `ledger-browser/src/grant-transport.js:43` | `navigator.bluetooth.requestDevice(...)` called *synchronously off the click*. Chrome drops transient activation across an async preflight, which presents as a chooser that never appeared. |
| `ledger-browser/src/grant-window.ts:237` | opens `ledger-grant.html` with a random session capability in the URL fragment, resolves once the tab reports ready, then proxies typed calls to it. |
| `ledger-browser/src/broker-server.ts:56` | the tab side: serves one operation at a time against the retained client, over a `BroadcastChannel` both ends validate. |

Why a tab at all — **measured, for Bluetooth specifically.** `docs/ARCHITECTURE.md` records the
empty-chooser finding for the cable pickers ("reproduced with an unlocked Nano X and with an
unfiltered chooser"), which does not carry over on its own: Chromium uses a different chooser
controller for Bluetooth, one that scans rather than enumerating attached devices, and a side panel
— unlike the action popup — does not close when a native chooser takes focus. So it was tested
directly. See *The chooser cannot run in the side panel* below.

The other half needs no test: stable Chrome has no `Bluetooth.getDevices()`, so a grant cannot be
silently reopened later, and a `BluetoothDevice` is not structured-cloneable, so the chooser cannot
be run in one context and the device handed to another. Whichever context runs the chooser must keep
the transport for the whole operation.

### Mapping

| Ledger | PQ signer |
| --- | --- |
| `ledger-grant.html` + `src/ledger-grant/` | `pq-grant.html` + `src/pq-grant/`, its own build entrypoint in `apps/extension/build.ts` |
| service UUIDs from `@ledgerhq/devices` | one service UUID we define |
| `TransportWebBLE` (Ledger's APDU framing) | our own length-prefixed chunking — see below |
| `getOsVersion` / `getAppVersion` probe | protocol-version handshake |
| `getPubKey` / `signHash` | `pair` / `sign` |
| `LedgerRejection` catalog | a PQ rejection catalog, same fail-closed shape |
| `readiness: "verified"` | **not copied** — see *Freshness* |

## What is actually different

### There is no new wire format

The envelope and the reply already exist and both sides already agree on them:
`sidepanel/journeys/mobile/sign-envelope.ts` emits them and `Wire.kt` parses them. Signing is
asymmetric on purpose — a base64url JSON envelope out, a bare `0x` hex signature back — and pairing
is base64url JSON both ways.

**Bluetooth is a pipe for exactly those values.** It introduces no codec, no correlation id it does
not already carry, and no second contract to drift. The clipboard transport stays the CI path
because it exercises the same strings with no hardware.

### It is not an APDU-sized protocol

Measured from the current envelope and the pinned parameter set:

| Direction | Payload | As transported |
| --- | --- | --- |
| Sign request → phone | base64url JSON envelope | **~5.5 KB** — dominated by the 1952-byte public key rendered as hex, which is how `selectKey` matches |
| Sign reply → wallet | 3309-byte signature | **~6.6 KB** as a `0x` hex string |
| Pairing reply → wallet | 1952-byte key + 3309-byte proof | **~7 KB** as base64url JSON |

An APDU is tens of bytes. Every PQ operation is kilobytes, in both directions, so the transport is a
chunked byte stream rather than a command/response register. This is the single biggest structural
difference from the Ledger path and it drives the next two decisions.

### Decision: it is a string pipe, and carries no format of its own

An earlier draft here had the characteristics carry decoded bytes, with the tab encoding at its
edge, on the grounds that it halved airtime. **That was wrong and is not what was built.** Decoding
base64url saves about a quarter, not a half, and getting to a half would mean decoding the hex
*inside* the JSON — which is a new payload format, contradicting the section above.

So the pipe carries the exact strings the clipboard transport already carries. `Wire.kt` needs no
change at all: the phone reads a string off the characteristic and feeds its existing parser. The
cost is roughly 1.4 KB of base64url expansion on a 5.5 KB request, which is a fraction of a second
over BLE and buys a transport with no encode/decode layer to get wrong.

Both payload strings are base64url or lowercase hex, so they are ASCII: a character is a byte, and
the length prefix counts both.

### Decision: the side that can see the MTU owns the chunking

Web Bluetooth exposes no MTU control and no negotiated value. The phone can see it on both
platforms — Android `BluetoothGattServer.onMtuChanged`, iOS `CBPeripheralManager`'s
`maximumUpdateValueLength` — so the phone sizes its notifications and the extension only reassembles.

One service, two characteristics:

| Characteristic | Direction | Framing |
| --- | --- | --- |
| `request` | write | 4-byte big-endian length, then payload, in ≤512-byte `writeValue` frames (Chrome performs the long write) |
| `response` | notify | 4-byte big-endian length, then payload, in phone-sized chunks |

Reassembly is by the length header alone: no sequence numbers, because GATT delivers writes and
notifications in order on one connection, and a truncated stream fails closed on the length check.

### The phone is an app, not a device

It advertises only while foregrounded on a connect screen — iOS moves service UUIDs to an overflow
area in the background that only iOS centrals can read, and the app must be open to prompt for
biometrics anyway (already an accepted trade-off). So the grant tab's readiness steps say *open the
app and tap Connect*, where the Ledger tab says *enable Bluetooth and power the device off and on*.

### Freshness: do not copy `readiness`

`readiness: "verified"` lets the Ledger sign flow skip `assertLedgerDeviceReady`, and that skip is
load-bearing: `classifySignStatus` reads an ExecutionError as "blind signing is off" *because* the
pre-check already ruled out a locked or disconnected device. It is a claim about freshness, and a
claim about freshness must not outlive the thing it describes.

The PQ path needs no equivalent. The phone selects its key by the enrolled public key the envelope
names and refuses a chain it was not registered against, and the extension verifies every returned
signature against the enrolled key before broadcast. There is nothing to pre-check and therefore no
flag to go stale.

### Validators: an allowlist, and fixtures from the phone

The Ledger broker's `requireSignatureResponse` demands an exact key count of four. The pinned
`@ledgerhq/hw-app-starknet` returns five — `r`, `s`, and a recovery parity `v` — so **every**
Bluetooth signature has been rejected by the wallet's own validator since `1e5afca4` (2026-07-27).
The cable path bypasses the broker, so nothing caught it, and the test fixture was hand-written to
match the validator rather than the library: fixture and validator agreed, and both disagreed with
reality.

Two rules follow, and they are the reason this section exists:

1. Validate a **key allowlist plus lengths**, never a magic count. `hasOnlyKnownKeys` in
   `@mc-wallet/core/json` already does the first half.
2. **Generate fixtures from the phone's own emitter.** `EmitFixturesTest.kt` already writes
   `pairing-reply.txt` and `sign-response.txt` for exactly this purpose — "so the return direction
   can be checked against mc-wallet's own parsers". A fixture the wallet wrote for itself only ever
   proves the wallet agrees with itself.

## Layout

Nothing below touches an existing Ledger file.

```
packages/platform/pq-transport/          new workspace, edges: core, wallet-model
  src/protocol.ts                        broker command/response types + validators
  src/errors.ts                          PQ rejection catalog and copy
  src/grant-window.ts                    panel side: open tab, proxy, own lifecycle
  src/broker-server.ts                   tab side: serve one operation at a time
  src/gatt.ts                            service UUID, chunking, reassembly
apps/extension/src/pq-grant/index.ts     the tab: chooser, handshake, broker
apps/extension/public/pq-grant.html      + a build entrypoint in build.ts
```

Reused by import, unmodified: `isMlDsa65Signature` (`wallet-model/signing`), `isRecord` and
`hasOnlyKnownKeys` (`core/json`), and the existing `sign-envelope.ts` encoder.

Two one-line seams gain their second case, and both are built to force the compiler to list every
site that needs a branch:

- `wallet-model/src/accounts/derivations.ts:50` — `TransportDescriptor` gains `{ kind: "ble" }`.
- `pq-signer`'s `Transport.kt` — the sealed interface gains `Ble`, which makes every phone screen
  missing a branch a compile error.

## Known costs, already paid or measured

- **Brave disables Web Bluetooth by default**, behind a `brave://flags` entry. It exposes
  `navigator.bluetooth` while blocking discovery, so the chooser returns `NotFoundError` and reads
  as "no device found". Confirmed, and enabling the flag fixes it.
- **A chooser per operation.** Retention was spiked (one retained page keeps the grant for the
  browser session, chooser once per browser start) and deliberately left out: it needs a lifecycle
  the Ledger flow does not have, and per-operation grants work. Revisit only if the ceremony proves
  too heavy in use.
- **iOS advertises only in the foreground.** **Windows** requires the device to be OS-paired first;
  its Chrome path cannot scan. **Chrome-family browsers only** — no Safari, no Firefox.

## The chooser cannot run in the side panel

Worth stating with its evidence, because it is the single fact the tab, the broker, the session
capability and the cross-channel validators all exist to satisfy. Without it, the PQ sign overlay
already lives in the side panel and stays open for the whole ceremony, so the panel would be the
better host and two thirds of this design would be unnecessary.

**Measured, Brave 2026-09, macOS 26, Web Bluetooth flag enabled.** A button in the side panel calling
`navigator.bluetooth.requestDevice({ acceptAllDevices: true })` synchronously from its own click
rejected with `NotFoundError` **after 6 ms**, with no chooser window ever shown, while
`Bluetooth.getAvailability()` in the same handler returned `true`. Six milliseconds is the tell: a
chooser that opened and scanned takes seconds and reports the same `NotFoundError`, so the timing —
not the error — is what distinguishes "found nothing" from "never asked". An adapter that is off or
unreachable rejects instantly too, which is why availability was read in the same breath.

The control had already been run: in the same browser on the same machine, `ledger-grant.html` in an
ordinary tab paired a Nano X over Bluetooth and reached account selection.

| Context | Chooser | Why |
| --- | --- | --- |
| MV3 service worker | **No** | Web Bluetooth is not exposed on `WorkerNavigator`. This is why signing is parked in the background and carried by the panel today. |
| Offscreen document | **No** | Has a DOM but no transient activation, and a `BluetoothDevice` cannot be transferred from a context that has one. |
| Action popup | **No** | The native chooser takes focus, closing the popup and destroying the realm holding the promise. |
| Side panel | **No** | Measured above: instant `NotFoundError`, no chooser, healthy adapter. |
| Ordinary tab | **Yes** | What the Ledger flow does, and what this feature copies. |

To re-run it: the probe needs no phone and no GATT server, and `sidepanel.html` opened as an
ordinary tab loads the identical bundle, so the same button in both contexts changes one variable.

## Measured, on real hardware

Pixel 8 Pro (Android 17) as the GATT peripheral, Brave on macOS 26 as the central,
2026-09-02. A 5509-character payload — sized to a real signing envelope — round-tripped
**unchanged in 2792 ms**.

| | |
| --- | --- |
| Negotiated MTU | **517**, the maximum, so notifications carry 514 bytes |
| Write path | 5513 framed bytes in 11 acknowledged writes of ≤512 |
| Notify path | 5513 framed bytes in 11 notifications of ≤514 |
| Cost per round trip | **~127 ms**, and 22 of them account for the whole 2792 ms |

**The cost is round trips, not bytes.** 127 ms is the connection interval macOS chose, and
the MTU is already maxed, so the only lever left is sending fewer chunks. Extrapolating a
real signature — a 5.5 KB envelope out, a 6.6 KB hex reply back — gives roughly **3 seconds
of transport per transaction**, on top of however long the user takes to approve.

Three levers exist, in increasing order of how much they disturb:

1. **Unacknowledged writes.** `writeValueWithoutResponse` removes the per-chunk round trip
   on the way out. A lost chunk becomes a frame that never completes, so it fails as a
   timeout rather than as corruption — detectable, but a new failure mode for a saving of
   under a second.
2. **Send the reply as bytes, not hex.** 3309 bytes travel as 6620 hex characters, which is
   exactly double. The phone already holds the raw bytes and hexes them for the clipboard's
   benefit, so having the tab hex them instead halves the return path. It costs the "one
   string pipe, no format of its own" property: the frame decoder would need a byte path
   beside its strict-UTF-8 one.
3. **Stop sending the whole public key.** The envelope is 5.5 KB because a 1952-byte key is
   rendered as 3906 hex characters, and the phone uses it only to pick a key. An identifier
   would cut the envelope by about 95% — by far the biggest lever, and the one that reopens
   a settled decision: `KeySelection.kt` records that matching on the full key is "exact by
   construction", and that a `public_key_digest` field was proposed and retired twice.

None of these are worth doing before the flow is wired end to end. Three seconds works.

### macOS asks to set the phone up as a keyboard

Also measured, and it needs solving before anyone but us uses this. On first connect, macOS
raised a pairing code and then its Bluetooth Setup Assistant offered to configure the phone
**as a keyboard**.

Nothing in the GATT table asks for it: every characteristic and descriptor permission is the
plain variant, with no `_ENCRYPTED` or `_AUTHENTICATED` anywhere. It is macOS classifying a
connectable peripheral it cannot identify, and the likely trigger is the advertisement —
a device name in the scan response next to a 128-bit service UUID macOS does not know.

It must not be completed: an HID bond is a far broader trust relationship than a GATT service
needs. The first thing to try is dropping `setIncludeDeviceName(true)` from the scan response,
against the cost that the chooser then shows an unnamed device.

**It is once per laptop, not once per operation.** Measured: after disconnecting and
reconnecting, the browser's chooser appeared again and the pairing did not. So the OS bond
persists — and it buys nothing back, because Chrome's chooser still runs every time. That is
the same conclusion `Bluetooth.getDevices()` forces, now confirmed against hardware: bonding
costs a first-run ceremony and returns no silent reopen for it.

## Order of work

1. The GATT service and chunking on the phone, with a loopback test on the phone alone.
2. `pq-transport`'s protocol, validators, and errors, against fixtures emitted by `EmitFixturesTest`.
3. The grant tab: chooser, handshake, broker — the one part that needs real hardware.
4. `grant-window` on the panel side, then the second branch in the existing sign and onboard journeys.

Steps 1 and 2 need no hardware and no browser. Step 3 is where a phone and a flagged Brave are
required, and it is the only step that cannot be tested in CI.
