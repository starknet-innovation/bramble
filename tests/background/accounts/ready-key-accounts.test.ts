/**
 * A Ready private key restores the accounts the user picks, never a guess
 * (issue 776). One key has a different address under every Argent release, so
 * discovery lists each release with on-chain evidence; the user picks; and the
 * import re-proves each pick before anything is written. Dust sent to another
 * release's address can add a row, but never choose for the user.
 */
import { describe, expect, test } from "bun:test";
import type { ImportRawKeyAccountInput } from "@bramble/vault/service";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_BASE_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { NO_READY_ACCOUNT_FOR_KEY } from "@bramble/wallet-model/recovery";
import {
  discoverReadyKeyAccounts,
  READY_KEY_CHECK_UNAVAILABLE,
  verifyReadyKeyClasses,
} from "../../../apps/extension/src/background/accounts/ready-key-accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  contentSender,
  extensionSender as sender,
  testExtension,
} from "../../support/background-wallet-stub";
import {
  ARGENT_030,
  ARGENT_031,
  addressFor,
  capturingWallet,
  deps,
  discoverMessage,
  importMessage,
  input,
  rpcWith,
  unlocked,
} from "./ready-key-fixtures";

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
