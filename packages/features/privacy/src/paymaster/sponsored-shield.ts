/**
 * Sponsored first shield (#789, option A of the paymaster epic #752): the
 * Starknet Foundation's relay calls the pool's `apply_actions` itself, so the
 * pool collects its STRK fee from the relay and the relay pays the gas. The
 * user's only public calls are the deposit approvals, executed by the relay
 * from SNIP-9 typed data the user signs, so a new user can shield without
 * holding STRK.
 *
 * Nothing is recovered from the user: a sponsored quote carries no fee action.
 * That is the whole difference from the sponsored-private route
 * (`./paymaster`), which withdraws its fee from a private balance a first
 * shield does not have yet. Recovering the fee from the deposited token instead
 * would link the deposit to later private spending on chain (Sherlock 189).
 *
 * The relay URL is wallet-configured and on for mainnet and Sepolia; the
 * gateway behind it, built and run outside Bramble, is the on/off switch.
 * While sponsorship is switched off there it answers 404, which the wallet
 * reads as "not offered": the user shields self-paid and pays as before, and
 * is never told a sponsor was asked. The request and answer shapes this module
 * accepts are the contract the gateway must implement; anything else fails
 * closed before the user signs.
 *
 * Transport and lost-reply classification are shared with the sponsored-deploy
 * relay (`./sponsored-deploy-rpc`): only a clean JSON-RPC error is a refusal.
 */

import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
} from "@bramble/starknet/provider";
import { isPaymasterAuthorizationLive } from "@bramble/transactions/outside-execution-window";
import type { PaymasterHttp } from "@bramble/transactions/paymaster-http";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import type { Strk20Proof } from "@bramble/wallet-protocol/strk20";
import { type Call, CallData, hash } from "starknet";
import type { SponsoredShieldConfig, Strk20SponsoredShieldPlan } from "../policy/submission-plan";
import { formatStrk20PoolFee } from "../policy/summaries";
import type { Strk20PreparedSubmissionInput } from "../service";
import { BROADCAST_PAYMASTER_METHOD } from "./paymaster-rpc";
import { bindPaymasterTypedData } from "./paymaster-typed-data";
import { SPONSORED_DEPLOY_SPONSOR } from "./sponsored-deploy";
import { postSponsoredRelay } from "./sponsored-deploy-rpc";

/** The relay entry and frozen plan, defined with the other submission routes. */
export type { SponsoredShieldConfig, Strk20SponsoredShieldPlan } from "../policy/submission-plan";

/** Who pays a sponsored shield's pool fee and gas, as the review names them. */
export const SPONSORED_SHIELD_SPONSOR = SPONSORED_DEPLOY_SPONSOR;

/** Per-network relays; a network with no entry has sponsorship off. */
export type SponsoredShieldNetworks = Readonly<
  Partial<Record<StarknetNetworkId, SponsoredShieldConfig>>
>;

/**
 * The wallet-owned gateway's sponsored-shield routes. The gateway is the on/off
 * switch: while a network is switched off there it answers every call 404,
 * which the wallet reads as "nothing offered" and shields self-paid as if
 * sponsorship did not exist. Its budget and abuse limits live there too, and it
 * stays the authority on whether it sponsors any given shield. Removing a
 * network here stops the wallet asking.
 */
export const SPONSORED_SHIELD_NETWORKS: SponsoredShieldNetworks = {
  SN_MAIN: { url: "https://wallet.nodes.starknet.org/api/sponsored-shield/mainnet" },
  SN_SEPOLIA: { url: "https://wallet.nodes.starknet.org/api/sponsored-shield/sepolia" },
};

/** The relay for `networkId`, or null when sponsorship is off there. */
export const sponsoredShieldConfig = (
  networkId: StarknetNetworkId,
  networks: SponsoredShieldNetworks = SPONSORED_SHIELD_NETWORKS,
): SponsoredShieldConfig | null =>
  Object.hasOwn(networks, networkId) ? (networks[networkId] ?? null) : null;

/** The relay refused a reviewed sponsored shield at broadcast; nothing was sent. */
export const SPONSORED_SHIELD_DECLINED = "The sponsor declined this shield. Nothing was sent.";

/** A reviewed sponsored shield whose authorization window has run out; nothing was sent. */
export const SPONSORED_SHIELD_EXPIRED = "This shield review expired. Start again.";

/**
 * The relay explicitly refused (its own clean JSON-RPC error): nothing was
 * sent. At quote time the wallet falls back to a self-paid shield without
 * saying so. `reason` is the relay's untrusted message, never shown.
 */
export class SponsoredShieldRefusedError extends WalletError {
  readonly reason: string;
  constructor(reason: string) {
    super("sponsored shield refused");
    this.name = "SponsoredShieldRefusedError";
    this.reason = reason;
  }
}

/**
 * A quote that failed without an explicit refusal: transport, deadline, 5xx,
 * a bare 4xx, or an answer outside the contract. Nothing was sent; the wallet
 * falls back to a self-paid shield. A diagnostic, never shown.
 */
export class SponsoredShieldUnavailableError extends WalletError {
  constructor() {
    super("sponsored shield unavailable");
    this.name = "SponsoredShieldUnavailableError";
  }
}

/**
 * What the privacy service needs to relay a reviewed sponsored shield: the
 * prepared deposit batch (deposit approvals, then the pool's `apply_actions`
 * as the last call) and the plan and relay it was quoted on.
 */
export type Strk20SponsoredShieldSubmissionInput = Strk20PreparedSubmissionInput & {
  readonly plan: Strk20SponsoredShieldPlan;
  readonly relay: SponsoredShieldConfig;
};

const PARAMETERS = { fee_mode: { mode: "sponsored" }, version: "0x1" } as const;
const TRANSACTION_TYPE = "invoke_and_apply_action";
const FEE_KEYS = [
  "estimated_fee_in_gas_token",
  "estimated_fee_in_strk",
  "gas_token_price_in_strk",
  "suggested_max_fee_in_gas_token",
  "suggested_max_fee_in_strk",
] as const;

const relayFelt = (value: string, allowZero: boolean): string => {
  const canonical = canonicalFelt(value);
  if (
    canonical === null ||
    (allowZero ? !isStarkFieldElement(canonical) : !isNonZeroStarkFieldElement(canonical))
  ) {
    throw new SponsoredShieldUnavailableError();
  }
  return canonical;
};

// The relay's OpenRPC schema takes felts as canonical 0x-prefixed hex, as on
// the sponsored-private route.
const relayCall = (call: Call) => ({
  calldata: CallData.compile(call.calldata ?? []).map((felt) => relayFelt(String(felt), true)),
  selector: relayFelt(hash.getSelectorFromName(call.entrypoint), false),
  to: relayFelt(call.contractAddress, false),
});

// The echo must still say sponsored. A quote that switched the fee mode would
// charge someone, and the review tells the user nobody charges them.
const isSponsoredParameters = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["fee_mode", "time_bounds", "version"]) ||
    value["version"] !== PARAMETERS.version ||
    (value["time_bounds"] !== undefined && value["time_bounds"] !== null)
  ) {
    return false;
  }
  const mode = value["fee_mode"];
  return (
    isRecord(mode) &&
    hasOnlyKnownKeys(mode, ["mode", "tip"]) &&
    mode["mode"] === "sponsored" &&
    (mode["tip"] === undefined || mode["tip"] === "normal")
  );
};

// Informational gas estimate, shape-checked so a malformed quote fails closed
// rather than being half-read.
const informationalFee = (value: unknown): { readonly fri?: string } | null => {
  if (value === undefined) return {};
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, FEE_KEYS) ||
    !Object.values(value).every((entry) => typeof entry === "string" && isStarkFieldElement(entry))
  ) {
    return null;
  }
  const strk =
    typeof value["estimated_fee_in_strk"] === "string" ? value["estimated_fee_in_strk"] : null;
  const fri = strk === null ? null : canonicalFelt(strk);
  return fri === null ? {} : { fri };
};

/**
 * Asks the relay to sponsor one deposit-only batch whose public half is
 * `approveCalls` (the deposit approvals, with no pool-fee approval: the relay
 * pays the pool). Resolves only for an answer that commits to exactly those
 * calls, for this account and chain, under sponsored parameters, and carries
 * no fee action. Every failure is determinate, since a quote never broadcasts:
 * {@link SponsoredShieldRefusedError} for the relay's own clean JSON-RPC
 * error, otherwise {@link SponsoredShieldUnavailableError}.
 */
export const quoteSponsoredShield = async (input: {
  readonly accountAddress: string;
  readonly approveCalls: readonly Call[];
  readonly chainId: string;
  readonly config: SponsoredShieldConfig;
  readonly http?: PaymasterHttp;
  readonly nowSeconds: number;
  readonly poolAddress: string;
}): Promise<Strk20SponsoredShieldPlan> => {
  if (
    input.approveCalls.length === 0 ||
    input.approveCalls.some((c) => c.entrypoint !== "approve")
  ) {
    throw new SponsoredShieldUnavailableError();
  }
  const answer = await postSponsoredRelay(
    input.http ?? fetch,
    input.config.url,
    "paymaster_buildTransaction",
    {
      parameters: PARAMETERS,
      transaction: {
        apply_action: { pool_address: relayFelt(input.poolAddress, false) },
        invoke: {
          calls: input.approveCalls.map(relayCall),
          user_address: relayFelt(input.accountAddress, false),
        },
        type: TRANSACTION_TYPE,
      },
    },
  );
  if (answer.kind === "refused") throw new SponsoredShieldRefusedError(answer.message);
  if (answer.kind === "lost") throw new SponsoredShieldUnavailableError();
  const result = answer.result;
  // A fee action in any form means the relay intends to recover its fee from
  // the user's private balance or the deposit: refused, never reinterpreted.
  if (
    !isRecord(result) ||
    !hasOnlyKnownKeys(result, ["fee", "parameters", "type", "typed_data"]) ||
    result["type"] !== TRANSACTION_TYPE ||
    !isSponsoredParameters(result["parameters"])
  ) {
    throw new SponsoredShieldUnavailableError();
  }
  const fee = informationalFee(result["fee"]);
  const bound = bindPaymasterTypedData({
    accountAddress: input.accountAddress,
    calls: input.approveCalls,
    chainId: input.chainId,
    nowSeconds: input.nowSeconds,
    value: result["typed_data"],
  });
  if (!fee || !bound) {
    throw new SponsoredShieldUnavailableError();
  }
  return {
    authorization: bound.review,
    ...(fee.fri === undefined ? {} : { estimatedNetworkFeeFri: fee.fri }),
    mode: "sponsored-deposit",
    sponsor: SPONSORED_SHIELD_SPONSOR,
    typedData: bound.typedData,
  };
};

/**
 * Broadcasts a quoted sponsored shield. Determinate failures: anything refused
 * before the request leaves (a window with under ten seconds left, a lock,
 * "wallet locked") and the relay's clean JSON-RPC refusal
 * ({@link SPONSORED_SHIELD_DECLINED}). Every other answer, including a
 * result without a usable hash, is an {@link IndeterminateRpcWriteError}: the
 * relay may already have submitted, so the caller holds its state closed and
 * never retries. There is no fallback here: the user approved this route.
 */
export const submitSponsoredShield = async (input: {
  readonly accountAddress: string;
  readonly call: Call;
  readonly config: SponsoredShieldConfig;
  readonly http?: PaymasterHttp;
  readonly isAuthorized: () => boolean;
  readonly nowSeconds: number;
  readonly plan: Strk20SponsoredShieldPlan;
  readonly proof: Strk20Proof;
  readonly signTypedData: (typedData: unknown) => Promise<readonly string[]>;
}): Promise<{ readonly transactionHash: string }> => {
  if (
    input.plan.mode !== "sponsored-deposit" ||
    !isPaymasterAuthorizationLive(input.plan.authorization, input.nowSeconds, 10n)
  ) {
    throw new WalletError(SPONSORED_SHIELD_EXPIRED);
  }
  const applyActionsCall = relayCall(input.call);
  const signature = await input.signTypedData(input.plan.typedData);
  // Proving and signing can take a while; this is the last point before send.
  if (!input.isAuthorized()) {
    throw new WalletError("wallet locked");
  }
  const answer = await postSponsoredRelay(
    input.http ?? fetch,
    input.config.url,
    BROADCAST_PAYMASTER_METHOD,
    {
      parameters: PARAMETERS,
      transaction: {
        apply_action: {
          apply_actions_call: applyActionsCall,
          proof: input.proof.data,
          proof_facts: input.proof.proof_facts,
        },
        invoke: {
          signature,
          typed_data: input.plan.typedData,
          user_address: relayFelt(input.accountAddress, false),
        },
        type: TRANSACTION_TYPE,
      },
    },
  );
  // A broadcast refusal is shown, unlike a quote's: the user approved this
  // route, and nothing silently replaces it after review.
  if (answer.kind === "refused") throw new WalletError(SPONSORED_SHIELD_DECLINED);
  const result = answer.kind === "result" ? answer.result : undefined;
  if (
    !isRecord(result) ||
    typeof result["transaction_hash"] !== "string" ||
    !isNonZeroStarkFieldElement(result["transaction_hash"])
  ) {
    throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
  }
  return { transactionHash: result["transaction_hash"] };
};

/**
 * The review line for a sponsored shield: who pays, and what, so the
 * sponsorship never hides the charges it covers. Display-only; approval binds
 * the structured plan. `poolFeeFri` is the pool's current charge.
 */
export const summarizeSponsoredShield = (
  plan: Strk20SponsoredShieldPlan,
  poolFeeFri: string,
): string => {
  const network =
    plan.estimatedNetworkFeeFri === undefined
      ? "network fee"
      : `network fee (about ${formatStrk20PoolFee(plan.estimatedNetworkFeeFri)})`;
  const calls = plan.authorization.publicCallCount;
  return `${plan.sponsor} pays the pool fee ${formatStrk20PoolFee(poolFeeFri)} and the ${network}. Its payment is public and names this account · outside execution by its relay for ${calls} public approval call${calls === 1 ? "" : "s"}`;
};
