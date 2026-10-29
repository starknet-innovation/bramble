/**
 * Sponsored account deployment over SNIP-29 (`fee_mode: sponsored`): the
 * Starknet Foundation pays the network fee for a new user's first deploy
 * (#431, #706, option A of the paymaster epic #752).
 *
 * A SNIP-29 `deploy` transaction carries nothing the user signs. The relay deploys
 * the account class through the Universal Deployer with deployer address zero,
 * which puts the contract at the same counterfactual address a DEPLOY_ACCOUNT
 * would. So the wallet's guarantee is a commitment rather than consent: it sends
 * deployment data that provably reproduces the stored address, refuses a quote
 * whose echo differs from that data in any field, and broadcasts its own frozen
 * copy, never the relay's. A relay cannot move the account, change its owner
 * key, or charge the user: nothing the user owns is signed or spent.
 *
 * The relay URL is wallet-configured and on for mainnet and Sepolia; the
 * gateway decides whether it sponsors anything. Everything the relay answers
 * is untrusted; transport and lost-reply classification live in
 * `./sponsored-deploy-rpc`.
 */

import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { AccountDeployment } from "@bramble/starknet/deployment";
import {
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
} from "@bramble/starknet/provider";
import type { PaymasterHttp } from "@bramble/transactions/paymaster-http";
import { XVERSE_ARGENT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  OPENZEPPELIN_ACCOUNT_CLASS_HASH,
} from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { hash } from "starknet";
import { BROADCAST_PAYMASTER_METHOD } from "./paymaster-rpc";
import { postSponsoredRelay } from "./sponsored-deploy-rpc";

/** The injected relay transport, re-exported for background callers and tests. */
export type { PaymasterHttp } from "@bramble/transactions/paymaster-http";

/** Who pays a sponsored deployment's network fee, as the review names them. */
export const SPONSORED_DEPLOY_SPONSOR = "Starknet Foundation";

/** The sponsor declined, or its relay could not quote. Nothing was sent. */
export const SPONSORED_DEPLOY_REFUSED =
  "The Starknet Foundation couldn't cover this deployment. Nothing was sent — add STRK to deploy it yourself.";

/** The account's class is not one a sponsored deploy can create. */
export const SPONSORED_DEPLOY_UNSUPPORTED =
  "This account type can't be deployed with a sponsored fee. Add STRK to deploy it yourself.";

/** The relay could not be reached or answered unusably. Nothing was sent. */
export const SPONSORED_DEPLOY_UNREACHABLE =
  "Couldn't reach the sponsor. Nothing was sent — try again.";

/**
 * The relay explicitly refused: its own clean JSON-RPC error, or a 4xx on a
 * quote. Nothing was sent.
 */
export class SponsoredDeployRefusedError extends WalletError {
  constructor() {
    super(SPONSORED_DEPLOY_REFUSED);
    this.name = "SponsoredDeployRefusedError";
  }
}

/**
 * A quote that failed without an explicit refusal: transport failure, deadline,
 * 5xx, or an unusable answer. Nothing was sent; the sponsor never said no.
 */
export class SponsoredDeployUnavailableError extends WalletError {
  constructor() {
    super(SPONSORED_DEPLOY_UNREACHABLE);
    this.name = "SponsoredDeployUnavailableError";
  }
}

/**
 * What the deploy screen may offer: sponsored ("available"), nothing ("none"),
 * or the state of an earlier attempt: "held" while its hold stands, "may-land"
 * once it is over and the account is not confirmed deployed. The background
 * answers one of those four; "refused" is the screen's own state after a press
 * the sponsor declined, so the self-paid fee it shows then carries the reason.
 * Advisory display state; the submission re-checks everything it depends on.
 */
export type DeploySponsorship = "available" | "held" | "may-land" | "none" | "refused";

/** One network's sponsored-deploy relay. */
export type SponsoredDeployConfig = { readonly url: string };

/** Per-network relays; a network with no entry has sponsorship off. */
export type SponsoredDeployNetworks = Readonly<
  Partial<Record<StarknetNetworkId, SponsoredDeployConfig>>
>;

/**
 * The wallet-owned gateway's sponsored-deploy routes. The gateway is the on/off
 * switch: while a network is switched off there it answers every call
 * `404 sponsored_deploy_disabled`, which the wallet reads as "nothing offered"
 * and deploys self-paid as if sponsorship did not exist. Its budget and abuse
 * limits live there too. Removing a network here stops the wallet asking.
 */
export const SPONSORED_DEPLOY_NETWORKS: SponsoredDeployNetworks = {
  SN_MAIN: { url: "https://wallet.nodes.starknet.org/api/sponsored-deploy/mainnet" },
  SN_SEPOLIA: { url: "https://wallet.nodes.starknet.org/api/sponsored-deploy/sepolia" },
};

/** The relay for `networkId`, or null when sponsorship is off there. */
export const sponsoredDeployConfig = (
  networkId: StarknetNetworkId,
  networks: SponsoredDeployNetworks = SPONSORED_DEPLOY_NETWORKS,
): SponsoredDeployConfig | null =>
  Object.hasOwn(networks, networkId) ? (networks[networkId] ?? null) : null;

/** How a sponsorable class's constructor calldata is laid out. */
type SponsoredConstructor = "argent-0.4" | "openzeppelin";

/**
 * The exact classes the gateway sponsors, and the constructor calldata each
 * must carry; the single source for whether a deploy is offered. Their
 * constructors only store the owner key, so a deployer-zero UDC deploy creates
 * them correctly. OpenZeppelin AccountUpgradeable 3.0 takes `[public_key]`;
 * Argent 0.4.0 and its Xverse build take `[0x0, public_key, 0x1]` (a Starknet
 * signer, no guardian). Any other class, Braavos and Argent multisig included,
 * deploys self-paid and is never offered sponsorship.
 */
const SPONSORED_DEPLOY_CLASSES: readonly {
  readonly classHash: string;
  readonly constructor: SponsoredConstructor;
}[] = [
  { classHash: OPENZEPPELIN_ACCOUNT_CLASS_HASH, constructor: "openzeppelin" },
  { classHash: ARGENT_ACCOUNT_CLASS_HASH, constructor: "argent-0.4" },
  { classHash: XVERSE_ARGENT_CLASS_HASH, constructor: "argent-0.4" },
];

const hasSponsoredCalldata = (
  shape: SponsoredConstructor,
  calldata: readonly string[],
): boolean => {
  if (shape === "openzeppelin") {
    return calldata.length === 1 && isNonZeroStarkFieldElement(calldata[0] ?? "");
  }
  return (
    calldata.length === 3 &&
    sameFelt(calldata[0] ?? "", "0x0") &&
    isNonZeroStarkFieldElement(calldata[1] ?? "") &&
    sameFelt(calldata[2] ?? "", "0x1")
  );
};

/** Whether the account's class is one the gateway sponsors. */
export const isSponsorableAccountClass = (classHash: string): boolean =>
  SPONSORED_DEPLOY_CLASSES.some((entry) => sameFelt(entry.classHash, classHash));

/**
 * Whether the gateway sponsors this exact deployment: an accepted class with
 * that class's constructor calldata. Anything else is deployed self-paid.
 */
export const isSponsorableDeployment = (data: SponsoredDeploymentData): boolean =>
  SPONSORED_DEPLOY_CLASSES.some(
    (entry) =>
      sameFelt(entry.classHash, data.class_hash) &&
      hasSponsoredCalldata(entry.constructor, data.calldata),
  );

/** SNIP-29 deployment data, every felt canonical 0x-hex. */
export type SponsoredDeploymentData = {
  readonly address: string;
  readonly calldata: readonly string[];
  readonly class_hash: string;
  readonly salt: string;
  readonly version: 1;
};

const felt = (value: string, allowZero: boolean): string => {
  const canonical = canonicalFelt(value);
  if (
    canonical === null ||
    (allowZero ? !isStarkFieldElement(canonical) : !isNonZeroStarkFieldElement(canonical))
  ) {
    throw new WalletError("Account deployment parameters are invalid");
  }
  return canonical;
};

/**
 * The deployment data the relay is asked to deploy. Throws unless the class,
 * salt and constructor calldata reproduce the account address with deployer
 * zero, the only address a sponsored deploy may create.
 */
export const sponsoredDeploymentData = (deployment: AccountDeployment): SponsoredDeploymentData => {
  const data: SponsoredDeploymentData = {
    address: felt(deployment.contractAddress, false),
    calldata: deployment.constructorCalldata.map((value) => felt(String(value), true)),
    class_hash: felt(deployment.classHash, false),
    salt: felt(deployment.addressSalt, true),
    version: 1,
  };
  const computed = hash.calculateContractAddressFromHash(
    data.salt,
    data.class_hash,
    [...data.calldata],
    0,
  );
  if (!sameFelt(computed, data.address)) {
    throw new WalletError("Account deployment parameters do not match the stored address");
  }
  return data;
};

const PARAMETERS = { fee_mode: { mode: "sponsored" }, version: "0x1" } as const;
const FEE_KEYS = [
  "estimated_fee_in_gas_token",
  "estimated_fee_in_strk",
  "gas_token_price_in_strk",
  "suggested_max_fee_in_gas_token",
  "suggested_max_fee_in_strk",
] as const;

// The echoed deployment must be the requested one field for field. Felts are
// compared numerically, so padding cannot hide a change; length is exact, so an
// appended constructor argument cannot ride along.
const isSameDeployment = (value: unknown, expected: SponsoredDeploymentData): boolean => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["address", "calldata", "class_hash", "salt", "sigdata", "version"]) ||
    !(value["version"] === 1 || value["version"] === "0x1") ||
    (value["sigdata"] !== undefined &&
      !(Array.isArray(value["sigdata"]) && value["sigdata"].length === 0))
  ) {
    return false;
  }
  const calldata = value["calldata"];
  const same = (field: unknown, wanted: string): boolean =>
    typeof field === "string" && isStarkFieldElement(field) && sameFelt(field, wanted);
  return (
    same(value["address"], expected.address) &&
    same(value["class_hash"], expected.class_hash) &&
    same(value["salt"], expected.salt) &&
    Array.isArray(calldata) &&
    calldata.length === expected.calldata.length &&
    calldata.every((entry, index) => same(entry, expected.calldata[index] ?? ""))
  );
};

// The echoed parameters must still say sponsored: a quote that switched the fee
// mode would charge someone, and the user was told nobody charges them.
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

// The relay's own gas estimate is informational: the user pays none of it, so
// it is never shown as theirs. It is still shape-checked so a malformed quote
// fails closed rather than being half-read.
const isInformationalFee = (value: unknown): boolean =>
  value === undefined ||
  (isRecord(value) &&
    hasOnlyKnownKeys(value, FEE_KEYS) &&
    Object.values(value).every((entry) => typeof entry === "string" && isStarkFieldElement(entry)));

/** A sponsor's acceptance of one exact deployment; nothing is in flight. */
export type SponsoredDeployQuote = { readonly deployment: SponsoredDeploymentData };

/**
 * Asks the relay to sponsor `deployment`. Resolves with the wallet's own frozen
 * copy only when the relay echoes it exactly under sponsored parameters. Every
 * failure is determinate, since a quote never broadcasts: a
 * {@link SponsoredDeployRefusedError} only for the relay's own clean JSON-RPC
 * error or a 4xx, otherwise a {@link SponsoredDeployUnavailableError}.
 */
export const quoteSponsoredDeploy = async (input: {
  readonly config: SponsoredDeployConfig;
  readonly deployment: SponsoredDeploymentData;
  readonly http?: PaymasterHttp;
}): Promise<SponsoredDeployQuote> => {
  const answer = await postSponsoredRelay(
    input.http ?? fetch,
    input.config.url,
    "paymaster_buildTransaction",
    { parameters: PARAMETERS, transaction: { deployment: input.deployment, type: "deploy" } },
    false,
  );
  if (answer.kind === "refused") throw new SponsoredDeployRefusedError();
  if (answer.kind === "lost") throw new SponsoredDeployUnavailableError();
  const result = answer.result;
  if (
    !isRecord(result) ||
    !hasOnlyKnownKeys(result, ["deployment", "fee", "parameters", "type"]) ||
    result["type"] !== "deploy" ||
    !isSameDeployment(result["deployment"], input.deployment) ||
    !isSponsoredParameters(result["parameters"]) ||
    !isInformationalFee(result["fee"])
  ) {
    throw new SponsoredDeployUnavailableError();
  }
  return { deployment: input.deployment };
};

/**
 * Broadcasts a quoted sponsored deployment. Only two failures are determinate:
 * a request refused before it left (`isAuthorized` false: "wallet locked") and
 * a clean JSON-RPC refusal (see `./sponsored-deploy-rpc`), a
 * {@link SponsoredDeployRefusedError}. Every other answer, including a result
 * without a usable hash, is an {@link IndeterminateRpcWriteError}: the relay
 * may already have deployed, so the caller must hold its state and never retry
 * blind. A returned hash is the relay's claim, not proof of this deployment.
 */
export const submitSponsoredDeploy = async (input: {
  readonly config: SponsoredDeployConfig;
  readonly http?: PaymasterHttp;
  readonly isAuthorized: () => boolean;
  readonly quote: SponsoredDeployQuote;
}): Promise<{ readonly transactionHash: string }> => {
  if (!input.isAuthorized()) {
    throw new WalletError("wallet locked");
  }
  const answer = await postSponsoredRelay(
    input.http ?? fetch,
    input.config.url,
    BROADCAST_PAYMASTER_METHOD,
    { parameters: PARAMETERS, transaction: { deployment: input.quote.deployment, type: "deploy" } },
    true,
  );
  if (answer.kind === "refused") throw new SponsoredDeployRefusedError();
  const result = answer.kind === "result" ? answer.result : undefined;
  // Anything but a stated refusal may have deployed. A result without a usable
  // hash leaves the wallet no handle on it either: status unknown.
  if (
    !isRecord(result) ||
    typeof result["transaction_hash"] !== "string" ||
    !isNonZeroStarkFieldElement(result["transaction_hash"])
  ) {
    throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
  }
  return { transactionHash: result["transaction_hash"] };
};
