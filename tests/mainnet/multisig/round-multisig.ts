/**
 * Brings the round's 2-of-2 Argent multisig into existence: predicts its
 * address, funds that address from the funding account, deploys it from owner
 * A's wallet, and has owner B add it from the chain. The address is handed to
 * the caller before any STRK is sent to it, so a round that dies after funding
 * can still be found.
 */
import { predictArgentMultisigAddress } from "@bramble/multisig/deploy";
import { canonicalFelt, sameFelt } from "@bramble/wallet-model/networks";
import type { LocalMainnetAccount } from "../local-mainnet-account";
import { waitForSuccessfulReceipt } from "../local-mainnet-chain";
import type { RoundContext } from "./round-actions";
import { feeRefusal, ROUND_LIMITS } from "./round-budget";
import { fundFromAccount, isDeployed, publicStrk } from "./round-chain";
import type { FeeReview } from "./round-cosign";
import { callWallet, type OwnerWallet } from "./round-wallets";

const DEPLOY_TIMEOUT_MS = 4 * 60_000;
const DEPLOY_INTERVAL_MS = 4_000;
const AUTHORITY_TIMEOUT_MS = 3 * 60_000;
const REVIEW_RETRIES = 4;

type DeploymentReview = {
  readonly address: string;
  readonly fee: FeeReview;
  readonly feeAffordability: "insufficient" | "ok" | "unknown";
};

type MultisigList = {
  readonly multisigs: readonly {
    readonly authorityStatus?: string;
    readonly config: unknown;
    readonly record: {
      readonly address: string;
      readonly currentConfig?: unknown;
      readonly deployment?: unknown;
      readonly id: string;
    };
  }[];
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The address of the round's multisig: both owners' keys, threshold 2, and
 * `salt`. Computed by the wallet's own predictor; no network is read.
 */
export const roundMultisigAddress = (a: OwnerWallet, b: OwnerWallet, salt: string): string => {
  const address = canonicalFelt(
    predictArgentMultisigAddress({
      salt,
      signerPublicKeys: [a.publicKeyX, b.publicKeyX],
      threshold: 2,
    }),
  );
  if (address === null) {
    throw new Error("The multisig address could not be predicted.");
  }
  return address;
};

const listed = async (wallet: OwnerWallet, address: string): Promise<string | null> => {
  const list = await callWallet<MultisigList>(wallet.page, {
    cached: true,
    type: "wallet.multisigs",
  });
  return list.multisigs.find((entry) => sameFelt(entry.record.address, address))?.record.id ?? null;
};

// Adds the deployed multisig from the chain unless the wallet already lists it.
const ensureListed = async (wallet: OwnerWallet, address: string): Promise<string> => {
  const known = await listed(wallet, address);
  if (known !== null) {
    return known;
  }
  const added = await callWallet<{
    readonly multisig: { readonly record: { readonly id: string } };
  }>(wallet.page, { address, networkId: "SN_MAIN", type: "wallet.addMultisig" });
  return added.multisig.record.id;
};

/**
 * Waits until `wallet` holds the multisig's signer keys and reads its signer
 * set from the chain. An address-only add whose chain read failed (a lagging
 * or throttled RPC right after the deploy) stores the multisig without keys,
 * and every private action then refuses. The wallet's fresh read, the one its
 * multisig screen makes, fills them in; this polls that read.
 */
const awaitSignerAuthority = async (wallet: OwnerWallet, address: string): Promise<void> => {
  const deadline = Date.now() + AUTHORITY_TIMEOUT_MS;
  let last = "not listed";
  while (Date.now() < deadline) {
    const list = await callWallet<MultisigList>(wallet.page, { type: "wallet.multisigs" });
    const view = list.multisigs.find((entry) => sameFelt(entry.record.address, address));
    const keys = view?.record.currentConfig ?? view?.record.deployment;
    if (view && keys !== undefined && view.config !== null) {
      return;
    }
    last = view?.authorityStatus ?? "not listed";
    await pause(DEPLOY_INTERVAL_MS);
  }
  throw new Error(
    `Owner ${wallet.role.toUpperCase()} never read the multisig's signers from the chain (last: ${last}).`,
  );
};

const deployFromOwnerA = async (
  a: OwnerWallet,
  b: OwnerWallet,
  salt: string,
  address: string,
  rpcUrl: string,
): Promise<void> => {
  const reviewOnce = async (): Promise<DeploymentReview> =>
    (
      await callWallet<{ readonly deploymentReview: DeploymentReview }>(a.page, {
        expectedAddress: address,
        name: "Privacy round",
        networkId: "SN_MAIN",
        salt,
        signerAccountId: a.accountId,
        signerPublicKeys: [a.publicKeyX, b.publicKeyX],
        threshold: 2,
        type: "wallet.reviewArgentMultisigDeployment",
      })
    ).deploymentReview;
  // Funding was just confirmed on one node; the wallet's balance read can land
  // on a node that has not seen it yet. A review only reads, so ask again.
  let review = await reviewOnce();
  for (
    let retry = 1;
    retry <= REVIEW_RETRIES && review.feeAffordability === "insufficient";
    retry += 1
  ) {
    await pause(DEPLOY_INTERVAL_MS * retry);
    review = await reviewOnce();
  }
  if (!sameFelt(review.address, address)) {
    throw new Error("The wallet reviewed a different multisig address. Nothing was deployed.");
  }
  if (review.feeAffordability === "insufficient") {
    throw new Error("The multisig address cannot pay for its own deployment.");
  }
  const refusal = feeRefusal(review.fee, ROUND_LIMITS.maxDeployFee, "deployment");
  if (refusal) throw new Error(refusal);
  const sent = await callWallet<{ readonly transactionHash?: string }>(a.page, {
    review,
    type: "wallet.deployArgentMultisig",
  });
  if (sent.transactionHash) {
    await waitForSuccessfulReceipt(rpcUrl, sent.transactionHash);
  }
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
  while (!(await isDeployed(rpcUrl, address))) {
    if (Date.now() > deadline) {
      throw new Error("The multisig deployment was sent but the contract is not on chain yet.");
    }
    await pause(DEPLOY_INTERVAL_MS);
  }
};

/**
 * Makes sure the multisig at `address` holds `funding` FRI, is deployed, is
 * listed in both wallets, and that both hold its signer keys. What the address
 * lacks comes from the funding account, whether or not an earlier run already
 * deployed it; an undeployed address is then deployed by owner A. Throws before
 * deploying when the wallet's review disagrees on the address or quotes a fee
 * above the ceiling.
 */
export const establishMultisig = async (input: {
  readonly a: OwnerWallet;
  readonly account: LocalMainnetAccount;
  readonly address: string;
  readonly b: OwnerWallet;
  readonly funding: bigint;
  readonly salt: string;
}): Promise<RoundContext> => {
  const { a, account, address, b } = input;
  const held = await publicStrk(account.rpcUrl, address);
  if (held < input.funding) {
    await fundFromAccount(account, address, input.funding - held);
  }
  if (!(await isDeployed(account.rpcUrl, address))) {
    await deployFromOwnerA(a, b, input.salt, address, account.rpcUrl);
  }
  const multisigId = await ensureListed(a, address);
  const listedInB = await ensureListed(b, address);
  if (listedInB !== multisigId) {
    throw new Error("The two wallets name the multisig differently.");
  }
  await awaitSignerAuthority(a, address);
  await awaitSignerAuthority(b, address);
  return { a, b, multisigAddress: address, multisigId, rpcUrl: account.rpcUrl };
};
