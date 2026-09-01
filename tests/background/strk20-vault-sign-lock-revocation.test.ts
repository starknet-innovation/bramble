/**
 * Lock revokes in-flight vault signing on the privacy product line too
 * (MCW-V09-113). The public paths bind their vault signer to the unlock that
 * authorized it; the extension-owned STRK20 flows build their signer through
 * `resolvePrivacyContext` → `strk20AccountContext`, and that seam used to be
 * constructed without a session — so a private transfer kept signing after the
 * user hit Lock. `AccountHashSignerDeps.session` is now required, which makes
 * "forgot the session" a compile error; these checks pin the runtime half.
 */

import { describe, expect, test } from "bun:test";
import { STRK20_SIGN_INTENTS } from "@mc-wallet/ledger-protocol/intent";
import {
  defaultWalletPreferences,
  type WalletPreferences,
  type WalletPreferencesStore,
} from "@mc-wallet/settings/preferences";
import { memoryActivityLog } from "@mc-wallet/transactions/activity";
import { memoryAllowanceStore } from "@mc-wallet/transactions/allowance-store";
import {
  resolvePrivacyContext,
  type Strk20WalletOpsDeps,
} from "../../apps/extension/src/background/privacy/strk20-op-context";
import { createStrk20WalletPreparationStore } from "../../apps/extension/src/background/privacy/strk20-wallet-preparations";
import { executeInvokeApproval } from "../../apps/extension/src/background/provider/invoke-execution";
import type { InvokeExecuteDeps } from "../../apps/extension/src/background/provider/provider-ops";
import type { RuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { activeAccountContext } from "../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import {
  account,
  createWallet,
  grantedOrigin,
  vaultPassphrase,
} from "../support/background-wallet-stub";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

const MESSAGE_HASH = "0x9a";
const TTL_MS = 1_000;
const UNLOCKED_AT = 1_000;

const preferences = (): WalletPreferences => ({
  ...defaultWalletPreferences(),
  activeNetworkId: "SN_SEPOLIA",
  strk20Networks: {
    SN_SEPOLIA: {
      discoveryUrl: "https://discovery.example",
      poolAddress: "0x123",
      proverUrl: "https://prover.example",
      subaccountAnonymizerAddress: "0x456",
    },
  },
});

const makeDeps = (
  session: ReturnType<typeof createUnlockSession>,
  captureSign?: () => void,
): Strk20WalletOpsDeps => ({
  activity: memoryActivityLog(),
  allowanceStore: memoryAllowanceStore(),
  preferencesStore: {
    async read() {
      return preferences();
    },
  } as unknown as WalletPreferencesStore,
  runtimeRpc: makeRuntimeRpc(),
  session,
  strk20Preparations: createStrk20WalletPreparationStore(),
  wallet: createWallet(captureSign ? { captureSign } : {}),
});

const privacySigner = async (deps: Strk20WalletOpsDeps) => {
  const context = await resolvePrivacyContext(deps, {
    active: await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    intents: STRK20_SIGN_INTENTS.transfer,
  });
  if ("error" in context) {
    throw new Error(context.error);
  }
  return context.accountContext.signHash;
};

describe("extension-owned private transfers are bound to their unlock session", () => {
  test("signs while the authorizing session is still live", async () => {
    const session = createUnlockSession({ now: () => UNLOCKED_AT, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);

    const signHash = await privacySigner(makeDeps(session));

    await expect(signHash(MESSAGE_HASH)).resolves.toMatchObject({ r: "0x1" });
  });

  test("refuses to touch the vault after an explicit lock", async () => {
    const session = createUnlockSession({ now: () => UNLOCKED_AT, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    let vaultReads = 0;
    const signHash = await privacySigner(
      makeDeps(session, () => {
        vaultReads += 1;
      }),
    );

    session.lock();

    await expect(signHash(MESSAGE_HASH)).rejects.toThrow("wallet locked");
    expect(vaultReads).toBe(0);
  });

  test("withholds a signature produced while the user was locking", async () => {
    const session = createUnlockSession({ now: () => UNLOCKED_AT, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    // The vault answers, but the user locks before the signature comes back.
    const signHash = await privacySigner(makeDeps(session, () => session.lock()));

    await expect(signHash(MESSAGE_HASH)).rejects.toThrow("wallet locked");
  });
});

// The dapp's prepared-proof lane reaches the vault twice — once to sign, once
// for the viewing key the SDK asks for while it is already talking to the
// network. Both are the same unlock's authority, so a lock in that window must
// revoke both. This lane held its own copy of the viewing-key thunk, and that
// copy was bound to nothing.
const preparedSubmissionDeps = (
  session: ReturnType<typeof createUnlockSession>,
  strk20: unknown,
  derivations: unknown[],
): InvokeExecuteDeps => ({
  activity: memoryActivityLog(),
  allowanceStore: memoryAllowanceStore(),
  preferencesStore: {
    async read() {
      return preferences();
    },
  } as unknown as WalletPreferencesStore,
  runtimeRpc: makeRuntimeRpc({ strk20 } as Partial<RuntimeRpc>),
  session,
  wallet: {
    ...createWallet(),
    async deriveStrk20ViewingKey(input: unknown) {
      derivations.push(input);
      return "0x55";
    },
    async getGrantedAccounts() {
      return [account];
    },
  } as unknown as InvokeExecuteDeps["wallet"],
});

const preparedApproval = {
  origin: grantedOrigin,
  payload: {
    calls: [{ calldata: [], contractAddress: "0x1", entrypoint: "apply_actions" }],
    proof: { data: "opaque", output: ["0x1"], proof_facts: ["0x2"] },
  },
};

describe("an approved dapp private submission is bound to its unlock session", () => {
  test("derives the viewing key while the authorizing session is still live", async () => {
    const session = createUnlockSession({ now: () => UNLOCKED_AT, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    const derivations: unknown[] = [];
    const deps = preparedSubmissionDeps(
      session,
      {
        async submitPrepared(input: { readonly viewingKey: () => Promise<string> }) {
          await input.viewingKey();
          return { transactionHash: "0x7cd" };
        },
      },
      derivations,
    );

    await expect(executeInvokeApproval(deps, preparedApproval)).resolves.toEqual({
      ok: true,
      transactionHash: "0x7cd",
    });
    expect(derivations).toHaveLength(1);
  });

  test("refuses to derive the viewing key after a lock mid-submission", async () => {
    const session = createUnlockSession({ now: () => UNLOCKED_AT, ttlMs: TTL_MS });
    session.unlock(vaultPassphrase);
    const derivations: unknown[] = [];
    const deps = preparedSubmissionDeps(
      session,
      {
        async submitPrepared(input: { readonly viewingKey: () => Promise<string> }) {
          // The user locks while the SDK is mid-flight, before it reaches for
          // the key — the window an approved disclosure actually leaves open.
          session.lock();
          await input.viewingKey();
          return { transactionHash: "0x7cd" };
        },
      },
      derivations,
    );

    await expect(executeInvokeApproval(deps, preparedApproval)).resolves.toMatchObject({
      error: expect.any(String),
    });
    expect(derivations).toEqual([]);
  });
});
