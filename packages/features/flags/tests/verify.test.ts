/**
 * Every rejection path of the bramble-ff verifier, plus the accept paths they
 * are measured against. Each rejection must leave the caller nothing to apply;
 * the client then keeps its last good document or the bundled defaults.
 */
import { describe, expect, test } from "bun:test";
import { MAX_FLAG_DOCUMENT_BYTES } from "@bramble/flags/contract";
import { type FlagVerifyOptions, verifyFlagDocument } from "@bramble/flags/verify";
import { createTestPublisher, NOW, payload, stamp } from "./support/flag-fixture";

const publisher = await createTestPublisher();
const stranger = await createTestPublisher();
const trustedKeys = await publisher.trusted();

const options = (overrides: Partial<FlagVerifyOptions> = {}): FlagVerifyOptions => ({
  channel: "production",
  minSequence: 0,
  now: NOW,
  trustedKeys,
  ...overrides,
});

const reason = async (text: string, overrides: Partial<FlagVerifyOptions> = {}) => {
  const result = await verifyFlagDocument(text, options(overrides));
  return result.ok ? "accepted" : result.reason;
};

describe("verifyFlagDocument accepts", () => {
  test("a document signed by a bundled key for this channel", async () => {
    const result = await verifyFlagDocument(await publisher.sign(payload()), options());
    expect(result.ok && result.payload.sequence).toBe(5);
    expect(result.ok && result.payload.flags["swap.enabled"]).toEqual({ enabled: false });
  });

  test("an equal sequence (a refetch of the same document)", async () => {
    expect(await reason(await publisher.sign(payload()), { minSequence: 5 })).toBe("accepted");
  });

  test("an issuedAt within the five-minute clock-skew allowance", async () => {
    const body = payload({ issuedAt: stamp(NOW + 4 * 60_000) });
    expect(await reason(await publisher.sign(body))).toBe("accepted");
  });
});

describe("verifyFlagDocument rejects", () => {
  test("too-large: over 16 KiB before any parsing", async () => {
    const text = `${await publisher.sign(payload())}${" ".repeat(MAX_FLAG_DOCUMENT_BYTES)}`;
    expect(await reason(text)).toBe("too-large");
  });

  test("too-large: counts UTF-8 bytes, not characters", async () => {
    expect(await reason("é".repeat(MAX_FLAG_DOCUMENT_BYTES / 2 + 1))).toBe("too-large");
  });

  test.each([
    ["not JSON", "{"],
    ["a JSON array", "[]"],
    ["an empty object", "{}"],
  ])("malformed: %s", async (_label, text) => {
    expect(await reason(text)).toBe("malformed");
  });

  test("malformed: unknown envelope field", async () => {
    const signed = JSON.parse(await publisher.sign(payload()));
    expect(await reason(JSON.stringify({ ...signed, extra: 1 }))).toBe("malformed");
  });

  test("malformed: missing payload", async () => {
    const { payload: _dropped, ...rest } = JSON.parse(await publisher.sign(payload()));
    expect(await reason(JSON.stringify(rest))).toBe("malformed");
  });

  test("malformed: keyId outside the grammar", async () => {
    expect(await reason(await publisher.sign(payload(), "Flags_Test"))).toBe("malformed");
  });

  test("malformed: signature of the wrong length or alphabet", async () => {
    const signed = JSON.parse(await publisher.sign(payload()));
    for (const signature of [signed.signature.slice(1), `${signed.signature.slice(1)}=`]) {
      expect(await reason(JSON.stringify({ ...signed, signature }))).toBe("malformed");
    }
  });

  test("malformed: a validly signed payload with an unknown field", async () => {
    expect(await reason(await publisher.sign(payload({ rpcUrl: "https://evil" })))).toBe(
      "malformed",
    );
  });

  test("malformed: a validly signed flag rule with an unknown field", async () => {
    const flags = { "swap.enabled": { enabled: true, feeCap: 1 } };
    expect(await reason(await publisher.sign(payload({ flags })))).toBe("malformed");
  });

  test("malformed: a validly signed payload containing a float", async () => {
    expect(await reason(await publisher.sign(payload({ sequence: 5 })).then(floatSequence))).toBe(
      "malformed",
    );
  });

  test("unknown-key: keyId not bundled in this build", async () => {
    expect(await reason(await stranger.sign(payload(), "flags-other"))).toBe("unknown-key");
  });

  test("bad-signature: signed by another key under a trusted keyId", async () => {
    expect(await reason(await stranger.sign(payload(), publisher.keyId))).toBe("bad-signature");
  });

  test("bad-signature: payload tampered after signing", async () => {
    const signed = JSON.parse(await publisher.sign(payload()));
    signed.payload.flags["swap.enabled"].enabled = true;
    expect(await reason(JSON.stringify(signed))).toBe("bad-signature");
  });

  test("wrong-schema: a future schema version", async () => {
    expect(await reason(await publisher.sign(payload({ schema: 2 })))).toBe("wrong-schema");
  });

  test("wrong-channel: a valid document for another channel", async () => {
    expect(await reason(await publisher.sign(payload({ channel: "beta" })))).toBe("wrong-channel");
  });

  test("expired: at and after expiresAt", async () => {
    const text = await publisher.sign(payload({ expiresAt: stamp(NOW) }));
    expect(await reason(text)).toBe("expired");
    expect(await reason(await publisher.sign(payload()), { now: NOW + 31 * 86_400_000 })).toBe(
      "expired",
    );
  });

  test("expired: hands back the payload for its kills, never as a current document", async () => {
    const result = await verifyFlagDocument(
      await publisher.sign(payload({ expiresAt: stamp(NOW) })),
      options(),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason === "expired" && result.expired.sequence).toBe(5);
  });

  test("rollback: reported before expiry, so an older expired copy carries nothing", async () => {
    const text = await publisher.sign(payload({ expiresAt: stamp(NOW) }));
    expect(await reason(text, { minSequence: 6 })).toBe("rollback");
  });

  test("not-yet-valid: issuedAt beyond the clock-skew allowance", async () => {
    const body = payload({ issuedAt: stamp(NOW + 10 * 60_000) });
    expect(await reason(await publisher.sign(body))).toBe("not-yet-valid");
  });

  test("rollback: a lower sequence than the last accepted one", async () => {
    expect(await reason(await publisher.sign(payload()), { minSequence: 6 })).toBe("rollback");
  });
});

// Rewrites `"sequence":5` as `"sequence":5.5` and keeps the original signature.
// The canonical encoder refuses floats, so this must never reach Ed25519.
function floatSequence(text: string): string {
  return text.replace('"sequence":5', '"sequence":5.5');
}
