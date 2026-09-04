/**
 * The panel-to-device-tab channel boundary. Both ends treat every message as
 * untrusted, so these tests are mostly about what must be REFUSED: an unknown
 * field, an unknown error code, a payload that is not the right grammar, an id
 * that is not a positive integer, and a session capability that did not come
 * from the panel.
 *
 * The key-allowlist assertions are the point. The Ledger broker validates an
 * exact key count against a library that returns one more field than it expects,
 * which rejected every Bluetooth signing reply it ever saw — and its fixture was
 * written to match the count, so fixture and validator agreed with each other
 * and not with the device. An allowlist cannot drift that way, and the payload
 * fixtures here are shapes only: the real ones come from the phone's
 * `EmitFixturesTest`.
 */
import { describe, expect, test } from "bun:test";
import {
  asPqRejection,
  isPqRejectionCode,
  PqRejection,
  pqMessage,
} from "@mc-wallet/pq-transport/errors";
import { PQ_MAX_PAYLOAD_BYTES } from "@mc-wallet/pq-transport/framing";
import {
  isPqBrokerCommand,
  isPqBrokerResponse,
  isPqSignedReply,
  isPqTransportPayload,
  PQ_BROKER_CHANNEL_PREFIX,
  pqBrokerChannelName,
  pqBrokerSessionFromHash,
} from "@mc-wallet/pq-transport/protocol";

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const OFFER = "eyJjaGFsbGVuZ2UiOiIweDEifQ";
const SIGNED_REPLY = `0x${"ab".repeat(3309)}`;

describe("session capability", () => {
  test("accepts only a v4 UUID from the session fragment", () => {
    expect(pqBrokerSessionFromHash(`#session=${SESSION_ID}`)).toBe(SESSION_ID);
    expect(pqBrokerChannelName(SESSION_ID)).toBe(`${PQ_BROKER_CHANNEL_PREFIX}${SESSION_ID}`);
  });

  test("refuses a fragment a device page could have been opened with directly", () => {
    expect(pqBrokerSessionFromHash("")).toBeNull();
    expect(pqBrokerSessionFromHash("#session=")).toBeNull();
    expect(pqBrokerSessionFromHash("#other=abc")).toBeNull();
    expect(pqBrokerSessionFromHash(`#session=${SESSION_ID}extra`)).toBeNull();
    // Not a v4 UUID: the variant nibble is wrong.
    expect(pqBrokerSessionFromHash("#session=00000000-0000-3000-8000-000000000001")).toBeNull();
    expect(pqBrokerSessionFromHash("#session=%E0%A4%A")).toBeNull();
  });

  test("uses its own channel namespace, so a Ledger message cannot be read as a phone command", () => {
    expect(PQ_BROKER_CHANNEL_PREFIX).not.toBe("mc-wallet-ledger-v1:");
  });
});

describe("payload validators", () => {
  test("accepts a base64url request within one frame and refuses anything else", () => {
    expect(isPqTransportPayload(OFFER)).toBe(true);
    expect(isPqTransportPayload("")).toBe(false);
    // base64url has no padding, no `+`, and no `/`.
    expect(isPqTransportPayload("eyJhIjoxfQ==")).toBe(false);
    expect(isPqTransportPayload("ab+cd")).toBe(false);
    expect(isPqTransportPayload("ab/cd")).toBe(false);
    expect(isPqTransportPayload("x".repeat(PQ_MAX_PAYLOAD_BYTES))).toBe(true);
    expect(isPqTransportPayload("x".repeat(PQ_MAX_PAYLOAD_BYTES + 1))).toBe(false);
    expect(isPqTransportPayload(OFFER.length)).toBe(false);
  });

  test("defers the signed reply's length to the single-source ML-DSA check", () => {
    expect(isPqSignedReply(SIGNED_REPLY)).toBe(true);
    expect(isPqSignedReply(`0x${"ab".repeat(3308)}`)).toBe(false);
    expect(isPqSignedReply(`0x${"AB".repeat(3309)}`)).toBe(false);
    expect(isPqSignedReply(SIGNED_REPLY.slice(2))).toBe(false);
    // Lowercase hex is itself valid base64url, so the grammar check accepts a
    // signing reply too. That is why the command decides which validator runs,
    // and why no caller may sniff the string to tell the directions apart.
    expect(isPqTransportPayload(SIGNED_REPLY)).toBe(true);
  });
});

describe("broker commands", () => {
  test("accepts the two methods and the close signal", () => {
    expect(isPqBrokerCommand({ id: 1, kind: "command", method: "pair", offer: OFFER })).toBe(true);
    expect(isPqBrokerCommand({ envelope: OFFER, id: 2, kind: "command", method: "sign" })).toBe(
      true,
    );
    expect(isPqBrokerCommand({ kind: "close" })).toBe(true);
    expect(isPqBrokerCommand({ id: 3, kind: "command", method: "restore", offer: OFFER })).toBe(
      true,
    );
    expect(isPqBrokerCommand({ id: 4, kind: "command", method: "restore-key", offer: OFFER })).toBe(
      true,
    );
  });

  test("a restore command carries an offer and nothing else", () => {
    // Key-allowlisted per method like the others, so a field that would change
    // which account is asked about cannot ride along unvalidated.
    expect(isPqBrokerCommand({ id: 3, kind: "command", method: "restore" })).toBe(false);
    expect(
      isPqBrokerCommand({
        deviceId: "Pixel",
        id: 3,
        kind: "command",
        method: "restore-key",
        offer: OFFER,
      }),
    ).toBe(false);
    expect(isPqBrokerCommand({ envelope: OFFER, id: 3, kind: "command", method: "restore" })).toBe(
      false,
    );
  });

  test("refuses an unknown field rather than letting it ride along", () => {
    expect(
      isPqBrokerCommand({ id: 1, kind: "command", method: "pair", offer: OFFER, path: "m/1" }),
    ).toBe(false);
    expect(isPqBrokerCommand({ kind: "close", tabId: 7 })).toBe(false);
  });

  test("refuses a malformed method, id, or payload", () => {
    expect(isPqBrokerCommand({ id: 1, kind: "command", method: "reset" })).toBe(false);
    expect(isPqBrokerCommand({ envelope: OFFER, id: 0, kind: "command", method: "sign" })).toBe(
      false,
    );
    expect(isPqBrokerCommand({ envelope: OFFER, id: 1.5, kind: "command", method: "sign" })).toBe(
      false,
    );
    expect(isPqBrokerCommand({ id: 1, kind: "command", method: "pair" })).toBe(false);
    expect(
      isPqBrokerCommand({ id: 1, kind: "command", method: "pair", offer: "not base64url" }),
    ).toBe(false);
    expect(isPqBrokerCommand(null)).toBe(false);
    expect(isPqBrokerCommand("close")).toBe(false);
  });
});

describe("broker responses", () => {
  test("accepts ready, a reply, and a catalogued failure", () => {
    expect(isPqBrokerResponse({ kind: "ready" })).toBe(true);
    expect(isPqBrokerResponse({ id: 1, kind: "response", ok: true, value: SIGNED_REPLY })).toBe(
      true,
    );
    expect(isPqBrokerResponse({ error: "device-lost", id: 1, kind: "response", ok: false })).toBe(
      true,
    );
  });

  test("refuses an error code that is not in the catalog", () => {
    expect(
      isPqBrokerResponse({ error: "definitely-not-a-code", id: 1, kind: "response", ok: false }),
    ).toBe(false);
    // A Ledger code is not a phone code, even though both are plausible strings.
    expect(isPqBrokerResponse({ error: "no-app-open", id: 1, kind: "response", ok: false })).toBe(
      false,
    );
  });

  test("refuses an unknown field, an empty reply, or one past a frame's bound", () => {
    expect(
      isPqBrokerResponse({ id: 1, kind: "response", ok: true, v: 1, value: SIGNED_REPLY }),
    ).toBe(false);
    expect(isPqBrokerResponse({ id: 1, kind: "response", ok: true, value: "" })).toBe(false);
    expect(
      isPqBrokerResponse({
        id: 1,
        kind: "response",
        ok: true,
        value: "x".repeat(PQ_MAX_PAYLOAD_BYTES + 1),
      }),
    ).toBe(false);
    expect(isPqBrokerResponse({ id: 1, kind: "response", ok: true })).toBe(false);
    expect(isPqBrokerResponse({ kind: "ready", label: "Pixel" })).toBe(false);
  });
});

describe("rejection catalog", () => {
  test("every code has copy, and an unknown throw fails closed", () => {
    expect(pqMessage("picker-cancelled")).toContain("signer app");
    expect(isPqRejectionCode("device-lost")).toBe(true);
    expect(isPqRejectionCode("no-app-open")).toBe(false);
    expect(asPqRejection(new PqRejection("request-timeout")).code).toBe("request-timeout");
    expect(asPqRejection(new Error("gatt operation failed")).code).toBe("unexpected-device-error");
    expect(asPqRejection(undefined).code).toBe("unexpected-device-error");
  });
});
