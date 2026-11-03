/**
 * An approved SNIP-9 OutsideExecution is recorded for Activity as signed for
 * relay (issue 299), and only then: a plain SNIP-12 message, a refused request
 * and a failed signature record nothing, and a log that cannot be written never
 * takes back a signature the user approved. Activity returns the records beside
 * the transaction feed, never inside it.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { memoryActivityLog } from "@bramble/transactions/activity";
import {
  memoryRelaySignatureLog,
  type RelaySignatureLog,
} from "@bramble/transactions/relay-signatures";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { constants, outsideExecution, type RpcProvider } from "starknet";
import { handleActivity } from "../../../apps/extension/src/background/accounts/activity-ops";
import { setApprovalNotifier } from "../../../apps/extension/src/background/approvals/approval-notifier";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { executeSignApproval } from "../../../apps/extension/src/background/transactions/chain-ops";
import { recordRelaySignature } from "../../../apps/extension/src/background/transactions/relay-record";
import { chromiumExtension } from "../../support/background-wallet-stub";
import { flushHeld, waitForPendingApprovals } from "../../support/held";

const PASSPHRASE = "correct horse battery staple";
const ORIGIN = "https://dapp.example";
const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
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
const scope = { accountId: account.id, networkId: "SN_MAIN" } as const;
const content: RuntimeSender = { id: "ext", url: `${ORIGIN}/swap` };
const page: RuntimeSender = { id: "ext", url: "chrome-extension://ext/sidepanel.html" };

let signFails = false;
const wallet = {
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return "phrase";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return {
      accounts: [account],
      accountSecrets: [],
      activeAccountId: account.id,
      importedSeeds: [],
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin: ORIGIN }],
      schemaVersion: 12 as const,
      shadowAccountScopes: [],
      signingKeys: [{ accountId: account.id, privateKey: "0x7e5" }],
    };
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    if (signFails) throw new Error("device rejected");
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

const outside = (version: "1" | "2" = "2"): unknown =>
  JSON.parse(
    JSON.stringify(
      outsideExecution.getTypedData(
        constants.StarknetChainId.SN_MAIN,
        {
          caller: constants.OutsideExecutionCallerAny,
          execute_after: 1,
          execute_before: 1_900_000_000,
        },
        "0x2a",
        [{ calldata: ["0x5", "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" }],
        version,
      ),
    ),
  );

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

const unlocked = () => {
  const session = createUnlockSession();
  session.unlock(PASSPHRASE);
  return session;
};

const signDirect = (relaySignatures: Pick<RelaySignatureLog, "record">, typedData: unknown) =>
  executeSignApproval(
    {
      activity: memoryActivityLog(),
      preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
      relaySignatures,
      session: unlocked(),
      wallet,
    },
    { origin: ORIGIN, typedData },
  );

describe("recording a signature for relay", () => {
  for (const version of ["1", "2"] as const) {
    test(`an approved v${version} OutsideExecution is listed in Activity as signed`, async () => {
      setApprovalNotifier(() => undefined);
      signFails = false;
      const relaySignatures = memoryRelaySignatureLog(() => 7_000);
      const handler = createMessageHandler(wallet, chromiumExtension("ext"), {
        preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
        relaySignatures,
        session: unlocked(),
      });
      const held = handler(
        { origin: ORIGIN, type: "wallet.signTypedData", typedData: outside(version) },
        content,
      );
      await flushHeld();
      const [queued] = await waitForPendingApprovals<{ readonly id: string }>(handler, page);
      await handler({ id: queued?.id, type: "wallet.approveOrigin" }, page);
      expect(await held).toEqual(expect.objectContaining({ ok: true }));

      const activity = (await handler({ cached: true, type: "wallet.activity" }, page)) as {
        readonly activity: readonly unknown[];
        readonly relays?: readonly { readonly [key: string]: unknown }[];
      };
      expect(activity.activity).toEqual([]);
      expect(activity.relays).toEqual([
        expect.objectContaining({
          accountId: account.id,
          callCount: 1,
          checkable: true,
          executeBefore: 1_900_000_000,
          nonce: "0x2a",
          origin: ORIGIN,
          revision: version,
          signedAt: 7_000,
          status: "signed",
        }),
      ]);
    });
  }

  test("typed data that throws while being read after signing still returns the signature", async () => {
    // Every read works until the wallet has signed; from then on any property
    // read throws, so only the post-signing recording step can hit it.
    let signedYet = false;
    const armed = (value: unknown): unknown =>
      value !== null && typeof value === "object"
        ? new Proxy(value as object, {
            get(target, key, receiver) {
              if (signedYet) throw new Error("hostile getter");
              return armed(Reflect.get(target, key, receiver));
            },
          })
        : value;
    const typedData = armed(outside());
    const recorded: unknown[] = [];
    const response = await executeSignApproval(
      {
        activity: memoryActivityLog(),
        preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
        relaySignatures: {
          record: async (entry) => {
            recorded.push(entry);
          },
        },
        session: unlocked(),
        wallet: {
          ...wallet,
          async signHash() {
            signedYet = true;
            return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
          },
        },
      },
      { origin: ORIGIN, typedData },
    );
    expect(signedYet).toBe(true);
    expect(response).toEqual(expect.objectContaining({ ok: true, signature: expect.any(Array) }));
    expect(recorded).toEqual([]);
  });

  test("a log that throws synchronously still returns the approved signature", async () => {
    signFails = false;
    const throwing = {
      record: (() => {
        throw new Error("storage unavailable");
      }) as RelaySignatureLog["record"],
    };
    expect(await signDirect(throwing, outside())).toEqual(expect.objectContaining({ ok: true }));
  });

  test("a log write that never settles does not hold back the approved signature", async () => {
    signFails = false;
    const recorded: unknown[] = [];
    const stalled: Pick<RelaySignatureLog, "record"> = {
      record: (entry) => {
        recorded.push(entry);
        return new Promise<void>(() => undefined);
      },
    };
    expect(await signDirect(stalled, outside())).toEqual(expect.objectContaining({ ok: true }));
    expect(recorded).toHaveLength(1);
  });

  test("only account types with a verified nonce view are tracked", async () => {
    const relaySignatures = memoryRelaySignatureLog();
    for (const [type, hash] of [
      ["argent", "0x1"],
      ["braavos", "0x2"],
      ["openzeppelin", "0x3"],
    ] as const) {
      await recordRelaySignature(relaySignatures, {
        account: { ...account, accountContractType: type },
        messageHash: hash,
        origin: ORIGIN,
        typedData: outside(),
      });
    }
    const tracked = Object.fromEntries(
      (await relaySignatures.list(scope)).map((entry) => [entry.messageHash, entry.checkable]),
    );
    expect(tracked).toEqual({ "0x1": true, "0x2": false, "0x3": true });
  });

  test("no log wired records nothing and does not throw", async () => {
    await expect(
      recordRelaySignature(undefined, {
        account,
        messageHash: "0x1",
        origin: ORIGIN,
        typedData: outside(),
      }),
    ).resolves.toBeUndefined();
  });

  test("a plain SNIP-12 message records nothing", async () => {
    signFails = false;
    const relaySignatures = memoryRelaySignatureLog();
    expect(await signDirect(relaySignatures, PLAIN)).toEqual(expect.objectContaining({ ok: true }));
    expect(await relaySignatures.list(scope)).toEqual([]);
  });

  test("a failed signature records nothing", async () => {
    signFails = true;
    const relaySignatures = memoryRelaySignatureLog();
    expect(await signDirect(relaySignatures, outside())).toEqual({ error: expect.any(String) });
    expect(await relaySignatures.list(scope)).toEqual([]);
    signFails = false;
  });

  test("a log that cannot be written still returns the approved signature", async () => {
    signFails = false;
    const failing = {
      record: async () => {
        throw new Error("storage full");
      },
    };
    expect(await signDirect(failing, outside())).toEqual(expect.objectContaining({ ok: true }));
  });
});

describe("Activity's relay rows", () => {
  const activityDeps = (relaySignatures: RelaySignatureLog, nonce: readonly string[]) => ({
    activity: memoryActivityLog(),
    now: () => 9_000,
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    relaySignatures,
    rpcProviderFor: () => ({ callContract: async () => nonce }) as unknown as RpcProvider,
    runtimeRpc: {} as RuntimeRpc,
    session: unlocked(),
    wallet,
  });

  const seeded = async () => {
    const log = memoryRelaySignatureLog(() => 1);
    await recordRelaySignature(log, {
      account,
      messageHash: "0xabc",
      origin: ORIGIN,
      typedData: outside(),
    });
    return log;
  };

  test("an Activity refresh reads the chain and returns the outcome", async () => {
    const log = await seeded();
    const response = (await handleActivity(activityDeps(log, ["0x0"]), {
      refreshHistory: true,
      type: "wallet.activity",
    })) as { readonly relays?: readonly { readonly status: string }[] };
    expect(response.relays?.map((relay) => relay.status)).toEqual(["nonce-used"]);
  });

  test("an ambient refresh lists the rows without reading the chain", async () => {
    const log = await seeded();
    let reads = 0;
    const deps = {
      ...activityDeps(log, ["0x0"]),
      rpcProviderFor: () => {
        reads += 1;
        return {} as RpcProvider;
      },
    };
    const response = (await handleActivity(deps, { type: "wallet.activity" })) as {
      readonly relays?: readonly { readonly status: string }[];
    };
    expect(reads).toBe(0);
    expect(response.relays?.map((relay) => relay.status)).toEqual(["signed"]);
  });

  test("two messages sharing a used nonce are both reported as nonce used, not executed", async () => {
    const log = memoryRelaySignatureLog(() => 1);
    for (const hash of ["0xa1", "0xb2"]) {
      await recordRelaySignature(log, {
        account,
        messageHash: hash,
        origin: ORIGIN,
        typedData: outside(),
      });
    }
    const response = (await handleActivity(activityDeps(log, ["0x0"]), {
      refreshHistory: true,
      type: "wallet.activity",
    })) as { readonly relays?: readonly { readonly status: string }[] };
    expect(response.relays?.map((relay) => relay.status)).toEqual(["nonce-used", "nonce-used"]);
    expect(JSON.stringify(response)).not.toMatch(/executed/i);
  });

  test("no rows leaves the response shape unchanged", async () => {
    const response = await handleActivity(activityDeps(memoryRelaySignatureLog(), ["0x0"]), {
      cached: true,
      type: "wallet.activity",
    });
    expect(response).toEqual({ activity: [], ok: true });
  });
});
