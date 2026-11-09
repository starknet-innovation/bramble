/**
 * The per-origin approval cap (MCW-V09-116) bounds how much MEMORY one site can
 * hold. It did not bound CPU, because it was applied at the very END of each
 * dapp handler: a `wallet.signTypedData` fully consumed the legal SNIP-12
 * hashing budget in the panel's service worker, and the
 * vault was decrypted to read the origin's grants, and only then did the queue
 * refuse the request and throw all of that away. A connected site could keep the
 * MV3 service worker (which also serves the side panel and background
 * reconciliation) saturated with requests it was always going to refuse.
 *
 * What is pinned here is the ORDERING, as an invocation assertion rather than a
 * timing one: a refused request must not reach the vault at all. The wall-clock
 * budget below is a backstop for the shape of the payload the finding used.
 */
import { describe, expect, test } from "bun:test";
import { MAX_PENDING_APPROVALS_PER_ORIGIN } from "../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { testExtension } from "../support/background-wallet-stub";
import { flushHeld } from "../support/held";
import {
  invokeAccount as account,
  invokeContentSender as contentSender,
  invokeOrigin as origin,
  invokeVaultPassphrase as vaultPassphrase,
  invokeWalletStub as walletStub,
} from "../support/invoke-approval-harness";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

// A legal SNIP-12 document that consumes the current hashing budget:
// four felt arrays at the JSON budget's maximum length. Nothing here is
// malformed — the point is that the WORST LEGAL request is cheap to refuse.
const felts = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, index) => `0x${(index + 1).toString(16)}`);

const heavyTypedData = {
  domain: { chainId: "0x534e5f4d41494e", name: "Flood", version: "1" },
  message: { a: felts(1024), b: felts(1024), c: felts(1024), d: felts(1024) },
  primaryType: "Bulk",
  types: {
    Bulk: [
      { name: "a", type: "felt*" },
      { name: "b", type: "felt*" },
      { name: "c", type: "felt*" },
      { name: "d", type: "felt*" },
    ],
    StarkNetDomain: [
      { name: "name", type: "felt" },
      { name: "version", type: "felt" },
      { name: "chainId", type: "felt" },
    ],
  },
};

const signMessage = { origin, type: "wallet.signTypedData", typedData: heavyTypedData };

// The same request at its cheapest, for the admitted control: what that case
// pins is that the grants ARE read when there is room, and hashing the heavy
// document to learn it would put substantial synchronous Pedersen work into a
// test that does not need it.
const smallSignMessage = {
  origin,
  type: "wallet.signTypedData",
  typedData: {
    ...heavyTypedData,
    message: { a: ["0x1"], b: ["0x2"], c: ["0x3"], d: ["0x4"] },
  },
};

// The wallet stub, with the one read that decrypts the vault counted. Every
// grant read on a dapp path goes through it, so "zero" is a complete statement
// that the refused request never reached the vault.
const countingHandler = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const stub = walletStub([account]);
  const grantReads = { value: 0 };
  const handler = createMessageHandler(
    {
      ...stub,
      async getGrantedAccounts(target: string) {
        grantReads.value += 1;
        return stub.getGrantedAccounts(target);
      },
    } as unknown as Parameters<typeof createMessageHandler>[0],
    testExtension,
    { runtimeRpc: makeRuntimeRpc(), session },
  );
  return { grantReads, handler };
};

// Fills the origin's whole share of the queue with watch-asset prompts, which
// need no connection grant and so leave the grant counter at zero.
const fillQueue = async (handler: ReturnType<typeof countingHandler>["handler"]) => {
  for (let index = 0; index < MAX_PENDING_APPROVALS_PER_ORIGIN; index += 1) {
    void handler(
      {
        asset: {
          address: `0x${(index + 1).toString(16)}`,
          decimals: 18,
          name: `Token ${index}`,
          symbol: `TK${index}`,
        },
        origin,
        type: "wallet.watchAsset",
      },
      contentSender,
    );
  }
  await flushHeld();
};

describe("a capped origin is refused before the wallet spends anything on it", () => {
  test("an admitted sign request does read the grants", async () => {
    // The control: without it, a handler that refused everything would also pass
    // the assertion below.
    const { grantReads, handler } = countingHandler();

    void handler(smallSignMessage, contentSender);
    await flushHeld();

    expect(grantReads.value).toBe(1);
  });

  test("an over-cap sign request never reaches the vault", async () => {
    const { grantReads, handler } = countingHandler();
    await fillQueue(handler);
    expect(grantReads.value).toBe(0);

    await expect(handler(signMessage, contentSender)).resolves.toEqual({
      error: "wallet request failed",
    });

    // Not hashed, not decrypted, not queued: the cap decided on a map filter.
    expect(grantReads.value).toBe(0);
  });

  test("a burst of over-cap sign requests stays far below the cost of hashing them", async () => {
    const { grantReads, handler } = countingHandler();
    await fillQueue(handler);

    const started = Date.now();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await handler(signMessage, contentSender);
    }
    const elapsed = Date.now() - started;

    expect(grantReads.value).toBe(0);
    // Hashing this payload once costs roughly a quarter of a second, so twenty
    // refusals used to cost seconds of worker time. The budget is loose on
    // purpose — it has to fail on the ORDER of the work, not on the speed of the
    // machine, and CI is slower than a developer's.
    expect(elapsed).toBeLessThan(2_000);
  });
});
