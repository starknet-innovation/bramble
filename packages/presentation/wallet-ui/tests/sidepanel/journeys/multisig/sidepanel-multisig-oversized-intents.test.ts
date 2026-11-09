/**
 * One co-signer's oversized proposals cannot blank the multisig screens for
 * another (Sherlock 160). Each saved transaction is budgeted on its own, so
 * individually legal intents whose sum passes the per-message JSON budget are
 * all kept, and a malformed entry is dropped while the rest stay usable.
 */
import { describe, expect, test } from "bun:test";
import { isJson } from "@bramble/core/json";
import type { ArgentMultisigCall } from "@bramble/multisig/chain";
import {
  isArgentMultisigsResponse,
  readArgentMultisig,
  readArgentMultisigs,
} from "../../../../src/popup/responses/multisig-responses";
import { createMultisigClient } from "../../../../src/sidepanel/journeys/multisig/multisig-runtime";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";

// Sixteen calls of 28 full-width felts: legal for one intent, and a few of
// them together pass the provider JSON budget.
const largeCalls = (seed: number): readonly ArgentMultisigCall[] =>
  Array.from({ length: 16 }, (_, call) => ({
    calldata: Array.from(
      { length: 28 },
      (_, felt) => `0x7${(seed * 1_000 + call * 32 + felt).toString(16).padStart(62, "f")}`,
    ),
    contractAddress: `0x5${call.toString(16).padStart(62, "e")}`,
    entrypoint: "transfer",
  }));

const oversizedEnvelope = async () => {
  const fixture = await makeArgentMultisigFixture();
  const large = await Promise.all(
    [1, 2, 3, 4].map(async (seed) => (await makeArgentMultisigFixture(largeCalls(seed))).intent),
  );
  return {
    fixture,
    intents: [fixture.intent, ...large],
    multisigs: [fixture.view],
  };
};

describe("saved transactions past the shared budget", () => {
  test("are each legal alone, but together pass the whole-envelope budget", async () => {
    const { intents, multisigs } = await oversizedEnvelope();
    expect(intents.every((intent) => isJson(intent))).toBe(true);
    expect(isArgentMultisigsResponse({ intents, multisigs, ok: true })).toBe(false);
  });

  test("are all kept, with the watched account, by the list reader", async () => {
    const { intents, multisigs } = await oversizedEnvelope();
    expect(readArgentMultisigs({ intents, multisigs, ok: true })).toEqual({ intents, multisigs });
  });

  test("are all kept by the refresh reader", async () => {
    const { fixture, intents } = await oversizedEnvelope();
    expect(readArgentMultisig({ intents, multisig: fixture.view, ok: true })).toEqual({
      intents,
      multisig: fixture.view,
    });
  });

  test("reach the multisig screens through the runtime", async () => {
    const { fixture, intents, multisigs } = await oversizedEnvelope();
    const client = createMultisigClient({
      async sendMessage(message: unknown) {
        const type = (message as { readonly type?: string }).type;
        return type === "wallet.multisigs"
          ? { intents, multisigs, ok: true }
          : { intents, multisig: fixture.view, ok: true };
      },
    } as never);
    expect(await client.loadMultisigs()).toEqual({ intents, multisigs });
    expect(await client.refreshMultisig(fixture.view.record.id)).toEqual({
      intents,
      multisig: fixture.view,
    });
  });
});

describe("a malformed saved transaction", () => {
  test("is dropped while the rest stay usable", async () => {
    const fixture = await makeArgentMultisigFixture();
    const broken = { ...fixture.intent, summary: " padded " };
    expect(
      readArgentMultisigs({
        intents: [broken, fixture.intent],
        multisigs: [fixture.view],
        ok: true,
      }),
    ).toEqual({ intents: [fixture.intent], multisigs: [fixture.view] });
  });
});

describe("the envelope", () => {
  test("still refuses unknown keys, a failed answer and an array past the provider bound", async () => {
    const fixture = await makeArgentMultisigFixture();
    const base = { intents: [fixture.intent], multisigs: [fixture.view], ok: true };
    expect(readArgentMultisigs({ ...base, extra: true })).toBeNull();
    expect(readArgentMultisigs({ ...base, ok: false })).toBeNull();
    expect(
      readArgentMultisigs({
        ...base,
        intents: Array.from({ length: 4_097 }, () => fixture.intent),
      }),
    ).toBeNull();
    const smuggled = [fixture.intent];
    Object.defineProperty(smuggled, "evil", { enumerable: true, value: 1 });
    expect(readArgentMultisigs({ ...base, intents: smuggled })).toBeNull();
    expect(readArgentMultisig({ intents: [], multisig: { broken: true }, ok: true })).toBeNull();
  });
});
