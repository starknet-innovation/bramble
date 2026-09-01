/**
 * Key-boundary regression: no runtime message response may ever carry key
 * material out of the background. The stub vault is salted with recognizable
 * secrets; every handled message's serialized response is scanned for them,
 * and the scanned catalog is proven exhaustive against the message types the
 * background sources actually handle.
 *
 * The scan is also proven live. A handler that answered `{ error }` — because
 * its payload was malformed, its collaborator was missing, or the wallet had
 * locked — would pass a secret grep without having run at all, so each entry
 * must produce a success response unless it carries an explicit `negative`
 * reason for refusing.
 */

import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { isCreateAccountResponse } from "../../../packages/presentation/wallet-ui/src/popup/responses/responses";
import { isLedgerAccountsResponse } from "../../../packages/presentation/wallet-ui/src/popup/responses/responses-ledger";
import { viewingKeyDerivations } from "../../support/key-boundary-collaborators";
import {
  contentSender,
  extensionSender,
  SECRET_MNEMONIC,
  SECRET_PASSPHRASE,
  SECRET_PRIVATE_KEY,
  SECRET_VIEWING_KEY,
} from "../../support/key-boundary-fixtures";
import { makeKeyBoundaryHarness } from "../../support/key-boundary-harness";
import { handledWalletMessages, KEY_BOUNDARY_MESSAGES } from "../../support/key-boundary-messages";
import type { KeyBoundaryLiveIds, KeyBoundaryMessage } from "../../support/key-boundary-types";

const typeOf = (message: Record<string, unknown>): string => String(message["type"] ?? "");

// Merges the ids only the running background can mint into the declared
// payload. The type is re-checked so a `live` block can never quietly point an
// entry at a different handler than the one it claims to cover, and every
// string it supplies must be a real minted value: an entry whose id came back
// empty would still reach a handler, but the lookup behind it would fail and
// the response the scan greps would be that failure rather than the record.
const requestFor = async (
  entry: KeyBoundaryMessage,
  liveIds: KeyBoundaryLiveIds,
): Promise<Record<string, unknown>> => {
  if (!entry.live) {
    return entry.message;
  }
  const minted = await entry.live(liveIds);
  const unminted = Object.entries(minted)
    .filter(([field, value]) => typeof value === "string" && value === (entry.message[field] ?? ""))
    .map(([field]) => `${typeOf(entry.message)}.${field}`);
  expect(unminted).toEqual([]);
  const request = { ...entry.message, ...minted };
  expect(typeOf(request)).toBe(typeOf(entry.message));
  return request;
};

// Reads one declared entry back out of the catalog, so a test that needs a
// specific request still exercises the payload the scan itself sends.
const entryFor = (type: string): KeyBoundaryMessage => {
  const entry = KEY_BOUNDARY_MESSAGES.find((candidate) => typeOf(candidate.message) === type);
  if (!entry) {
    throw new Error(`no key-boundary catalog entry for ${type}`);
  }
  return entry;
};

const errorOf = (response: unknown): string | null => {
  if (typeof response !== "object" || response === null) {
    return null;
  }
  const error = (response as { readonly error?: unknown }).error;
  return typeof error === "string" ? error : null;
};

describe("key boundary", () => {
  test("the scan catalog covers every message type the background handles", async () => {
    const handled = await handledWalletMessages();
    const scanned = new Set(KEY_BOUNDARY_MESSAGES.map((entry) => typeOf(entry.message)));
    const missing = [...handled].filter((type) => !scanned.has(type)).sort();
    // A non-empty list means a message type was added to the background
    // without a key-boundary scan entry: add a payload for it to
    // tests/support/key-boundary-messages.ts.
    expect(missing).toEqual([]);
  });

  test("only the reviewed entries are allowed to answer with an error", () => {
    const excused = KEY_BOUNDARY_MESSAGES.filter((entry) => entry.negative !== undefined);
    for (const entry of excused) {
      expect((entry.negative ?? "").length).toBeGreaterThan(20);
    }
    // Pinned so excusing a new entry from the liveness rule is a deliberate,
    // reviewed edit rather than the quiet way to make this suite green again.
    expect(excused.map((entry) => typeOf(entry.message)).sort()).toEqual([
      "wallet.removeMultisig",
      "wallet.shareArgentMultisigIntent",
      "wallet.status",
      "wallet.strk20DeriveLedgerViewingKey",
      "wallet.syncArgentMultisigIntents",
      "wallet.unlock",
    ]);
  });

  test("every catalog entry reaches a live handler", async () => {
    const harness = await makeKeyBoundaryHarness();
    const inert: string[] = [];
    for (const entry of KEY_BOUNDARY_MESSAGES) {
      // Each entry starts from an unlocked session so one entry that locks the
      // wallet cannot silently turn every entry after it into a "wallet locked"
      // error that the secret scan would then wave through.
      harness.unlock();
      const request = await requestFor(entry, harness.liveIds);
      const error = errorOf(await harness.settle(request, entry.sender));
      if (entry.negative === undefined && error !== null) {
        inert.push(`${typeOf(request)}: ${error}`);
      }
      if (entry.negative !== undefined) {
        expect(error).not.toBeNull();
      }
    }
    // A non-empty list means the scan is grepping error strings instead of
    // handler output: repair the payload (or mark the entry `negative` with the
    // reason refusal is the response under test).
    expect(inert).toEqual([]);
  });

  test("the STRK20 entries really hold the derived viewing key", async () => {
    const harness = await makeKeyBoundaryHarness();
    const derived: string[] = [];
    for (const entry of KEY_BOUNDARY_MESSAGES) {
      harness.unlock();
      const request = await requestFor(entry, harness.liveIds);
      const before = viewingKeyDerivations.value;
      await harness.settle(request, entry.sender);
      if (viewingKeyDerivations.value > before) {
        derived.push(typeOf(request));
      }
    }
    // Without a derivation, the SECRET_VIEWING_KEY grep below is unarmed for
    // that entry: the handler answers without the background ever producing the
    // account-scoped key, so a build that started echoing it would still pass.
    // Pinned exactly — every STRK20 entry but the network-config write reaches
    // the key today, and no non-STRK20 handler has any business deriving one.
    expect(derived.sort()).toEqual([
      "wallet.strk20Balances",
      "wallet.strk20Execute",
      "wallet.strk20InvokeTransaction",
      "wallet.strk20PrepareDeposit",
      "wallet.strk20PrepareInvoke",
      "wallet.strk20PrepareRegistration",
      "wallet.strk20PrepareTransfer",
      "wallet.strk20PrepareWithdraw",
      "wallet.strk20RecipientStatus",
      "wallet.strk20Register",
      "wallet.strk20State",
      "wallet.strk20SubaccountCommitment",
    ]);
  });

  test("the Ledger entries answer with accounts the popup would accept", async () => {
    const harness = await makeKeyBoundaryHarness();
    const settleEntry = async (type: string): Promise<unknown> => {
      const entry = entryFor(type);
      harness.unlock();
      return harness.settle(await requestFor(entry, harness.liveIds), entry.sender);
    };
    // `isLedgerAccountsResponse` rejects any candidate that is not a keyless
    // Ledger account, and the vault schema pins the application segment and the
    // canonical EIP-2645 path. Without this, the stub could answer with a shape
    // production can never emit and the three Ledger entries would still count
    // as live — the scan would be grepping a fiction.
    expect(isLedgerAccountsResponse(await settleEntry("wallet.deriveLedgerAccounts"))).toBe(true);
    expect(isCreateAccountResponse(await settleEntry("wallet.addLedgerAccount"))).toBe(true);
    expect(isCreateAccountResponse(await settleEntry("wallet.createLedgerVault"))).toBe(true);
  });

  test("no handled message response ever carries key material", async () => {
    const harness = await makeKeyBoundaryHarness();
    for (const entry of KEY_BOUNDARY_MESSAGES) {
      harness.unlock();
      const request = await requestFor(entry, harness.liveIds);
      const response = await harness.settle(request, entry.sender);
      const serialized = JSON.stringify(response);
      const messageType = typeOf(request);
      const sanctionedReveal =
        messageType === "wallet.generateMnemonic" || messageType === "wallet.revealSecrets";
      expect(serialized).not.toContain(SECRET_PASSPHRASE);
      expect(serialized).not.toContain("signingKeys");
      expect(serialized).not.toContain("accountSecrets");
      expect(serialized).not.toContain(SECRET_VIEWING_KEY);
      if (messageType !== "wallet.revealSecrets") {
        expect(serialized).not.toContain(SECRET_PRIVATE_KEY);
      }
      if (!sanctionedReveal) {
        expect(serialized).not.toContain(SECRET_MNEMONIC);
      }
    }
  });

  test("mnemonic generation reveals only to extension pages", async () => {
    const { handler } = await makeKeyBoundaryHarness({ unlocked: false });

    expect(await handler({ type: "wallet.generateMnemonic" }, contentSender)).toEqual({
      error: "privileged sender required",
    });
    expect(await handler({ type: "wallet.generateMnemonic" }, extensionSender)).toEqual({
      mnemonic: SECRET_MNEMONIC,
      ok: true,
    });
  });

  test("reveal secrets require an extension page and the re-entered passphrase", async () => {
    const { handler } = await makeKeyBoundaryHarness({ unlocked: false });

    expect(
      await handler(
        { type: "wallet.revealSecrets", vaultPassphrase: SECRET_PASSPHRASE },
        contentSender,
      ),
    ).toEqual({ error: "privileged sender required" });
    expect(
      await handler(
        { type: "wallet.revealSecrets", vaultPassphrase: "wrong passphrase!!" },
        extensionSender,
      ),
    ).toEqual({ error: "bad passphrase" });
    expect(
      await handler(
        { type: "wallet.revealSecrets", vaultPassphrase: SECRET_PASSPHRASE },
        extensionSender,
      ),
    ).toEqual({ mnemonic: SECRET_MNEMONIC, ok: true, privateKey: SECRET_PRIVATE_KEY });
  });

  test("an unwired dispatcher still refuses secret-bearing traffic", async () => {
    // The default router context resolves absent collaborators to explicitly
    // unavailable stubs; that path must fail closed rather than answer.
    const session = createUnlockSession();
    const handler = createMessageHandler(
      {
        async addDerivedAccount() {
          throw new Error("wallet unavailable");
        },
        async createAccount() {
          throw new Error("wallet unavailable");
        },
        async ensureNetworkAccount() {
          throw new Error("wallet unavailable");
        },
        async getGrantedAccounts() {
          return [];
        },
        async generateMnemonic() {
          throw new Error("wallet unavailable");
        },
        async grantOrigin() {
          return [];
        },
        async readVault() {
          throw new Error("wallet unavailable");
        },
        async setActiveAccount() {
          throw new Error("wallet unavailable");
        },
        async signHash() {
          throw new Error("wallet unavailable");
        },
        async status() {
          return {
            accountCount: 0,
            activeAccountId: null,
            hasVault: false,
            locked: true,
            ready: false,
          };
        },
      },
      "extension-id",
      { session },
    );
    const response = await handler(
      { type: "wallet.revealSecrets", vaultPassphrase: SECRET_PASSPHRASE },
      extensionSender,
    );
    expect(response).toEqual({ error: "wallet unavailable" });
  });
});
