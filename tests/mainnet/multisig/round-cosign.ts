/**
 * Co-signing between the round's two wallets. Owner A proposes and submits;
 * owner B reviews and signs what reaches it over Nostr. Nothing is copied
 * between the wallets by this module: a signature or a viewing key gets from
 * one to the other only through the wallet's own share and sync messages.
 */
import { callWallet, type OwnerWallet, tryWallet } from "./round-wallets";

const SYNC_TIMEOUT_MS = 3 * 60_000;
const SYNC_INTERVAL_MS = 4_000;

/** Fee the wallet quotes for a prepared multisig transaction. */
export type FeeReview = { readonly overallFee: string; readonly unit: string };

// A frozen multisig transaction as the wallet lists it.
type IntentView = {
  readonly id: string;
  readonly signatures: readonly unknown[];
  readonly state: string;
};

/** One card of the multisig private-balance panel. */
export type PanelCard = { readonly id: string; readonly offer: "send" | "share" | "sign" };

/** The private-balance panel: CallSet cards, relay cards and private balances. */
export type PanelView = {
  readonly authorizations: readonly PanelCard[];
  readonly balances: readonly { readonly balance: string; readonly token: string }[];
  readonly relays: readonly PanelCard[];
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pulls co-owner updates into `wallet` until `probe` answers. A relay that is
 * briefly unavailable is retried. Throws `waitingFor` when nothing arrived in
 * time, which is how a lost Nostr delivery surfaces.
 */
export const syncUntil = async <T>(
  wallet: OwnerWallet,
  multisigId: string,
  waitingFor: string,
  probe: () => Promise<T | null>,
): Promise<T> => {
  const deadline = Date.now() + SYNC_TIMEOUT_MS;
  let lastRefusal = "";
  while (Date.now() < deadline) {
    const synced = await tryWallet(wallet.page, {
      multisigId,
      type: "wallet.syncArgentMultisigIntents",
    });
    lastRefusal = "error" in synced ? synced.error : "";
    const found = await probe();
    if (found !== null) {
      return found;
    }
    await pause(SYNC_INTERVAL_MS);
  }
  throw new Error(
    `Owner ${wallet.role.toUpperCase()} never received ${waitingFor}.${lastRefusal ? ` Last sync refusal: ${lastRefusal}` : ""}`,
  );
};

/** Reads the private-balance panel of `multisigId` in `wallet`. */
export const readPanel = (wallet: OwnerWallet, multisigId: string): Promise<PanelView> =>
  callWallet<PanelView>(wallet.page, { multisigId, type: "wallet.argentMultisigStrk20Panel" });

const storedIntent = async (wallet: OwnerWallet, intentId: string): Promise<IntentView | null> => {
  const listed = await callWallet<{ readonly intents: readonly IntentView[] }>(wallet.page, {
    cached: true,
    type: "wallet.multisigs",
  });
  return listed.intents.find((intent) => intent.id === intentId) ?? null;
};

const share = async (wallet: OwnerWallet, message: Record<string, unknown> & { type: string }) => {
  const shared = await callWallet<{ readonly recipients?: number }>(wallet.page, message);
  if (!shared.recipients || shared.recipients < 1) {
    throw new Error(
      `${message.type}: owner ${wallet.role.toUpperCase()} reached no co-signer on any Nostr relay`,
    );
  }
};

/**
 * Collects both owners' signatures on a frozen transaction: A signs and shares
 * it, B receives it, signs and shares it back, and A waits for the second
 * signature. Returns once A holds the threshold. Submitting is the caller's.
 */
export const cosignIntent = async (
  a: OwnerWallet,
  b: OwnerWallet,
  multisigId: string,
  intentId: string,
): Promise<void> => {
  await callWallet(a.page, {
    intentId,
    signerAccountId: a.accountId,
    type: "wallet.signArgentMultisigIntent",
  });
  await share(a, { intentId, type: "wallet.shareArgentMultisigIntent" });
  await syncUntil(b, multisigId, "the transaction to sign", () => storedIntent(b, intentId));
  await callWallet(b.page, {
    intentId,
    signerAccountId: b.accountId,
    type: "wallet.signArgentMultisigIntent",
  });
  await share(b, { intentId, type: "wallet.shareArgentMultisigIntent" });
  await syncUntil(a, multisigId, "the co-owner's signature", async () => {
    const intent = await storedIntent(a, intentId);
    return intent?.state === "ready" ? intent : null;
  });
};

/**
 * Submits a transaction A holds the threshold for and returns its hash. The
 * wallet attaches the proof it kept for a registration or a deposit.
 */
export const submitIntent = async (a: OwnerWallet, intentId: string): Promise<string> => {
  const sent = await callWallet<{ readonly transactionHash: string }>(a.page, {
    intentId,
    type: "wallet.submitArgentMultisigIntent",
  });
  return sent.transactionHash;
};

/** The card with `id` in one list of the panel, or null when it is not shown. */
export const cardIn = (cards: readonly PanelCard[], id: string): PanelCard | null =>
  cards.find((card) => card.id === id) ?? null;

/**
 * Has B sign one private-balance card A shared: a pool CallSet or a relay
 * request. B signs only what its own panel decoded and offers for signing, so
 * a package B's wallet refuses fails here instead of being signed.
 */
export const cosignPrivateCard = async (
  a: OwnerWallet,
  b: OwnerWallet,
  multisigId: string,
  id: string,
  list: "authorizations" | "relays",
): Promise<void> => {
  const shareMessage = { id, type: "wallet.shareArgentMultisigStrk20Authorization" };
  await share(a, shareMessage);
  await syncUntil(b, multisigId, "the private action to sign", async () => {
    const card = cardIn((await readPanel(b, multisigId))[list], id);
    return card?.offer === "sign" ? card : null;
  });
  await callWallet(b.page, { id, type: "wallet.signArgentMultisigStrk20Authorization" });
  await share(b, shareMessage);
};

/**
 * Gives B the multisig's viewing key: A creates it when it has none, shares
 * it, and B syncs until its own vault holds it. Throws if B ends up with a
 * different key than A's, which the wallet reports as a conflict.
 */
export const shareViewingKey = async (
  a: OwnerWallet,
  b: OwnerWallet,
  multisigId: string,
): Promise<void> => {
  const keyState = (wallet: OwnerWallet): Promise<{ readonly state: string }> =>
    callWallet(wallet.page, { multisigId, type: "wallet.argentMultisigStrk20KeyStatus" });
  if ((await keyState(a)).state === "absent") {
    await callWallet(a.page, { multisigId, type: "wallet.createArgentMultisigStrk20Key" });
  }
  await share(a, { multisigId, type: "wallet.shareArgentMultisigStrk20Key" });
  await syncUntil(b, multisigId, "the viewing key", async () => {
    const { state } = await keyState(b);
    if (state === "conflict") {
      throw new Error("Owner B holds a different viewing key for this multisig.");
    }
    return state === "held" ? state : null;
  });
};
