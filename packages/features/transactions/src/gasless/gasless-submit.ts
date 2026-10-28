/**
 * Quotes and submits a public transaction whose network fee is paid in a
 * token other than STRK. The wallet flag and the forwarder pin gate every
 * entry. Signing uses the outside-execution hash, then `signHash`. The body
 * posted to `paymaster_executeTransaction` is the paymaster's typed data,
 * unchanged, plus the signature over that hash.
 *
 * Trust boundary: the route URL and the forwarder come from wallet config.
 * The paymaster response is untrusted and is checked by
 * `validateGaslessTypedData` before it is signed. A lost execute reply throws
 * `IndeterminateRpcWriteError`. A stated refusal throws `GaslessRefusal`.
 */

import { WalletError } from "@bramble/core/errors";
import { serializeAccountSignature } from "@bramble/starknet/account-contracts";
import {
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
  type StarkHashSigner,
} from "@bramble/starknet/provider";
import { REVIEWED_FEE_EXCEEDED } from "@bramble/starknet/rpc-submit";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  STRK_TOKEN_ADDRESS,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { type Call, typedData } from "starknet";
import { resolveTokenFeeAffordability } from "../routing/fee-funds";
import type { PaymasterHttp } from "../routing/paymaster-http";
import { accountSignsGaslessV2, type GaslessAccountClass } from "./gasless-account";
import { gaslessFeeCeiling } from "./gasless-ceiling";
import { type GaslessRoute, gaslessRouteReady } from "./gasless-config";
import { GaslessRefusal } from "./gasless-errors";
import {
  type GaslessFeeOffer,
  gaslessBuildParams,
  gaslessDeploymentBody,
  gaslessTokenSpend,
  isGaslessFeeOffer,
  MAX_GASLESS_OFFERS,
  readGaslessAvailable,
  readGaslessQuote,
  readGaslessSupportedTokens,
  readGaslessTransactionHash,
} from "./gasless-request";
import { postGasless } from "./gasless-rpc";
import { gaslessAuthorizationWindow, validateGaslessTypedData } from "./gasless-typed-data";

/**
 * Seconds the execution window must still have when the signature is sent.
 * The same floor the private relay uses before it posts a public invoke.
 */
export const GASLESS_SIGN_WINDOW_SECONDS = 10n;

/**
 * A wallet token the quote may offer: its label and decimals are the
 * wallet's, not the paymaster's. `balance` is raw base units, or null when
 * the balance could not be read.
 */
export type GaslessHeldToken = {
  readonly address: string;
  readonly balance: string | null;
  readonly decimals: number;
  readonly label: string;
};

/**
 * What one independent price source says the STRK estimate is worth in a
 * fee token, in that token's base units, before the 20% margin. Null hides
 * the token.
 */
export type GaslessPriceReference = (token: {
  readonly address: string;
  readonly decimals: number;
}) => Promise<bigint | null>;

const kindFor = (route: GaslessRoute, deployed: boolean): "deploy_and_invoke" | "invoke" | null => {
  if (deployed) {
    return "invoke";
  }
  if (route.chainId === "SN_MAIN") {
    return null;
  }
  return "deploy_and_invoke";
};

const deploymentFor = (
  route: GaslessRoute,
  deployed: boolean,
  userAddress: string,
  deployment: Parameters<typeof gaslessDeploymentBody>[0] | null,
) => {
  if (deployed) {
    return null;
  }
  if (deployment === null || route.chainId !== "SN_SEPOLIA") {
    return undefined;
  }
  const body = gaslessDeploymentBody(deployment, userAddress);
  return body === null ? undefined : body;
};

const heldOffer = async (input: {
  readonly calls: readonly Call[];
  readonly ceiling: bigint;
  readonly chainId: GaslessRoute["chainId"];
  readonly deployment: ReturnType<typeof gaslessDeploymentBody>;
  readonly forwarder: string;
  readonly held: GaslessHeldToken;
  readonly http: PaymasterHttp;
  readonly kind: "deploy_and_invoke" | "invoke";
  readonly nowSeconds: number;
  readonly spent: bigint;
  readonly url: string;
  readonly userAddress: string;
}): Promise<GaslessFeeOffer | null> => {
  const params = gaslessBuildParams({
    calls: input.calls,
    deployment: input.deployment,
    gasToken: input.held.address,
    userAddress: input.userAddress,
  });
  const quote = readGaslessQuote(
    await postGasless(input.http, input.url, "paymaster_buildTransaction", params, {
      executes: false,
    }),
    input.kind,
  );
  if (quote === null) {
    return null;
  }
  const validated = validateGaslessTypedData({
    accountAddress: input.userAddress,
    calls: input.calls,
    ceiling: input.ceiling,
    chainId: input.chainId,
    forwarder: input.forwarder,
    gasToken: input.held.address,
    minimumRemainingSeconds: GASLESS_SIGN_WINDOW_SECONDS,
    nowSeconds: input.nowSeconds,
    quotedMax: quote.quotedMax,
    value: quote.typedData,
  });
  if (!validated.ok) {
    return null;
  }
  const amount = validated.feeAmount.toString();
  if (
    resolveTokenFeeAffordability({
      amount,
      balance: input.held.balance,
      sendAmount: input.spent,
    }) !== "ok"
  ) {
    return null;
  }
  const offer = {
    amount,
    decimals: input.held.decimals,
    label: input.held.label,
    // Registry addresses are padded. The offer grammar is the short felt, so a
    // padded address is not an offer and the token is never shown.
    tokenAddress: canonicalFelt(input.held.address) ?? input.held.address,
  };
  return isGaslessFeeOffer(offer) ? offer : null;
};

const collectOffers = async (input: {
  readonly account: { readonly address: string };
  readonly calls: readonly Call[];
  readonly deployment: ReturnType<typeof gaslessDeploymentBody>;
  readonly http: PaymasterHttp;
  readonly kind: "deploy_and_invoke" | "invoke";
  readonly nowSeconds: number;
  readonly referenceFor: GaslessPriceReference;
  readonly route: GaslessRoute & { readonly forwarder: string };
  readonly tokens: readonly GaslessHeldToken[];
}): Promise<readonly GaslessFeeOffer[]> => {
  const available = await postGasless(input.http, input.route.url, "paymaster_isAvailable", [], {
    executes: false,
  });
  if (!readGaslessAvailable(available)) {
    return [];
  }
  const listed = readGaslessSupportedTokens(
    await postGasless(input.http, input.route.url, "paymaster_getSupportedTokens", [], {
      executes: false,
    }),
  );
  if (listed === null) {
    return [];
  }
  const offers: GaslessFeeOffer[] = [];
  for (const listedToken of listed) {
    if (offers.length >= MAX_GASLESS_OFFERS) {
      break;
    }
    const offer = await offerForListed(input, listedToken);
    if (offer !== null) {
      offers.push(offer);
    }
  }
  return offers;
};

const offerForListed = async (
  input: Parameters<typeof collectOffers>[0],
  listedToken: { readonly address: string; readonly decimals: number },
): Promise<GaslessFeeOffer | null> => {
  const held = input.tokens.find(
    (token) =>
      sameFelt(token.address, listedToken.address) && token.decimals === listedToken.decimals,
  );
  if (held === undefined || sameFelt(held.address, STRK_TOKEN_ADDRESS)) {
    return null;
  }
  const reference = await input.referenceFor(held);
  const spent = gaslessTokenSpend(input.calls, held.address);
  const ceiling = reference === null ? 0n : gaslessFeeCeiling(reference);
  if (ceiling <= 0n || spent === null) {
    return null;
  }
  return heldOffer({
    calls: input.calls,
    ceiling,
    chainId: input.route.chainId,
    deployment: input.deployment,
    forwarder: input.route.forwarder,
    held,
    http: input.http,
    kind: input.kind,
    nowSeconds: input.nowSeconds,
    spent,
    url: input.route.url,
    userAddress: input.account.address,
  });
};

/**
 * Tokens the user may explicitly choose, in paymaster order, at most
 * {@link MAX_GASLESS_OFFERS}. An empty list leaves STRK as the only fee.
 * Any failure of the route hides gasless; it does not fail the STRK review.
 */
export const quoteGaslessOffers = async (input: {
  readonly account: GaslessAccountClass & { readonly address: string };
  readonly calls: readonly Call[];
  readonly deployment: Parameters<typeof gaslessDeploymentBody>[0] | null;
  readonly http: PaymasterHttp;
  readonly nowSeconds: number;
  readonly referenceFor: GaslessPriceReference;
  readonly route: GaslessRoute | null;
  readonly strkShort: boolean;
  readonly tokens: readonly GaslessHeldToken[];
}): Promise<readonly GaslessFeeOffer[]> => {
  if (
    !input.strkShort ||
    !gaslessRouteReady(input.route) ||
    !accountSignsGaslessV2(input.account)
  ) {
    return [];
  }
  const kind = kindFor(input.route, input.account.deployed);
  if (kind === null) {
    return [];
  }
  const deployment = deploymentFor(
    input.route,
    input.account.deployed,
    input.account.address,
    input.deployment,
  );
  if (deployment === undefined) {
    return [];
  }
  try {
    return await collectOffers({ ...input, deployment, kind, route: input.route });
  } catch {
    return [];
  }
};

/**
 * The signed fee a successful gasless submission records. `amount` is the
 * base units that were in the signed transfer, as decimal digits.
 */
export type GaslessSubmission = {
  readonly transactionHash: string;
  readonly userFee: {
    readonly amount: string;
    readonly token: string;
    readonly tokenAddress: string;
  };
};

const signedFelts = (
  accountContractType: string,
  signature: Awaited<ReturnType<StarkHashSigner>>,
): readonly string[] => {
  const serialized = serializeAccountSignature(
    accountContractType as "argent" | "braavos" | "openzeppelin",
    signature,
  );
  return serialized.map((part) => {
    const canonical = canonicalFelt(part);
    if (canonical === null || !isStarkFieldElement(canonical)) {
      throw new GaslessRefusal("unavailable");
    }
    return canonical;
  });
};

const refusalFor = (
  reason: "calls" | "ceiling" | "forwarder" | "shape" | "window",
): GaslessRefusal =>
  new GaslessRefusal(
    reason === "ceiling"
      ? "above_ceiling"
      : reason === "window"
        ? "invalid_screening_transaction"
        : "invalid_gasless_request",
  );

const prepareSubmission = async (
  input: Parameters<typeof submitReviewedGaslessInvoke>[0],
): Promise<{
  readonly deployment: ReturnType<typeof gaslessDeploymentBody>;
  readonly params: ReturnType<typeof gaslessBuildParams>;
  readonly route: GaslessRoute & { readonly forwarder: string };
  readonly validated: Extract<ReturnType<typeof validateGaslessTypedData>, { readonly ok: true }>;
}> => {
  if (!gaslessRouteReady(input.route)) {
    throw new GaslessRefusal("unavailable");
  }
  if (!accountSignsGaslessV2(input.account)) {
    throw new GaslessRefusal("v2_unsupported");
  }
  const kind = kindFor(input.route, input.account.deployed);
  const deployment = deploymentFor(
    input.route,
    input.account.deployed,
    input.account.address,
    input.deployment,
  );
  if (kind === null) {
    throw new GaslessRefusal("screening_subject_unverifiable");
  }
  if (deployment === undefined || !isNonZeroStarkFieldElement(input.reviewed.tokenAddress)) {
    throw new GaslessRefusal("unavailable");
  }
  const reference = await input.referenceFor({
    address: input.reviewed.tokenAddress,
    decimals: input.reviewed.decimals,
  });
  if (reference === null) {
    throw new GaslessRefusal("unverifiable");
  }
  const params = gaslessBuildParams({
    calls: input.calls,
    deployment,
    gasToken: input.reviewed.tokenAddress,
    userAddress: input.account.address,
  });
  const quote = readGaslessQuote(
    await postGasless(input.http, input.route.url, "paymaster_buildTransaction", params, {
      executes: false,
    }),
    kind,
  );
  if (quote === null) {
    throw new GaslessRefusal("invalid_gasless_request");
  }
  const validated = validateGaslessTypedData({
    accountAddress: input.account.address,
    calls: input.calls,
    ceiling: gaslessFeeCeiling(reference),
    chainId: input.route.chainId,
    forwarder: input.route.forwarder,
    gasToken: input.reviewed.tokenAddress,
    minimumRemainingSeconds: GASLESS_SIGN_WINDOW_SECONDS,
    nowSeconds: input.nowSeconds,
    quotedMax: quote.quotedMax,
    value: quote.typedData,
  });
  if (!validated.ok) {
    throw refusalFor(validated.reason);
  }
  if (validated.feeAmount > BigInt(input.reviewed.amount)) {
    throw new WalletError(REVIEWED_FEE_EXCEEDED);
  }
  return { deployment, params, route: input.route, validated };
};

/**
 * Builds, checks, signs, and executes one reviewed gasless choice. Refuses
 * before the execute call when the route is off, the account cannot sign v2,
 * the network is mainnet and the account is not deployed, or the fresh quote
 * exceeds the amount the user reviewed. The typed data posted is the
 * paymaster's body.
 */
export const submitReviewedGaslessInvoke = async (input: {
  readonly account: GaslessAccountClass & {
    readonly accountContractType: "argent" | "braavos" | "openzeppelin";
    readonly address: string;
  };
  readonly calls: readonly Call[];
  readonly deployment: Parameters<typeof gaslessDeploymentBody>[0] | null;
  readonly http: PaymasterHttp;
  readonly isAuthorized: () => boolean;
  readonly nowSeconds: number;
  /**
   * Clock read after signing, for the final execution-window check. The
   * snapshot in `nowSeconds` is already stale once a signer prompt has waited.
   */
  readonly readNowSeconds: () => number;
  readonly referenceFor: GaslessPriceReference;
  readonly reviewed: GaslessFeeOffer;
  readonly route: GaslessRoute | null;
  readonly signHash: StarkHashSigner;
  /**
   * Runs after the window check and before execute. Used to persist the
   * outside-execution nonce. A throw here means execute was not posted.
   */
  readonly beforeExecute?: (signed: {
    readonly messageHash: string;
    readonly typedData: unknown;
    readonly userFee: GaslessSubmission["userFee"];
  }) => Promise<void>;
}): Promise<GaslessSubmission> => {
  const prepared = await prepareSubmission(input);
  const { deployment, params, validated } = prepared;
  if (!input.isAuthorized()) {
    throw new WalletError("wallet locked");
  }
  const messageHash = typedData.getMessageHash(
    validated.typedData as Parameters<typeof typedData.getMessageHash>[0],
    input.account.address,
  );
  const signature = signedFelts(
    input.account.accountContractType,
    await input.signHash(messageHash),
  );
  if (!input.isAuthorized()) {
    throw new WalletError("wallet locked");
  }
  if (
    !gaslessAuthorizationWindow(
      validated.executeAfter,
      validated.executeBefore,
      input.readNowSeconds(),
      GASLESS_SIGN_WINDOW_SECONDS,
    )
  ) {
    throw new GaslessRefusal("invalid_screening_transaction");
  }
  if (!input.isAuthorized()) {
    throw new WalletError("wallet locked");
  }
  const userFee = {
    amount: validated.feeAmount.toString(),
    token: input.reviewed.label,
    tokenAddress: input.reviewed.tokenAddress,
  };
  if (input.beforeExecute) {
    await input.beforeExecute({ messageHash, typedData: validated.typedData, userFee });
  }
  if (!input.isAuthorized()) {
    throw new WalletError("wallet locked");
  }
  const invoke = {
    signature,
    typed_data: validated.typedData,
    user_address: params.userAddress,
  };
  const result = await postGasless(
    input.http,
    prepared.route.url,
    "paymaster_executeTransaction",
    {
      parameters: params.parameters,
      transaction:
        deployment === null
          ? { invoke, type: "invoke" }
          : { deployment, invoke, type: "deploy_and_invoke" },
    },
    { executes: true, isAuthorized: input.isAuthorized },
  );
  const accepted = readGaslessTransactionHash(result);
  const transactionHash = accepted === null ? null : canonicalFelt(accepted);
  if (transactionHash === null || !isNonZeroStarkFieldElement(transactionHash)) {
    throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
  }
  return { transactionHash, userFee };
};
