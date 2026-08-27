/**
 * The paired-phone message boundary. A 3309-byte signature and a 1952-byte
 * public key cross `chrome.runtime`, and the parser is what stops a truncated
 * or padded response reaching the verify gate — where it would surface as
 * "verification failed", indistinguishable from a wrong device, in a path that
 * only runs with a real phone attached. So these pin the exact shapes, and that
 * the queue is never touched by a payload that does not parse.
 */
import { describe, expect, test } from "bun:test";
import { mlDsa65Fixture } from "@mc-wallet/testkit/ml-dsa-fixtures";
import { ML_DSA_65_PUBLIC_KEY_BYTES } from "@mc-wallet/wallet-model/signing";
import { readCompleteMobilePqSignInput } from "../../../apps/extension/src/background/devices/mobile-pq-inputs";
import { handleMobilePqOps } from "../../../apps/extension/src/background/devices/mobile-pq-ops";
import {
  createMobilePqSignQueue,
  type MobilePqSignRequest,
} from "../../../apps/extension/src/background/devices/mobile-pq-signer";

const device = mlDsa65Fixture(21);
const signature = device.sign("0x1e240");
const type = "wallet.completeMobilePqSign";

const request: MobilePqSignRequest = {
  accountId: "SN_MAIN:0xabc",
  deviceId: "phone-1",
  messageHash: "0x1e240",
  publicKey: device.publicKey,
};

const depsWith = (mobilePqSignQueue?: ReturnType<typeof createMobilePqSignQueue>) =>
  ({ mobilePqSignQueue }) as never;

describe("readCompleteMobilePqSignInput", () => {
  test("accepts a signature of exactly the encoded length", () => {
    expect(readCompleteMobilePqSignInput({ id: "mobile-pq-sign-1", signature, type })).toEqual({
      id: "mobile-pq-sign-1",
      signature,
    });
  });

  test("refuses a signature that is not exactly that length", () => {
    for (const bad of [
      signature.slice(0, -2),
      `${signature}ab`,
      device.publicKey,
      `0x${"ab".repeat(ML_DSA_65_PUBLIC_KEY_BYTES)}`,
      "0x",
      "",
    ]) {
      expect(readCompleteMobilePqSignInput({ id: "mobile-pq-sign-1", signature: bad, type })).toBe(
        null,
      );
    }
  });

  test("refuses uppercase hex, which is a second spelling of one value", () => {
    expect(
      readCompleteMobilePqSignInput({
        id: "mobile-pq-sign-1",
        signature: signature.toUpperCase(),
        type,
      }),
    ).toBe(null);
  });

  test("accepts a rejection, and never a payload that is both or neither", () => {
    expect(readCompleteMobilePqSignInput({ error: "declined", id: "x", type })).toEqual({
      error: "declined",
      id: "x",
    });
    expect(readCompleteMobilePqSignInput({ error: "declined", id: "x", signature, type })).toBe(
      null,
    );
    expect(readCompleteMobilePqSignInput({ id: "x", type })).toBe(null);
    expect(readCompleteMobilePqSignInput({ error: "", id: "x", type })).toBe(null);
  });

  test("refuses an empty id, an unknown key, and a foreign message type", () => {
    expect(readCompleteMobilePqSignInput({ id: "", signature, type })).toBe(null);
    expect(readCompleteMobilePqSignInput({ extra: 1, id: "x", signature, type })).toBe(null);
    expect(
      readCompleteMobilePqSignInput({ id: "x", signature, type: "wallet.completeLedgerSign" }),
    ).toBe(null);
    expect(readCompleteMobilePqSignInput(null)).toBe(null);
  });
});

describe("handleMobilePqOps", () => {
  test("lists what is parked, including the enrolled key the panel checks", async () => {
    const queue = createMobilePqSignQueue();
    void queue.request(request);
    const response = await handleMobilePqOps(depsWith(queue), "wallet.mobilePqSignPending", {
      type: "wallet.mobilePqSignPending",
    });
    expect(response).toMatchObject({ ok: true });
    const pending = (response as unknown as { readonly pending: readonly MobilePqSignRequest[] })
      .pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ deviceId: "phone-1", publicKey: device.publicKey });
  });

  test("settles a parked request and refuses a second settle of the same id", async () => {
    const queue = createMobilePqSignQueue();
    const parked = queue.request(request);
    const id = queue.pending()[0]?.id as string;
    const settle = { id, signature, type };
    expect(await handleMobilePqOps(depsWith(queue), type, settle)).toEqual({ ok: true });
    await expect(parked).resolves.toEqual({ signature });
    expect(await handleMobilePqOps(depsWith(queue), type, settle)).toEqual({
      error: "no pending mobile sign for id",
    });
  });

  test("a malformed payload settles nothing", async () => {
    const queue = createMobilePqSignQueue();
    void queue.request(request);
    const id = queue.pending()[0]?.id as string;
    expect(await handleMobilePqOps(depsWith(queue), type, { id, signature: "0xab", type })).toEqual(
      { error: "invalid complete mobile sign request" },
    );
    expect(queue.pending()).toHaveLength(1);
  });

  test("fails closed when no phone queue is wired", async () => {
    expect(
      await handleMobilePqOps(depsWith(undefined), type, { id: "x", signature, type }),
    ).toEqual({ error: "mobile signing unavailable" });
    expect(
      await handleMobilePqOps(depsWith(undefined), "wallet.mobilePqSignPending", {
        type: "wallet.mobilePqSignPending",
      }),
    ).toEqual({ ok: true, pending: [] });
  });

  test("returns null for a message type it does not own", async () => {
    expect(
      await handleMobilePqOps(depsWith(undefined), "wallet.completeLedgerSign", {
        type: "wallet.completeLedgerSign",
      }),
    ).toBe(null);
  });
});
