/**
 * A Ready private key restores the accounts the user picks, never a guess
 * (issue 776). One key has a different address under every Argent release, so
 * discovery lists each release with on-chain evidence; the user picks; and the
 * import re-proves each pick before anything is written. Dust sent to another
 * release's address can add a row, but never choose for the user.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { ImportRawKeyAccountInput, PreviewImportedAccountInput } from "@bramble/vault/service";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_BASE_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import {
  discoverReadyKeyAccounts,
  NO_READY_ACCOUNT_FOR_KEY,
  READY_KEY_CHECK_UNAVAILABLE,
  verifyReadyKeyClasses,
} from "../../../apps/extension/src/background/accounts/ready-key-accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  contentSender,
  createWallet,
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

// Clearly-fake test vector; not a real key.
const privateKey = "0xfeedface";

const argentClass = (label: string): string => {
  const entry = deploymentClasses("argent").find((candidate) => candidate.label === label);
  if (!entry) throw new Error(`missing ${label}`);
  return entry.classHash;
};
const ARGENT_031 = argentClass("argent 0.3.1");
const ARGENT_030 = argentClass("argent 0.3.0");

// One distinct address per release, as real derivation gives.
const addressFor = (classHash: string | undefined): string =>
  `0xa${(canonicalFelt(classHash ?? ARGENT_ACCOUNT_CLASS_HASH) ?? "").slice(2, 12)}`;

const previewImportedAccount = async (input: PreviewImportedAccountInput): Promise<AccountRef> => ({
  ...account,
  address: addressFor(input.classHash),
  id: `SN_MAIN:${addressFor(input.classHash)}`,
});

type Evidence = { readonly deployed?: readonly string[]; readonly funded?: readonly string[] };

const rpcWith = (evidence: Evidence, onRead?: () => void) => ({
  ...defaultRuntimeRpc,
  async getDeploymentStatus({ accountAddress }: { readonly accountAddress: string }) {
    onRead?.();
    return (evidence.deployed ?? []).some((classHash) => accountAddress === addressFor(classHash));
  },
  async getTokenBalances({
    accountAddress,
    tokens,
  }: Parameters<typeof defaultRuntimeRpc.getTokenBalances>[0]) {
    const funded = (evidence.funded ?? []).some(
      (classHash) => accountAddress === addressFor(classHash),
    );
    return tokens.map((token, index) => ({
      ...token,
      balance: funded && index === 0 ? "1" : "0",
      formatted: funded && index === 0 ? "0.000000000000000001" : "0",
    }));
  },
});

const deps = (evidence: Evidence) => ({
  preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
  runtimeRpc: rpcWith(evidence),
  wallet: { previewImportedAccount },
});
const input = { networkId: "SN_MAIN" as const, privateKey };

describe("Ready-key discovery", () => {
  test("lists the one release the account was deployed at", async () => {
    const found = await discoverReadyKeyAccounts(deps({ deployed: [ARGENT_031] }), input);
    expect(found).toEqual([
      {
        accountId: `SN_MAIN:${addressFor(ARGENT_031)}`,
        address: addressFor(ARGENT_031),
        classHash: ARGENT_031,
        deployed: true,
      },
    ]);
  });

  test("lists every deployed release, so none is silently dropped", async () => {
    const found = await discoverReadyKeyAccounts(
      deps({ deployed: [ARGENT_031, ARGENT_ACCOUNT_CLASS_HASH] }),
      input,
    );
    expect(found.map((candidate) => candidate.classHash).sort()).toEqual(
      [ARGENT_031, ARGENT_ACCOUNT_CLASS_HASH].sort(),
    );
  });

  test("a dusted release is listed as funded only, beside the deployed one", async () => {
    const found = await discoverReadyKeyAccounts(
      deps({ deployed: [ARGENT_031], funded: [ARGENT_030] }),
      input,
    );
    const dusted = found.find((candidate) => candidate.classHash === ARGENT_030);
    expect(dusted).toMatchObject({ deployed: false });
    expect(dusted && !dusted.deployed ? dusted.holdings.length : 0).toBe(1);
    expect(found.find((candidate) => candidate.classHash === ARGENT_031)?.deployed).toBe(true);
  });

  test("refuses a key with no account under any release", async () => {
    await expect(discoverReadyKeyAccounts(deps({}), input)).rejects.toThrow(
      NO_READY_ACCOUNT_FOR_KEY,
    );
  });

  test("an unreadable network refuses rather than reading as no account", async () => {
    await expect(
      discoverReadyKeyAccounts(
        {
          ...deps({}),
          runtimeRpc: {
            ...rpcWith({}),
            async getDeploymentStatus() {
              throw new Error("rpc unavailable");
            },
          },
        },
        input,
      ),
    ).rejects.toThrow(READY_KEY_CHECK_UNAVAILABLE);
  });
});

describe("Ready-key re-proof before writing", () => {
  test("returns the picked releases that still show evidence, canonical and in order", async () => {
    const picked = [ARGENT_030, ARGENT_031];
    await expect(
      verifyReadyKeyClasses(deps({ deployed: [ARGENT_031], funded: [ARGENT_030] }), input, picked),
    ).resolves.toEqual(picked.map((classHash) => canonicalFelt(classHash) ?? ""));
  });

  test("refuses a pick whose address shows no evidence", async () => {
    await expect(
      verifyReadyKeyClasses(deps({ deployed: [ARGENT_031] }), input, [ARGENT_031, ARGENT_030]),
    ).rejects.toThrow(NO_READY_ACCOUNT_FOR_KEY);
  });

  test("refuses a class that is not an Argent release", async () => {
    await expect(
      verifyReadyKeyClasses(deps({ deployed: [BRAAVOS_BASE_CLASS_HASH] }), input, [
        BRAAVOS_BASE_CLASS_HASH,
      ]),
    ).rejects.toThrow(NO_READY_ACCOUNT_FOR_KEY);
  });
});

const unlocked = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  return session;
};

const capturingWallet = (captured: ImportRawKeyAccountInput[], hasVault = true) => {
  const wallet = createWallet();
  return {
    ...wallet,
    async importRawKeyAccount(request: ImportRawKeyAccountInput) {
      captured.push(request);
      return account;
    },
    previewImportedAccount,
    async status() {
      return { ...(await wallet.status()), hasVault };
    },
  };
};

const discoverMessage = {
  networkId: "SN_MAIN",
  privateKey,
  type: "wallet.discoverReadyKeyAccounts",
};
const importMessage = (classHashes?: readonly string[]) => ({
  accountContractType: "argent",
  ...(classHashes === undefined ? {} : { classHashes }),
  networkId: "SN_MAIN",
  privateKey,
  type: "wallet.importAccount",
});

describe("wallet.discoverReadyKeyAccounts", () => {
  test("answers public candidates only, never the key", async () => {
    const handler = createMessageHandler(capturingWallet([]), testExtension, {
      runtimeRpc: rpcWith({ deployed: [ARGENT_031], funded: [ARGENT_030] }),
      session: unlocked(),
    });
    const response = await handler(discoverMessage, sender);
    expect(response).toMatchObject({ ok: true });
    expect((response as unknown as { candidates: unknown[] }).candidates).toHaveLength(2);
    expect(JSON.stringify(response)).not.toContain("feedface");
  });

  test("runs on first run, before any vault exists", async () => {
    const handler = createMessageHandler(capturingWallet([], false), testExtension, {
      runtimeRpc: rpcWith({ deployed: [ARGENT_031] }),
    });
    await expect(handler(discoverMessage, sender)).resolves.toMatchObject({ ok: true });
  });

  test("a locked wallet refuses, and a lock during the reads returns nothing", async () => {
    const lockedHandler = createMessageHandler(capturingWallet([]), testExtension, {
      runtimeRpc: rpcWith({ deployed: [ARGENT_031] }),
      session: createUnlockSession(),
    });
    await expect(lockedHandler(discoverMessage, sender)).resolves.toEqual({
      error: "wallet locked",
    });

    const session = unlocked();
    const handler = createMessageHandler(capturingWallet([]), testExtension, {
      runtimeRpc: rpcWith({ deployed: [ARGENT_031] }, () => session.lock()),
      session,
    });
    await expect(handler(discoverMessage, sender)).resolves.toEqual({ error: "wallet locked" });
  });

  test("is privileged: content scripts cannot reach it", async () => {
    const handler = createMessageHandler(capturingWallet([]), testExtension);
    await expect(handler(discoverMessage, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("an unreadable network says so, and nothing about the key", async () => {
    const handler = createMessageHandler(capturingWallet([]), testExtension, {
      runtimeRpc: {
        ...rpcWith({}),
        async getDeploymentStatus() {
          throw new Error("rpc unavailable at feedface");
        },
      },
      session: unlocked(),
    });
    const response = await handler(discoverMessage, sender);
    expect(response).toEqual({ error: READY_KEY_CHECK_UNAVAILABLE });
  });
});

describe("wallet.importAccount with picked Ready releases", () => {
  test("stores every picked release once each still shows evidence", async () => {
    const captured: ImportRawKeyAccountInput[] = [];
    const handler = createMessageHandler(capturingWallet(captured), testExtension, {
      runtimeRpc: rpcWith({ deployed: [ARGENT_031], funded: [ARGENT_030] }),
      session: unlocked(),
    });
    await expect(handler(importMessage([ARGENT_031, ARGENT_030]), sender)).resolves.toEqual({
      account,
      ok: true,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.classHashes).toEqual([
      canonicalFelt(ARGENT_031) ?? "",
      canonicalFelt(ARGENT_030) ?? "",
    ]);
  });

  test("writes nothing when a pick no longer shows evidence", async () => {
    const captured: ImportRawKeyAccountInput[] = [];
    const handler = createMessageHandler(capturingWallet(captured), testExtension, {
      runtimeRpc: rpcWith({ deployed: [ARGENT_031] }),
      session: unlocked(),
    });
    const response = await handler(importMessage([ARGENT_030]), sender);
    expect(response).toEqual({ error: NO_READY_ACCOUNT_FOR_KEY });
    expect(JSON.stringify(response)).not.toContain("feedface");
    expect(captured).toEqual([]);
  });

  test("a Ready import must name its picks, and other families must not", async () => {
    const captured: ImportRawKeyAccountInput[] = [];
    const handler = createMessageHandler(capturingWallet(captured), testExtension, {
      runtimeRpc: rpcWith({ deployed: [ARGENT_031] }),
      session: unlocked(),
    });
    for (const message of [
      importMessage(),
      importMessage([]),
      importMessage([ARGENT_031, ARGENT_031]),
      importMessage(["not a felt"]),
      { ...importMessage([ARGENT_031]), accountContractType: "openzeppelin" },
    ]) {
      await expect(handler(message, sender)).resolves.toEqual({
        error: "invalid import account request",
      });
    }
    expect(captured).toEqual([]);
  });

  test("the Bramble account path is unchanged and reads no chain", async () => {
    const captured: ImportRawKeyAccountInput[] = [];
    const handler = createMessageHandler(capturingWallet(captured), testExtension, {
      runtimeRpc: {
        ...rpcWith({}),
        async getDeploymentStatus() {
          throw new Error("must not read");
        },
      },
      session: unlocked(),
    });
    await expect(
      handler({ ...importMessage(), accountContractType: "openzeppelin" }, sender),
    ).resolves.toEqual({ account, ok: true });
    expect(captured[0]?.classHashes).toBeUndefined();
  });
});
