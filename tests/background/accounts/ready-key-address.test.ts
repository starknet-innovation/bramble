/**
 * Import by address for private-key wallets (issue 779), the lookup half: a
 * Ready key whose account is at an address no release derives (a guardian at
 * deployment, another salt, a rotated key) is found only when the account's
 * live owner, read alike from two chain-checked SNF sources, equals this key.
 * Every #398 refusal applies; Braavos accounts and Bramble accounts are
 * refused; a guardian account is labelled view only; and the key never
 * appears in an answer.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import type { AccountOwnerReading } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import {
  ADDRESS_IMPORT_REFUSALS,
  KEY_ADDRESS_IMPORT_REFUSALS,
} from "@bramble/wallet-model/recovery";
import { contentSender, extensionSender as sender } from "../../support/background-wallet-stub";
import {
  argentOwner,
  KEY,
  keyHarness,
  lookupMessage,
  type OwnerRead,
  owned,
  PASTED,
} from "../../support/key-address-harness";

const [MAIN_GATEWAY, MAIN_FOUNDATION] = STARKNET_NETWORKS.SN_MAIN.rpcUrls;
const ARGENT = canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH) as string;
const ADDRESS = canonicalFelt(PASTED) as string;
const foundation = (input: OwnerRead): boolean => input.rpcUrls.includes(MAIN_FOUNDATION as string);

describe("finding a private key's Ready account by its address", () => {
  test("a live owner equal to this key is found, at the pasted address", async () => {
    const { handler, seen } = keyHarness(owned);
    await expect(handler(lookupMessage(), sender)).resolves.toEqual({
      candidate: {
        accountId: `SN_MAIN:${ADDRESS}`,
        address: ADDRESS,
        byAddress: true,
        classHash: ARGENT,
        deployed: true,
      },
      ok: true,
    });
    // The key's public key comes from the key-free preview, at the live class.
    expect(seen.previews).toEqual([
      { accountContractType: "argent", classHash: ARGENT, networkId: "SN_MAIN", privateKey: KEY },
    ]);
  });

  test("the salt and an explorer-style spelling reach the proof unchanged", async () => {
    const { handler, seen } = keyHarness(owned);
    const response = await handler(
      lookupMessage(`0x000${PASTED.slice(2).toUpperCase()}`, { deploymentSalt: "0x5a17" }),
      sender,
    );
    expect(response).toMatchObject({ candidate: { address: ADDRESS }, ok: true });
    expect(seen.previews[0]?.deploymentSalt).toBe("0x5a17");
    expect(seen.ownerReads.map(({ accountAddress }) => accountAddress)).toEqual([ADDRESS, ADDRESS]);
  });

  test("another owner key is refused as not this key's account", async () => {
    const { handler } = keyHarness(argentOwner("0x0bad"));
    await expect(handler(lookupMessage(), sender)).resolves.toEqual({
      error: KEY_ADDRESS_IMPORT_REFUSALS.noMatch,
    });
  });

  test("each reason an address cannot be imported is its own refusal", async () => {
    const cases: readonly (readonly [AccountOwnerReading, string])[] = [
      [{ kind: "not-deployed" }, ADDRESS_IMPORT_REFUSALS.notDeployed],
      [{ kind: "unsupported-class" }, ADDRESS_IMPORT_REFUSALS.unsupportedClass],
      [
        { family: "argent", kind: "non-stark-owner", ownerType: "webauthn" },
        ADDRESS_IMPORT_REFUSALS.nonStarkOwner,
      ],
      // A Bramble account imports through its own account type.
      [{ kind: "bramble-account" }, KEY_ADDRESS_IMPORT_REFUSALS.brambleAccount],
    ];
    for (const [reading, error] of cases) {
      const { handler, seen } = keyHarness(reading);
      await expect(handler(lookupMessage(), sender)).resolves.toEqual({ error });
      expect(seen.previews).toEqual([]);
    }
  });

  test("a Braavos account is refused, even when this key owns it", async () => {
    const { handler, seen } = keyHarness({
      ...owned,
      classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
      family: "braavos",
    });
    await expect(handler(lookupMessage(), sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.unsupportedClass,
    });
    expect(seen.previews).toEqual([]);
  });

  test("a guardian or 2FA account is found and labelled view only", async () => {
    const { handler } = keyHarness(owned, { restriction: "guardian" });
    await expect(handler(lookupMessage(), sender)).resolves.toMatchObject({
      candidate: { address: ADDRESS, restriction: "guardian" },
      ok: true,
    });
  });

  test("an address that is not one is refused before the chain is read", async () => {
    for (const address of ["0x0", "not an address", `0x8${"0".repeat(63)}`]) {
      const { handler, seen } = keyHarness(owned);
      await expect(handler(lookupMessage(address), sender)).resolves.toEqual({
        error: ADDRESS_IMPORT_REFUSALS.invalid,
      });
      expect(seen.ownerReads).toEqual([]);
    }
  });

  test("a malformed request is refused without echoing the key", async () => {
    const malformed = [
      lookupMessage(`0x${"1".repeat(65)}`),
      lookupMessage(PASTED, { accountContractType: "argent" }),
      lookupMessage(PASTED, { privateKey: "0x0" }),
      { ...lookupMessage(), address: undefined },
    ];
    for (const message of malformed) {
      const { handler, seen } = keyHarness(owned);
      const response = await handler(message, sender);
      expect(response).toEqual({ error: "invalid account lookup request" });
      expect(seen.ownerReads).toEqual([]);
    }
  });
});

describe("the private-key lookup trusts no single source", () => {
  test("reads two sources, each held to the chosen network's chain id", async () => {
    const { handler, seen } = keyHarness(owned);
    await handler(lookupMessage(), sender);
    expect(seen.ownerReads).toEqual([
      {
        accountAddress: ADDRESS,
        chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
        rpcUrls: [MAIN_GATEWAY as string],
      },
      {
        accountAddress: ADDRESS,
        chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
        rpcUrls: [MAIN_FOUNDATION as string],
      },
    ]);
  });

  test("sources that disagree on the owner, the class or deployment are refused", async () => {
    const lies: readonly AccountOwnerReading[] = [
      argentOwner("0x0bad"),
      { ...owned, classHash: "0x1234" },
      { kind: "not-deployed" },
    ];
    for (const lie of lies) {
      const { handler, seen } = keyHarness((input) => (foundation(input) ? owned : lie));
      await expect(handler(lookupMessage(), sender)).resolves.toEqual({
        error: ADDRESS_IMPORT_REFUSALS.unconfirmed,
      });
      expect(seen.previews).toEqual([]);
    }
  });

  test("a custom endpoint cannot vouch for an account on its own", async () => {
    const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
    const custom = "https://rpc.custom.example/v0_10";
    await preferencesStore.setRpcOverride({ networkId: "SN_MAIN", rpcUrl: custom });
    const { handler } = keyHarness(
      (input) => (input.rpcUrls[0] === custom ? owned : argentOwner("0x0bad")),
      { preferencesStore },
    );
    await expect(handler(lookupMessage(), sender)).resolves.toEqual({
      error: ADDRESS_IMPORT_REFUSALS.unconfirmed,
    });
  });

  test("a wrong-chain or unreachable source, or no reader, fails closed", async () => {
    const answers = [
      (input: OwnerRead) =>
        foundation(input) ? new Error("RPC endpoint returned the wrong Starknet chain") : owned,
      (input: OwnerRead) => (foundation(input) ? owned : new Error("fetch failed")),
      undefined,
    ];
    for (const answer of answers) {
      const { handler, seen } = keyHarness(answer);
      await expect(handler(lookupMessage(), sender)).resolves.toEqual({
        error: ADDRESS_IMPORT_REFUSALS.unavailable,
      });
      expect(seen.previews).toEqual([]);
    }
  });

  test("a network with no bundled Foundation node has no second source", async () => {
    const { handler, seen } = keyHarness(owned);
    await expect(
      handler(lookupMessage(PASTED, { networkId: "SN_DEVNET" }), sender),
    ).resolves.toEqual({ error: ADDRESS_IMPORT_REFUSALS.unavailable });
    expect(seen.ownerReads).toEqual([]);
  });
});

describe("the private-key lookup's boundaries", () => {
  test("content scripts cannot reach it", async () => {
    const { handler, seen } = keyHarness(owned);
    const response = await handler(lookupMessage(), contentSender);
    expect(response).toMatchObject({ error: expect.any(String) });
    expect(seen.ownerReads).toEqual([]);
  });

  test("no answer or refusal carries the key", async () => {
    const readings: readonly AccountOwnerReading[] = [
      owned,
      argentOwner("0x0bad"),
      { kind: "not-deployed" },
    ];
    for (const reading of readings) {
      const { handler } = keyHarness(reading, { restriction: "guardian" });
      const text = JSON.stringify(await handler(lookupMessage(), sender)).toLowerCase();
      expect(text).not.toContain(KEY.slice(2));
    }
  });
});
