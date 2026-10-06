/**
 * Shared doubles for the Ready guardian-escape platform tests: a chain double
 * whose escape, period, owner, guardian and backup reads are set per test,
 * query/signing account stand-ins that record calls, and review/submit
 * drivers. Test-only; never imported by production code.
 */
import {
  type ArgentRecoveryStep,
  reviewArgentRecovery,
  submitArgentRecovery,
} from "@bramble/starknet/rpc";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const RPC = ["https://rpc.example"];
export const STRK = 10n ** 18n;
export const BLOCK_TIME = 1_800_000_000;
export const WEEK = 604_800;
export const READY_AT = 1_700_000_000;
export const hex = (value: number): string => `0x${value.toString(16)}`;

export const account: AccountRef = {
  accountContractType: "argent",
  address: "0xa4e",
  classHash: canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH) as string,
  deploymentSalt: PUBLIC_KEY,
  derivation: { addressIndex: 1, kind: "argentx-bip44" },
  id: "SN_MAIN:0xa4e",
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY,
};

export const ledgerAccount = {
  ...account,
  derivation: {
    accountIndex: 0,
    eip2645application: "argentx",
    kind: "ledger",
    path: "m/2645'/1195502025'/1148870696'/0'/0'/0",
  },
} as unknown as AccountRef;

export type Chain = {
  /** get_guardian_backup's answer, or a contract revert / empty answer. */
  readonly backup?: string | "empty" | "revert";
  readonly escapeType?: string;
  /** A guardian escape to a NEW guardian: new_signer = Some(this key). */
  readonly newGuardian?: string;
  /** Overrides the raw get_escape_and_status answer (malformed-serde cases). */
  readonly rawEscape?: readonly string[];
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
export const providerWith = (chain: Chain = {}): RpcProvider => {
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
          // (ready_at, escape_type, new_signer, status): None is [1]; Some is
          // [0, stored_value, signer_type].
          if (confirmed) return ["0x0", "0x0", "0x1", "0x0"];
          if (chain.rawEscape) return [...chain.rawEscape];
          return [
            chain.readyAt ?? "0x0",
            chain.escapeType ?? "0x1",
            ...(chain.newGuardian ? ["0x0", chain.newGuardian, "0x0"] : ["0x1"]),
            chain.status ?? "0x0",
          ];
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

export const PENDING: Chain = { readyAt: hex(READY_AT), status: "0x1" };
export const READY: Chain = { readyAt: hex(READY_AT), status: "0x2" };
export const EXPIRED: Chain = { readyAt: hex(READY_AT), status: "0x3" };
export const OWNER_ESCAPE: Chain = { escapeType: "0x2", readyAt: hex(READY_AT), status: "0x1" };
export const GUARDIAN_CHANGE: Chain = {
  newGuardian: "0xc4a",
  readyAt: hex(READY_AT),
  status: "0x2",
};

type Recorded = { readonly call: unknown; readonly details: unknown }[];

export const boundsFor = (spend: bigint) => ({
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

export const TRIGGER = {
  calldata: ["0x1"],
  contractAddress: account.address,
  entrypoint: "trigger_escape_guardian",
};
export const COMPLETE = {
  calldata: [],
  contractAddress: account.address,
  entrypoint: "escape_guardian",
};

export const review = (chain: Chain = {}, spend = 10n ** 15n, subject: AccountRef = account) => {
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

export const submit = (
  chain: Chain,
  step: ArgentRecoveryStep | undefined,
  options: {
    readonly accepts?: string;
    readonly isAuthorized?: () => boolean;
    readonly replaceEscapeReadyAt?: number;
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
        ...(options.replaceEscapeReadyAt !== undefined
          ? { replaceEscapeReadyAt: options.replaceEscapeReadyAt }
          : {}),
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

export const VALIDATED = { skipValidate: false, tip: "0x0" };
