/**
 * Stale-grant reconnect prompt: a fresh invoke or typed-data request from an
 * origin whose grant no longer resolves on the active network is refused with
 * `origin not connected` AND queues one deduplicated connect approval, so the
 * wallet explains the dapp's stuck spinner. An origin that never connected
 * gets the plain refusal — no prompt a page could mint by firing invokes.
 */
import { describe, expect, test } from "bun:test";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  invokeContentSender as contentSender,
  invokeAccount,
  invokeMessage,
  makeInvokeHarness as makeHarness,
  invokeOrigin as origin,
} from "../../support/invoke-approval-harness";

// The same identity granted on ANOTHER network than the active one (SN_MAIN):
// resolveOriginAccount finds no active-network account, but the grant exists.
const sepoliaGrant: AccountRef = {
  ...invokeAccount,
  id: `SN_SEPOLIA:${invokeAccount.address}`,
  networkId: "SN_SEPOLIA",
};

const extensionSender = { id: "extension-id", url: "chrome-extension://extension-id/panel.html" };

const pendingKinds = async (
  handler: ReturnType<typeof makeHarness>["handler"],
): Promise<readonly { kind: string; origin: string }[]> => {
  const response = (await handler(
    { type: "wallet.pendingApprovals" },
    extensionSender,
  )) as unknown as {
    pending?: readonly { kind: string; origin: string }[];
  };
  return (response.pending ?? []).map(({ kind, origin: from }) => ({ kind, origin: from }));
};

describe("stale-grant reconnect prompt", () => {
  test("a stale-grant invoke is refused and queues one connect approval", async () => {
    const { handler, invoked } = makeHarness([sepoliaGrant]);

    await expect(handler(invokeMessage(), contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
    expect(invoked).toHaveLength(0);
    expect(await pendingKinds(handler)).toEqual([{ kind: "connect", origin }]);

    // A looping origin gains nothing: the connect prompt deduplicates.
    await expect(handler(invokeMessage(), contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
    expect(await pendingKinds(handler)).toEqual([{ kind: "connect", origin }]);
  });

  test("a never-connected origin gets the plain refusal without a prompt", async () => {
    const { handler, invoked } = makeHarness([]);

    await expect(handler(invokeMessage(), contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
    expect(invoked).toHaveLength(0);
    expect(await pendingKinds(handler)).toEqual([]);
  });

  test("a stale-grant typed-data request is refused and queues the same prompt", async () => {
    const { handler } = makeHarness([sepoliaGrant]);

    await expect(
      handler(
        {
          origin,
          type: "wallet.signTypedData",
          typedData: {
            domain: { name: "Example", version: "1" },
            message: { note: "hi" },
            primaryType: "Note",
            types: {
              Note: [{ name: "note", type: "felt" }],
              StarkNetDomain: [{ name: "name", type: "felt" }],
            },
          },
        },
        contentSender,
      ),
    ).resolves.toEqual({ error: "origin not connected" });
    expect(await pendingKinds(handler)).toEqual([{ kind: "connect", origin }]);
  });
});
