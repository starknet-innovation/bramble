/**
 * #299: approving a SNIP-9 OutsideExecution journals an accepted
 * "relay-signed" activity row carrying the exact SNIP-12 message hash the
 * signer committed to, so a later Starkscan scan can link the relayed
 * execution back to it. A plain SNIP-12 message records nothing, a malformed
 * envelope is refused before signing, and a repeated approval of the same
 * message does not duplicate the row.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { typedDataHashForChain } from "@bramble/starknet/typed-data";
import { createMemoryStore } from "@bramble/store/kv";
import { type ActivityLog, memoryActivityLog } from "@bramble/transactions/activity";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { constants, outsideExecution } from "starknet";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { executeSignApproval } from "../../../apps/extension/src/background/transactions/chain-ops";

const PASSPHRASE = "correct horse battery staple";
const ORIGIN = "https://dapp.example";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const vault = {
  accounts: [account],
  accountSecrets: [],
  activeAccountId: account.id,
  importedSeeds: [],
  mnemonic: null,
  originGrants: [{ accountIds: [account.id], origin: ORIGIN }],
  schemaVersion: 10,
  signingKeys: [{ accountId: account.id, privateKey: "0x7e5" }],
} as unknown as Vault;

const wallet = {
  async getGrantedAccounts() {
    return [account];
  },
  async readVault() {
    return vault;
  },
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
};

// A well-formed SNIP-12 typed message that is not an OutsideExecution.
const PLAIN = {
  domain: { chainId: "0x534e5f4d41494e", name: "Example", revision: "1", version: "1" },
  message: { contents: "hello" },
  primaryType: "Mail",
  types: {
    Mail: [{ name: "contents", type: "felt" }],
    StarknetDomain: [
      { name: "name", type: "felt" },
      { name: "version", type: "felt" },
      { name: "chainId", type: "felt" },
    ],
  },
};

const call = [{ calldata: ["0xabc", "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" }];

const envelope = (input: unknown): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(
      outsideExecution.getTypedData(
        constants.StarknetChainId.SN_MAIN,
        { caller: "0x0", execute_after: 1, execute_before: 999_999_999_999 },
        1,
        input as never,
        "2",
      ),
    ),
  );

const sign = (activity: ActivityLog, typedData: unknown) => {
  const session = createUnlockSession();
  session.unlock(PASSPHRASE);
  return executeSignApproval(
    {
      activity,
      preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
      session,
      wallet: wallet as never,
    },
    { origin: ORIGIN, typedData },
  );
};

const relayRows = async (activity: ActivityLog) =>
  (await activity.list()).filter((row) => row.kind === "relay-signed");

describe("signing an OutsideExecution journals it locally (#299)", () => {
  test("records the row with the exact message hash the signer committed to", async () => {
    const activity = memoryActivityLog(() => 7);
    const typedData = envelope(call);
    await expect(sign(activity, typedData)).resolves.toEqual({
      ok: true,
      signature: ["0x1", "0x2"],
    });
    const rows = await relayRows(activity);
    expect(rows).toHaveLength(1);
    const expectedHash = typedDataHashForChain(
      typedData,
      account.address,
      STARKNET_NETWORKS.SN_MAIN.chainId,
    );
    expect(rows[0]).toMatchObject({
      accountId: account.id,
      hash: expectedHash,
      kind: "relay-signed",
      networkId: "SN_MAIN",
      status: "accepted",
      submittedAt: 7,
      summary: "Signed for relay",
    });
    expect(rows[0]?.origin).toBeUndefined();
    expect(rows[0]?.snip9).toMatchObject({
      callCount: 1,
      caller: "0x0",
      dappOrigin: ORIGIN,
      messageHash: expectedHash,
      nonce: "0x1",
      revision: "2",
    });
  });

  test("does not duplicate the row when the same message is signed twice", async () => {
    const activity = memoryActivityLog(() => 7);
    const typedData = envelope(call);
    await sign(activity, typedData);
    await sign(activity, typedData);
    expect(await relayRows(activity)).toHaveLength(1);
  });

  test("records nothing for a plain SNIP-12 message", async () => {
    const activity = memoryActivityLog(() => 7);
    await expect(sign(activity, PLAIN)).resolves.toEqual({ ok: true, signature: ["0x1", "0x2"] });
    expect(await relayRows(activity)).toEqual([]);
  });

  test("refuses a malformed OutsideExecution before signing and records nothing", async () => {
    const activity = memoryActivityLog(() => 7);
    const malformed = envelope(call);
    delete (malformed["message"] as Record<string, unknown>)["Calls"];
    await expect(sign(activity, malformed)).resolves.toEqual({ error: "invalid typed data" });
    expect(await relayRows(activity)).toEqual([]);
  });
});
