/**
 * Phrase-driven Ready guardian escape: the owner-only carve-out, the status to
 * call mapping, the security period and completion window read from chain,
 * the owner-escape acknowledgement, the confirmed fee ceiling, and the submit
 * guards.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import {
  type ArgentRecoveryStep,
  getArgentRecoveryState,
  IndeterminateRpcWriteError,
  reviewArgentRecovery,
  submitArgentRecovery,
} from "@bramble/starknet/rpc";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RPC = ["https://rpc.example"];
const STRK = 10n ** 18n;
const BLOCK_TIME = 1_800_000_000;
const WEEK = 604_800;
const READY_AT = 1_700_000_000;
const hex = (value: number): string => `0x${value.toString(16)}`;

const account: AccountRef = {
  accountContractType: "argent",
  address: "0xa4e",
  classHash: canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH) as string,
  deploymentSalt: PUBLIC_KEY,
  derivation: { addressIndex: 1, kind: "argentx-bip44" },
  id: "SN_MAIN:0xa4e",
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY,
};

const ledgerAccount = {
  ...account,
  derivation: {
    accountIndex: 0,
    eip2645application: "argentx",
    kind: "ledger",
    path: "m/2645'/1195502025'/1148870696'/0'/0'/0",
  },
} as unknown as AccountRef;

type Chain = {
  /** get_guardian_backup's answer, or a contract revert / empty answer. */
  readonly backup?: string | "empty" | "revert";
  readonly escapeType?: string;
  readonly guardian?: string;
  readonly owner?: string;
  readonly ownerType?: string;
  readonly period?: string;
  readonly readyAt?: string;
  readonly status?: string;
  readonly waitFails?: boolean;
};

// A guardian-restricted 0.4.0 account: owner is the wallet key, a guardian is
// set, the escape and security period controllable per test. After a
// receipt, the escape reads back as `after` would leave it (cleared here).
const providerWith = (chain: Chain = {}): RpcProvider => {
  let confirmed = false;
  return {
    async getChainId() {
      return STARKNET_NETWORKS.SN_MAIN.chainId;
    },
    async getClassHashAt() {
      return canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH);
    },
    async getBlock() {
      return { block_hash: "0xb", timestamp: BLOCK_TIME };
    },
    async callContract({ entrypoint }: { readonly entrypoint: string }) {
      switch (entrypoint) {
        case "get_owner":
          return [chain.owner ?? PUBLIC_KEY];
        case "get_owner_type":
          return [chain.ownerType ?? "0x0"];
        case "get_guardian":
          return [chain.guardian ?? "0xabc"];
        case "get_guardian_backup":
          if (chain.backup === "revert") {
            // A node that answered: a contract-level failure, not transport.
            throw Object.assign(new Error("argent/only_guid"), { baseError: { code: 40 } });
          }
          return chain.backup === "empty" ? [] : [chain.backup ?? "0x0"];
        case "get_escape_security_period":
          return [chain.period ?? hex(WEEK)];
        case "get_escape_and_status":
          // (ready_at, escape_type, new_signer=None [1], status)
          return confirmed
            ? ["0x0", "0x0", "0x1", "0x0"]
            : [chain.readyAt ?? "0x0", chain.escapeType ?? "0x1", "0x1", chain.status ?? "0x0"];
        default:
          throw new Error(`unexpected read: ${entrypoint}`);
      }
    },
    async waitForTransaction() {
      if (chain.waitFails) throw new Error("receipt unavailable");
      confirmed = true;
      return {};
    },
  } as unknown as RpcProvider;
};

const PENDING: Chain = { readyAt: hex(READY_AT), status: "0x1" };
const READY: Chain = { readyAt: hex(READY_AT), status: "0x2" };
const EXPIRED: Chain = { readyAt: hex(READY_AT), status: "0x3" };
const OWNER_ESCAPE: Chain = { escapeType: "0x2", readyAt: hex(READY_AT), status: "0x1" };

type Recorded = { readonly call: unknown; readonly details: unknown }[];

const boundsFor = (spend: bigint) => ({
  l1_data_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
  l1_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
  l2_gas: { max_amount: `0x${spend.toString(16)}`, max_price_per_unit: "0x1" },
});

// Query account (estimates) and signing account (executes) stand-ins.
const fakes = (spend = 10n ** 15n, options: { readonly accepts?: string } = {}) => {
  const estimates: Recorded = [];
  const executes: Recorded = [];
  const makeQueryAccount = () =>
    ({
      async estimateInvokeFee(call: unknown, details: unknown) {
        estimates.push({ call, details });
        return { overall_fee: spend, resourceBounds: boundsFor(spend), unit: "FRI" as const };
      },
    }) as never;
  const makeAccount = (_p: unknown, _a: unknown, signer: (hash: string) => Promise<unknown>) =>
    ({
      async execute(call: unknown, details: unknown) {
        executes.push({ call, details });
        await signer("0x5");
        return { transaction_hash: options.accepts ?? "0x5" };
      },
    }) as never;
  return { estimates, executes, makeAccount, makeQueryAccount };
};

// The review must never ask a key to sign: a validated escape estimate goes
// through the query signer.
const forbiddenSigner = async (): Promise<never> => {
  throw new Error("the review must not sign");
};
const signHash = async (_hash: string) => ({ publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" });

const TRIGGER = {
  calldata: ["0x1"],
  contractAddress: account.address,
  entrypoint: "trigger_escape_guardian",
};
const COMPLETE = { calldata: [], contractAddress: account.address, entrypoint: "escape_guardian" };

const review = (chain: Chain = {}, spend = 10n ** 15n, subject: AccountRef = account) => {
  const doubles = fakes(spend);
  return {
    doubles,
    result: reviewArgentRecovery(
      { account: subject, rpcUrls: RPC, signHash: forbiddenSigner },
      () => providerWith(chain),
      doubles.makeQueryAccount,
    ),
  };
};

const submit = (
  chain: Chain,
  step: ArgentRecoveryStep | undefined,
  options: {
    readonly accepts?: string;
    readonly isAuthorized?: () => boolean;
    readonly replaceOwnerEscape?: boolean;
    readonly reviewed?: string;
    readonly spend?: bigint;
    readonly subject?: AccountRef;
  } = {},
) => {
  const doubles = fakes(options.spend, options.accepts ? { accepts: options.accepts } : {});
  const signed: string[] = [];
  return {
    doubles,
    result: submitArgentRecovery(
      {
        account: options.subject ?? account,
        ...(step ? { expectedStep: step } : {}),
        ...(options.isAuthorized ? { isAuthorized: options.isAuthorized } : {}),
        onSigned: (hash) => signed.push(hash),
        ...(options.replaceOwnerEscape ? { replaceOwnerEscape: true } : {}),
        reviewedFee: { overallFee: options.reviewed ?? "1500000000000000", unit: "FRI" },
        rpcUrls: RPC,
        signHash,
      },
      () => providerWith(chain),
      doubles.makeAccount,
      doubles.makeQueryAccount,
    ),
    signed,
  };
};

const VALIDATED = { skipValidate: false, tip: "0x0" };

beforeEach(() => resetRpcEndpointCooldownsForTests());

describe("argent recovery state", () => {
  test("maps every escape status, with the window from the chain's period", async () => {
    const read = (chain: Chain) =>
      getArgentRecoveryState({ accountAddress: account.address, rpcUrls: RPC }, () =>
        providerWith(chain),
      );
    const none = {
      expiresAt: null,
      guardianBackup: "absent" as const,
      ownerEscapePending: false,
      readyAt: null,
      securityPeriodSeconds: WEEK,
      status: "none" as const,
    };
    expect(await read({})).toEqual(none);
    const window = {
      expiresAt: READY_AT + WEEK,
      guardianBackup: "absent" as const,
      ownerEscapePending: false,
      readyAt: READY_AT,
    };
    expect(await read(PENDING)).toEqual({
      ...window,
      securityPeriodSeconds: WEEK,
      status: "pending",
    });
    expect(await read(READY)).toEqual({ ...window, securityPeriodSeconds: WEEK, status: "ready" });
    expect(await read(EXPIRED)).toEqual({
      ...window,
      securityPeriodSeconds: WEEK,
      status: "expired",
    });
    // A shortened security period moves the deadline with it.
    expect(await read({ ...READY, period: hex(600) })).toMatchObject({
      expiresAt: READY_AT + 600,
      securityPeriodSeconds: 600,
    });
  });

  test("reports a live owner escape instead of reading it as none", async () => {
    const read = (chain: Chain) =>
      getArgentRecoveryState({ accountAddress: account.address, rpcUrls: RPC }, () =>
        providerWith(chain),
      );
    expect(await read(OWNER_ESCAPE)).toMatchObject({ ownerEscapePending: true, status: "none" });
    expect(await read({ ...OWNER_ESCAPE, status: "0x2" })).toMatchObject({
      ownerEscapePending: true,
    });
    expect(await read({ ...OWNER_ESCAPE, status: "0x3" })).toMatchObject({
      ownerEscapePending: false,
    });
    await expect(read({ ...PENDING, status: "0x9" })).rejects.toThrow("unrecognised escape status");
  });
});

describe("argent recovery backup guardian", () => {
  const read = (chain: Chain) =>
    getArgentRecoveryState({ accountAddress: account.address, rpcUrls: RPC }, () =>
      providerWith(chain),
    );

  test("the state reports a backup guardian, and an unanswered read as unknown", async () => {
    expect((await read({ backup: "0xb4c" })).guardianBackup).toBe("present");
    expect((await read({ backup: "revert" })).guardianBackup).toBe("unknown");
    expect((await read({ backup: "empty" })).guardianBackup).toBe("unknown");
  });

  test("review refuses before estimating, and fails closed when the read fails", async () => {
    const present = review({ backup: "0xb4c" });
    await expect(present.result).rejects.toThrow("has a backup guardian");
    expect(present.doubles.estimates).toHaveLength(0);
    for (const backup of ["revert", "empty"] as const) {
      const unchecked = review({ backup });
      await expect(unchecked.result).rejects.toThrow(
        "Could not check this account's backup guardian",
      );
      expect(unchecked.doubles.estimates).toHaveLength(0);
    }
  });

  test("submit refuses before signing, for either step", async () => {
    for (const [chain, step] of [
      [{ backup: "0xb4c" }, "start"],
      [{ ...READY, backup: "0xb4c" }, "complete"],
      [{ backup: "revert" }, "start"],
    ] as const) {
      const refused = submit(chain, step);
      await expect(refused.result).rejects.toThrow(/backup guardian/);
      expect(refused.doubles.executes).toHaveLength(0);
    }
  });
});

describe("argent recovery review", () => {
  test("starts with trigger_escape_guardian(None), estimated validated and keyless", async () => {
    for (const chain of [{}, EXPIRED]) {
      const { doubles, result } = review(chain);
      expect(await result).toEqual({
        expiresAt: BLOCK_TIME + 2 * WEEK,
        fee: { overallFee: "1500000000000000", unit: "FRI" },
        readyAt: BLOCK_TIME + WEEK,
        replacesOwnerEscape: false,
        step: "start",
      });
      expect(doubles.estimates).toEqual([{ call: TRIGGER, details: VALIDATED }]);
    }
  });

  test("states the window from the account's own security period", async () => {
    expect(await review({ period: hex(600) }).result).toMatchObject({
      expiresAt: BLOCK_TIME + 1200,
      readyAt: BLOCK_TIME + 600,
    });
  });

  test("completes a ready escape with escape_guardian() and its real deadline", async () => {
    const { doubles, result } = review(READY);
    expect(await result).toEqual({
      expiresAt: READY_AT + WEEK,
      fee: { overallFee: "1500000000000000", unit: "FRI" },
      readyAt: READY_AT,
      replacesOwnerEscape: false,
      step: "complete",
    });
    expect(doubles.estimates).toEqual([{ call: COMPLETE, details: VALIDATED }]);
  });

  test("refuses during the waiting period", async () => {
    await expect(review(PENDING).result).rejects.toThrow("waiting period");
  });

  test("flags that starting cancels a pending owner escape", async () => {
    expect(await review(OWNER_ESCAPE).result).toMatchObject({
      replacesOwnerEscape: true,
      step: "start",
    });
  });

  test("caps the stated fee at the account's 5 STRK escape limit", async () => {
    expect((await review({}, 4n * STRK).result).fee.overallFee).toBe((5n * STRK).toString());
    await expect(review({}, 6n * STRK).result).rejects.toThrow("on-chain cap");
  });

  test("refuses accounts the carve-out does not cover", async () => {
    await expect(review({ guardian: "0x0" }).result).rejects.toThrow("no guardian to remove");
    await expect(review({ owner: "0x999" }).result).rejects.toThrow("does not match");
    await expect(review({ ownerType: "0x1" }).result).rejects.toThrow("does not match");
    await expect(review({}, 10n ** 15n, ledgerAccount).result).rejects.toThrow("Ledger");
  });
});

describe("argent recovery submit", () => {
  test("starts the escape under the reviewed bounds and returns the window", async () => {
    const { doubles, result, signed } = submit({}, "start");
    // The receipt clears this double's escape; the window is read back live.
    expect(await result).toEqual({ expiresAt: null, readyAt: null, transactionHash: "0x5" });
    expect(doubles.estimates).toEqual([{ call: TRIGGER, details: VALIDATED }]);
    expect(doubles.executes).toEqual([
      { call: TRIGGER, details: { resourceBounds: boundsFor(10n ** 15n), tip: "0x0" } },
    ]);
    expect(signed).toEqual(["0x5"]);
  });

  test("completes a ready escape and never re-triggers it", async () => {
    const { doubles, result } = submit(READY, "complete");
    await result;
    expect(doubles.executes.map((entry) => entry.call)).toEqual([COMPLETE]);
  });

  test("refuses a step other than the one confirmed, and an early completion", async () => {
    await expect(submit({}, "complete").result).rejects.toThrow("step changed");
    await expect(submit(READY, "start").result).rejects.toThrow("step changed");
    await expect(submit(PENDING, "complete").result).rejects.toThrow("waiting period");
    await expect(submit({}, undefined).result).rejects.toThrow("not reviewed");
  });

  test("cancels a pending owner escape only when the user acknowledged it", async () => {
    const silent = submit(OWNER_ESCAPE, "start");
    await expect(silent.result).rejects.toThrow("key change is pending");
    expect(silent.doubles.executes).toHaveLength(0);
    const acknowledged = submit(OWNER_ESCAPE, "start", { replaceOwnerEscape: true });
    await acknowledged.result;
    expect(acknowledged.doubles.executes.map((entry) => entry.call)).toEqual([TRIGGER]);
  });

  test("holds the fee to the confirmed ceiling and the on-chain cap", async () => {
    await submit({}, "start", { spend: 1_500_000_000_000_000n }).result;
    const over = submit({}, "start", { spend: 1_500_000_000_000_001n });
    await expect(over.result).rejects.toThrow("recovery fee changed");
    expect(over.doubles.executes).toHaveLength(0);
    await expect(
      submit({}, "start", { reviewed: (50n * STRK).toString(), spend: 6n * STRK }).result,
    ).rejects.toThrow("recovery fee changed");
  });

  test("re-checks the account before signing", async () => {
    for (const chain of [{ owner: "0x999" }, { ownerType: "0x1" }, { guardian: "0x0" }]) {
      const refused = submit(chain, "start");
      await expect(refused.result).rejects.toThrow(/does not match|no guardian/);
      expect(refused.doubles.executes).toHaveLength(0);
    }
    await expect(submit({}, "start", { subject: ledgerAccount }).result).rejects.toThrow("Ledger");
  });

  test("a lock after signing revokes it; a mismatched or lost reply is indeterminate", async () => {
    await expect(submit({}, "start", { isAuthorized: () => false }).result).rejects.toThrow(
      "wallet locked",
    );
    const mismatch = await submit({}, "start", { accepts: "0x6" }).result.catch((e: unknown) => e);
    expect(mismatch).toBeInstanceOf(IndeterminateRpcWriteError);
    // An indeterminate write cools its endpoint down; start the next one fresh.
    resetRpcEndpointCooldownsForTests();
    const lost = await submit({ waitFails: true }, "start").result.catch((e: unknown) => e);
    expect(lost).toBeInstanceOf(IndeterminateRpcWriteError);
  });
});
