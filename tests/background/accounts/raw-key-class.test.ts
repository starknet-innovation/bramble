/**
 * Raw-key import restores the Argent account the key already controls.
 *
 * Reported on Mainnet: a Ready key imported as "Ready Account" was stored at
 * the Argent 0.4.0 address, which nobody had deployed, while the user's account
 * was deployed at Argent 0.3.1 and later upgraded. One key has a different
 * address under every release, so the import must read the chain for each.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { ImportRawKeyAccountInput, PreviewImportedAccountInput } from "@bramble/vault/service";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt, sameFelt } from "@bramble/wallet-model/networks";
import {
  NO_READY_ACCOUNT_FOR_KEY,
  rawKeyImportClass,
} from "../../../apps/extension/src/background/accounts/raw-key-class";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
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

// One distinct address per release, as real derivation gives.
const addressFor = (classHash: string | undefined): string =>
  `0xa${(canonicalFelt(classHash ?? ARGENT_ACCOUNT_CLASS_HASH) ?? "").slice(2, 12)}`;

const previewImportedAccount = async (input: PreviewImportedAccountInput): Promise<AccountRef> => ({
  ...account,
  address: addressFor(input.classHash),
  id: `SN_MAIN:${addressFor(input.classHash)}`,
});

const rpcWith = (evidence: { readonly deployed?: string; readonly funded?: string }) => ({
  ...defaultRuntimeRpc,
  async getDeploymentStatus({ accountAddress }: { readonly accountAddress: string }) {
    return evidence.deployed !== undefined && accountAddress === addressFor(evidence.deployed);
  },
  async getTokenBalances({
    accountAddress,
    tokens,
  }: Parameters<typeof defaultRuntimeRpc.getTokenBalances>[0]) {
    const funded = evidence.funded !== undefined && accountAddress === addressFor(evidence.funded);
    return tokens.map((token) => ({
      ...token,
      balance: funded ? "1" : "0",
      formatted: funded ? "1" : "0",
    }));
  },
});

const pick = (
  evidence: { readonly deployed?: string; readonly funded?: string },
  accountContractType: "argent" | "openzeppelin" = "argent",
) =>
  rawKeyImportClass(
    {
      preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
      runtimeRpc: rpcWith(evidence),
      wallet: { previewImportedAccount },
    },
    { accountContractType, networkId: "SN_MAIN", privateKey },
  );

describe("raw-key import class", () => {
  test("restores the release the account was deployed at", async () => {
    expect(await pick({ deployed: ARGENT_031 })).toBe(ARGENT_031);
  });

  test("takes a deployed release over a funded one", async () => {
    expect(await pick({ deployed: ARGENT_031, funded: ARGENT_ACCOUNT_CLASS_HASH })).toBe(
      ARGENT_031,
    );
  });

  test("restores a funded counterfactual when nothing is deployed", async () => {
    expect(await pick({ funded: ARGENT_031 })).toBe(ARGENT_031);
  });

  test("refuses a Ready key with no account on chain", async () => {
    await expect(pick({})).rejects.toThrow(NO_READY_ACCOUNT_FOR_KEY);
  });

  test("leaves other families alone", async () => {
    expect(await pick({ deployed: ARGENT_031 }, "openzeppelin")).toBeUndefined();
  });

  test("fails the import when the network cannot be read", async () => {
    await expect(
      rawKeyImportClass(
        {
          preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
          runtimeRpc: {
            ...rpcWith({}),
            async getDeploymentStatus() {
              throw new Error("rpc unavailable");
            },
          },
          wallet: { previewImportedAccount },
        },
        { accountContractType: "argent", networkId: "SN_MAIN", privateKey },
      ),
    ).rejects.toThrow("rpc unavailable");
  });

  test("wallet.importAccount writes nothing for a key with no account", async () => {
    const captured: ImportRawKeyAccountInput[] = [];
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      {
        ...createWallet(),
        async importRawKeyAccount(input: ImportRawKeyAccountInput) {
          captured.push(input);
          return account;
        },
        previewImportedAccount,
      },
      testExtension,
      { runtimeRpc: rpcWith({}), session },
    );

    const response = await handler(
      {
        accountContractType: "argent",
        networkId: "SN_MAIN",
        privateKey,
        type: "wallet.importAccount",
      },
      sender,
    );

    expect(response).toEqual({ error: NO_READY_ACCOUNT_FOR_KEY });
    expect(JSON.stringify(response)).not.toContain("feedface");
    expect(captured).toEqual([]);
  });

  test("wallet.importAccount stores the deployed release", async () => {
    const captured: ImportRawKeyAccountInput[] = [];
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      {
        ...createWallet(),
        async importRawKeyAccount(input: ImportRawKeyAccountInput) {
          captured.push(input);
          return account;
        },
        previewImportedAccount,
      },
      testExtension,
      { runtimeRpc: rpcWith({ deployed: ARGENT_031 }), session },
    );

    const response = await handler(
      {
        accountContractType: "argent",
        networkId: "SN_MAIN",
        privateKey,
        type: "wallet.importAccount",
      },
      sender,
    );

    expect(response).toEqual({ account, ok: true });
    expect(captured).toHaveLength(1);
    expect(sameFelt(captured[0]?.classHash ?? "", ARGENT_031)).toBe(true);
  });
});
