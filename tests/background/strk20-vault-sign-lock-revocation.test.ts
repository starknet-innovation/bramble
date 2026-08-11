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
import { activeAccountContext } from "../../src/background/runtime-state";
import { createUnlockSession } from "../../src/background/session";
import {
  resolvePrivacyContext,
  type Strk20WalletOpsDeps,
} from "../../src/background/strk20-op-context";
import { createStrk20WalletPreparationStore } from "../../src/background/strk20-wallet-preparations";
import { memoryActivityLog } from "../../src/storage/activity-store";
import { memoryAllowanceStore } from "../../src/storage/allowance-store";
import {
  defaultWalletPreferences,
  type WalletPreferences,
  type WalletPreferencesStore,
} from "../../src/storage/preferences-store";
import { createWallet, vaultPassphrase } from "../support/background-wallet-stub";
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
