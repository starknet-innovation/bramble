/**
 * No dapp-reachable message may extend the inactivity window (MCW-V09-105).
 *
 * The auto-lock is only real if the wallet locks while the user is away, and
 * "away" is decided by the user's own actions — not by whether some page left a
 * tab open. Every message in `DAPP_MESSAGES` can be issued from any open page on
 * a timer, with no prompt and no UI, so each one must observe the unlock window
 * and never renew it. This suite drives the real message handler at one
 * millisecond before the deadline and asserts the wallet is locked one
 * millisecond after it: if any of these reads renewed, the wallet would stay
 * unlocked forever under a polling page.
 *
 * It also pins the ordering rule that goes with it: the background validates
 * type, origin, and capability before it acts on a message at all, so a
 * malformed or origin-mismatched message never even reaches the session.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import { DAPP_MESSAGES } from "../../apps/extension/src/background/routing/senders";
import {
  createUnlockSession,
  type UnlockSession,
} from "../../apps/extension/src/background/runtime/session";
import {
  contentSender,
  createWallet,
  grantedOrigin,
  vaultPassphrase,
} from "../support/background-wallet-stub";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

const TTL_MS = 1_000;
const UNLOCKED_AT = 1_000;
const EXPIRES_AT = UNLOCKED_AT + TTL_MS;

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

// The stub vault lives on SN_SEPOLIA, so the harness selects that network up
// front and every handler under test resolves a real granted account.
// Counts how each handler reads the session. `renewals` must stay at zero for
// dapp traffic, and `peeks` proves the handler actually reached the session
// rather than bailing out earlier and passing this suite vacuously.
const makeHarness = async () => {
  let now = UNLOCKED_AT;
  let peeks = 0;
  let renewals = 0;
  const inner = createUnlockSession({ now: () => now, ttlMs: TTL_MS });
  const session: UnlockSession = {
    ...inner,
    getPassphrase() {
      renewals += 1;
      return inner.getPassphrase();
    },
    peekPassphrase() {
      peeks += 1;
      return inner.peekPassphrase();
    },
  };
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  const handler = createMessageHandler(createWallet(), "extension-id", {
    preferencesStore,
    runtimeRpc: makeRuntimeRpc(),
    session,
  });
  session.unlock(vaultPassphrase);
  return {
    advanceTo(next: number) {
      now = next;
    },
    handler,
    peeks: () => peeks,
    renewals: () => renewals,
    session,
  };
};

// One well-formed message per dapp-reachable type that reads the session. Some
// park an approval and never settle their promise, so callers must not await
// the handler — the session read under test happens before the approval queues.
const POLLABLE_MESSAGES: Readonly<Record<string, Record<string, unknown>>> = {
  "wallet.addDeclareTransaction": {
    declare: {
      compiledClassHash: "0x1",
      contractClass: { entry_points_by_type: {}, sierra_program: [] },
    },
    origin: grantedOrigin,
    type: "wallet.addDeclareTransaction",
  },
  "wallet.addInvokeTransaction": {
    calls: [{ calldata: [], contractAddress: "0xabcabcdef", entrypoint: "transfer" }],
    origin: grantedOrigin,
    type: "wallet.addInvokeTransaction",
  },
  "wallet.deploymentData": { origin: grantedOrigin, type: "wallet.deploymentData" },
  "wallet.getGrantedAccounts": { origin: grantedOrigin, type: "wallet.getGrantedAccounts" },
  "wallet.getPermissions": { origin: grantedOrigin, type: "wallet.getPermissions" },
  // The headline bypass: a preauthorization probe that answers with no prompt.
  "wallet.requestAccounts": { origin: grantedOrigin, silent: true, type: "wallet.requestAccounts" },
  "wallet.signTypedData": {
    origin: grantedOrigin,
    type: "wallet.signTypedData",
    typedData: {
      domain: { chainId: "0x534e5f5345504f4c4941", name: "Poll", version: "1" },
      message: { note: "1" },
      primaryType: "Note",
      types: {
        Note: [{ name: "note", type: "felt" }],
        StarknetDomain: [
          { name: "name", type: "shortstring" },
          { name: "chainId", type: "shortstring" },
          { name: "version", type: "shortstring" },
        ],
      },
    },
  },
  "wallet.strk20Balances": { origin: grantedOrigin, tokens: [], type: "wallet.strk20Balances" },
  "wallet.strk20InvokeTransaction": {
    actions: [{ amount: "0x0a", recipient: "0xabcabcdef", token: "0xabcabcdef", type: "withdraw" }],
    origin: grantedOrigin,
    type: "wallet.strk20InvokeTransaction",
  },
  "wallet.strk20PrepareInvoke": {
    actions: [{ amount: "0x0a", recipient: "0xabcabcdef", token: "0xabcabcdef", type: "withdraw" }],
    origin: grantedOrigin,
    simulate: true,
    type: "wallet.strk20PrepareInvoke",
  },
  "wallet.strk20Register": { origin: grantedOrigin, type: "wallet.strk20Register" },
  "wallet.strk20SubaccountCommitment": {
    dappName: "poller",
    origin: grantedOrigin,
    type: "wallet.strk20SubaccountCommitment",
  },
  "wallet.switchChain": {
    chainId: "0x534e5f4d41494e",
    origin: grantedOrigin,
    type: "wallet.switchChain",
  },
};

describe("dapp polling cannot hold the wallet unlocked", () => {
  for (const [type, message] of Object.entries(POLLABLE_MESSAGES)) {
    test(`${type} observes the unlock window without extending it`, async () => {
      const harness = await makeHarness();

      harness.advanceTo(EXPIRES_AT - 1);
      void harness.handler(message, contentSender);
      await flushMicrotasks();

      // The handler reached the session (so this is not a vacuous pass) and
      // read it through the non-renewing half.
      expect(harness.peeks()).toBeGreaterThan(0);
      expect(harness.renewals()).toBe(0);
      harness.advanceTo(EXPIRES_AT + 1);
      expect(harness.session.isUnlocked()).toBe(false);
    });
  }

  test("survives repeated polling across many full inactivity windows", async () => {
    const harness = await makeHarness();
    const poll = POLLABLE_MESSAGES["wallet.requestAccounts"] ?? {};

    // Ten consecutive TTL windows with zero user activity. This is the exact
    // shape of the bypass: one page, one timer, no prompt, forever.
    for (let window = 1; window <= 10; window += 1) {
      harness.advanceTo(UNLOCKED_AT + window * TTL_MS - 1);
      void harness.handler(poll, contentSender);
      await flushMicrotasks();
    }

    harness.advanceTo(EXPIRES_AT + 1);
    expect(harness.renewals()).toBe(0);
    expect(harness.session.isUnlocked()).toBe(false);
  });

  test("covers every dapp-reachable message that can reach the session", () => {
    // Guards the list above against drift: a new dapp message must either be
    // exercised here or be one of the read-only version queries that never
    // touch the session. `wallet.getChainId`, `wallet.watchAsset` and
    // `wallet.addStarknetChain` read preferences and the approval queue only.
    const sessionFree = new Set([
      "wallet.addStarknetChain",
      "wallet.getChainId",
      "wallet.supportedSpecs",
      "wallet.supportedWalletApi",
      "wallet.watchAsset",
    ]);
    const uncovered = [...DAPP_MESSAGES].filter(
      (type) => !sessionFree.has(type) && POLLABLE_MESSAGES[type] === undefined,
    );

    expect(uncovered).toEqual([]);
  });
});

describe("the background validates before it reads the session", () => {
  test("a malformed sign request is refused without touching the session", async () => {
    const harness = await makeHarness();

    harness.advanceTo(EXPIRES_AT - 1);
    // No origin, no typed data: this message is rejected as invalid, and it
    // must be rejected before anything renews the unlock window.
    expect(await harness.handler({ type: "wallet.signTypedData" }, contentSender)).toEqual({
      error: "invalid sign typed data request",
    });

    // Nothing read the session at all: validation came first.
    expect(harness.peeks()).toBe(0);
    harness.advanceTo(EXPIRES_AT + 1);
    expect(harness.session.isUnlocked()).toBe(false);
  });

  test("a sign request claiming another origin is refused first", async () => {
    const harness = await makeHarness();

    harness.advanceTo(EXPIRES_AT - 1);
    expect(
      await harness.handler(
        { origin: "https://attacker.example", type: "wallet.signTypedData", typedData: {} },
        contentSender,
      ),
    ).toEqual({ error: "sender origin mismatch" });

    expect(harness.peeks()).toBe(0);
    harness.advanceTo(EXPIRES_AT + 1);
    expect(harness.session.isUnlocked()).toBe(false);
  });
});
