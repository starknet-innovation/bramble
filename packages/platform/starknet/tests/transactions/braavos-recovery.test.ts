/**
 * Seed-driven Braavos 2FA removal: the stark-key carve-out, the exact call,
 * the validated estimate, the confirmed fee ceiling, the lock and hash checks
 * at submit, and the account-state refusals.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import {
  DEFAULT_BRAAVOS_RECOVERY_DELAY_SECONDS,
  getBraavosRecoveryState,
  IndeterminateRpcWriteError,
  reviewBraavosRecovery,
  submitBraavosRecovery,
} from "@bramble/starknet/rpc";
import {
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RPC = ["https://rpc.example"];
const STRK = 10n ** 18n;
const BLOCK_TIME = 1_800_000_000;

const account: AccountRef = {
  accountContractType: "braavos",
  address: "0xb4a",
  classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
  deploymentSalt: PUBLIC_KEY,
  derivation: { accountIndex: 0, addressIndex: 1, kind: "starknet-bip44" },
  id: "SN_MAIN:0xb4a",
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY,
  publicKeyY: "0x1",
};

const ledgerAccount = {
  ...account,
  derivation: {
    accountIndex: 0,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: "m/2645'/1195502025'/734980059'/0'/0'/0",
  },
} as unknown as AccountRef;

// A strong-signer account: stark key registered, a secp256r1 signer present,
// no deferred request pending.
const guardedReads: Record<string, readonly string[]> = {
  get_deferred_remove_signers: ["0x0"],
  get_execution_time_delay: ["0x0"],
  get_signers: ["0x1", PUBLIC_KEY, "0x1", "0xaa", "0x0"],
};

const providerWith = (
  reads: Record<string, readonly string[]>,
  options: { readonly log?: string[]; readonly waitFails?: boolean } = {},
): RpcProvider => {
  // After the receipt, the request the submission wrote reads back.
  let confirmed = false;
  return {
    async getChainId() {
      return STARKNET_NETWORKS.SN_MAIN.chainId;
    },
    async getClassHashAt(_address: string, block: string) {
      options.log?.push(`class@${block}`);
      return BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH;
    },
    async getBlockLatestAccepted() {
      return { block_hash: "0xb10c", block_number: 7 };
    },
    async getBlock() {
      return { block_hash: "0xb", timestamp: BLOCK_TIME };
    },
    async callContract({ entrypoint }: { readonly entrypoint: string }, block: string) {
      options.log?.push(`${entrypoint}@${block}`);
      if (confirmed && entrypoint === "get_deferred_remove_signers") {
        return [`0x${(BLOCK_TIME + DEFAULT_BRAAVOS_RECOVERY_DELAY_SECONDS).toString(16)}`];
      }
      const result = reads[entrypoint];
      if (!result) throw new Error(`unexpected read: ${entrypoint}`);
      return [...result];
    },
    async waitForTransaction() {
      if (options.waitFails) throw new Error("receipt unavailable");
      confirmed = true;
      return {};
    },
  } as unknown as RpcProvider;
};

type Recorded = {
  readonly estimates: { readonly call: unknown; readonly details: unknown }[];
  readonly executes: { readonly call: unknown; readonly details: unknown }[];
};

// A stand-in starknet Account. The spend is read from the bounds, so the
// l2_gas bound carries the intended fee (amount x price 1). `execute` signs
// `signs` through the signer the module handed in, then reports `accepts`.
const fakeAccounts = (
  spend: bigint,
  options: { readonly accepts?: string; readonly signs?: string } = {},
) => {
  const recorded: Recorded = { estimates: [], executes: [] };
  const resourceBounds = {
    l1_data_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
    l1_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
    l2_gas: { max_amount: `0x${spend.toString(16)}`, max_price_per_unit: "0x1" },
  };
  const make = (
    _provider: unknown,
    _account: unknown,
    signer: (hash: string) => Promise<unknown>,
  ) =>
    ({
      async estimateInvokeFee(call: unknown, details: unknown) {
        recorded.estimates.push({ call, details });
        return { overall_fee: spend, resourceBounds, unit: "FRI" as const };
      },
      async execute(call: unknown, details: unknown) {
        recorded.executes.push({ call, details });
        const signs = options.signs ?? "0x5";
        await signer(signs);
        return { transaction_hash: options.accepts ?? signs };
      },
    }) as never;
  return { make, recorded, resourceBounds };
};

const signHash = async (_hash: string) => ({ publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" });

const RECOVERY_CALL = {
  calldata: [],
  contractAddress: account.address,
  entrypoint: "deferred_remove_signers",
};

const review = (reads = guardedReads, spend = 10n ** 15n, subject: AccountRef = account) => {
  const accounts = fakeAccounts(spend);
  return {
    accounts,
    result: reviewBraavosRecovery(
      { account: subject, rpcUrls: RPC, signHash },
      () => providerWith(reads),
      accounts.make,
    ),
  };
};

const submit = (
  options: {
    readonly accepts?: string;
    readonly isAuthorized?: () => boolean;
    readonly reads?: Record<string, readonly string[]>;
    readonly reviewed?: { readonly overallFee: string; readonly unit: "FRI" | "WEI" } | null;
    readonly spend?: bigint;
    readonly subject?: AccountRef;
    readonly waitFails?: boolean;
  } = {},
) => {
  const accounts = fakeAccounts(
    options.spend ?? 10n ** 15n,
    options.accepts ? { accepts: options.accepts } : {},
  );
  const signed: string[] = [];
  const reviewed =
    options.reviewed === undefined
      ? { overallFee: "1500000000000000", unit: "FRI" as const }
      : options.reviewed;
  return {
    accounts,
    result: submitBraavosRecovery(
      {
        account: options.subject ?? account,
        ...(options.isAuthorized ? { isAuthorized: options.isAuthorized } : {}),
        onSigned: (hash) => signed.push(hash),
        ...(reviewed ? { reviewedFee: reviewed } : {}),
        rpcUrls: RPC,
        signHash,
      },
      () =>
        providerWith(options.reads ?? guardedReads, options.waitFails ? { waitFails: true } : {}),
      accounts.make,
    ),
    signed,
  };
};

beforeEach(() => resetRpcEndpointCooldownsForTests());

describe("braavos recovery review", () => {
  test("quotes the exact removal call with validation on, and the effect time", async () => {
    const { accounts, result } = review();
    expect(await result).toEqual({
      delaySeconds: DEFAULT_BRAAVOS_RECOVERY_DELAY_SECONDS,
      effectiveAfter: BLOCK_TIME + DEFAULT_BRAAVOS_RECOVERY_DELAY_SECONDS,
      // The validated spend plus the stated 50% headroom: the ceiling the
      // submission is then held to.
      fee: { overallFee: "1500000000000000", unit: "FRI" },
    });
    expect(accounts.recorded.estimates).toEqual([
      { call: RECOVERY_CALL, details: { skipValidate: false, tip: "0x0" } },
    ]);
  });

  test("never states a ceiling above the account's 100 STRK cap", async () => {
    expect((await review(guardedReads, 80n * STRK).result).fee).toEqual({
      overallFee: (100n * STRK).toString(),
      unit: "FRI",
    });
    await expect(review(guardedReads, 101n * STRK).result).rejects.toThrow("on-chain cap");
  });

  test("uses the account's own delay when it set one", async () => {
    const { result } = review({ ...guardedReads, get_execution_time_delay: ["0x15180"] });
    expect(await result).toMatchObject({
      delaySeconds: 86_400,
      effectiveAfter: BLOCK_TIME + 86_400,
    });
  });

  test("refuses accounts the carve-out does not cover", async () => {
    await expect(
      review({ ...guardedReads, get_signers: ["0x1", PUBLIC_KEY, "0x0", "0x0"] }).result,
    ).rejects.toThrow("no 2FA signer to remove");
    // The stark key is not this wallet's: refused, whatever the restriction.
    await expect(
      review({ ...guardedReads, get_signers: ["0x1", "0x999", "0x1", "0xaa", "0x0"] }).result,
    ).rejects.toThrow("does not match the wallet signer");
    await expect(
      review({
        ...guardedReads,
        get_deferred_remove_signers: [`0x${(BLOCK_TIME + 60).toString(16)}`],
      }).result,
    ).rejects.toThrow("already pending");
    await expect(review(guardedReads, 10n ** 15n, ledgerAccount).result).rejects.toThrow(
      "not available for Ledger accounts",
    );
  });

  test("an expired request has already lifted 2FA, so there is nothing to recover", async () => {
    const expired = { ...guardedReads, get_deferred_remove_signers: ["0x5"] };
    await expect(review(expired).result).rejects.toThrow("no 2FA signer to remove");
    await expect(submit({ reads: expired }).result).rejects.toThrow("no 2FA signer to remove");
  });
});

describe("braavos recovery submit", () => {
  test("signs the exact removal call under the reviewed bounds and reports the hash", async () => {
    const { accounts, result, signed } = submit();
    expect(await result).toEqual({
      pendingUntil: BLOCK_TIME + DEFAULT_BRAAVOS_RECOVERY_DELAY_SECONDS,
      transactionHash: "0x5",
    });
    expect(accounts.recorded.estimates).toEqual([
      { call: RECOVERY_CALL, details: { skipValidate: false, tip: "0x0" } },
    ]);
    expect(accounts.recorded.executes).toEqual([
      { call: RECOVERY_CALL, details: { resourceBounds: accounts.resourceBounds, tip: "0x0" } },
    ]);
    expect(signed).toEqual(["0x5"]);
  });

  test("refuses a fee over the confirmed ceiling or the on-chain cap", async () => {
    const over = submit({ spend: 1_500_000_000_000_001n });
    await expect(over.result).rejects.toThrow("recovery fee changed");
    expect(over.accounts.recorded.executes).toHaveLength(0);
    const overCap = submit({
      reviewed: { overallFee: (200n * STRK).toString(), unit: "FRI" },
      spend: 150n * STRK,
    });
    await expect(overCap.result).rejects.toThrow("recovery fee changed");
    await expect(
      submit({ reviewed: { overallFee: "1500000000000000", unit: "WEI" } }).result,
    ).rejects.toThrow("recovery fee changed");
    await expect(submit({ reviewed: null }).result).rejects.toThrow("not reviewed");
  });

  test("an explicit lock between signing and broadcast revokes the submission", async () => {
    const { accounts, result, signed } = submit({ isAuthorized: () => false });
    await expect(result).rejects.toThrow("wallet locked");
    expect(accounts.recorded.executes).toHaveLength(1);
    expect(signed).toEqual([]);
  });

  test("a node that accepts a different hash is post-broadcast ambiguity", async () => {
    const { result } = submit({ accepts: "0x6" });
    const error = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IndeterminateRpcWriteError);
    expect((error as Error).message).toContain("different transaction hash");
  });

  test("a lost confirmation after acceptance is indeterminate, not a failure", async () => {
    const error = await submit({ waitFails: true }).result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IndeterminateRpcWriteError);
  });

  test("re-checks the account before signing", async () => {
    for (const reads of [
      { ...guardedReads, get_signers: ["0x1", "0x999", "0x1", "0xaa", "0x0"] },
      { ...guardedReads, get_signers: ["0x1", PUBLIC_KEY, "0x0", "0x0"] },
    ]) {
      const refused = submit({ reads });
      await expect(refused.result).rejects.toThrow(/does not match|no 2FA signer/);
      expect(refused.accounts.recorded.executes).toHaveLength(0);
    }
    await expect(submit({ subject: ledgerAccount }).result).rejects.toThrow("Ledger");
  });
});

describe("braavos recovery gate", () => {
  test("reads the class, signers and pending request at one accepted block", async () => {
    const log: string[] = [];
    await reviewBraavosRecovery(
      { account, rpcUrls: RPC, signHash },
      () => providerWith(guardedReads, { log }),
      fakeAccounts(10n ** 15n).make,
    );
    // The verdict reads the request once, the pending-request gate once more.
    expect(log.slice(0, 4)).toEqual([
      "class@0xb10c",
      "get_signers@0xb10c",
      "get_deferred_remove_signers@0xb10c",
      "get_deferred_remove_signers@0xb10c",
    ]);
  });
});

describe("braavos recovery state", () => {
  test("reads the pending state and the account's delay", async () => {
    const none = await getBraavosRecoveryState(
      { accountAddress: account.address, rpcUrls: RPC },
      () => providerWith(guardedReads),
    );
    expect(none).toEqual({
      delaySeconds: DEFAULT_BRAAVOS_RECOVERY_DELAY_SECONDS,
      pendingUntil: null,
    });
    const pending = await getBraavosRecoveryState(
      { accountAddress: account.address, rpcUrls: RPC },
      () =>
        providerWith({
          ...guardedReads,
          get_deferred_remove_signers: ["0x2710"],
          get_execution_time_delay: ["0x15180"],
        }),
    );
    expect(pending).toEqual({ delaySeconds: 86_400, pendingUntil: 10_000 });
  });
});
