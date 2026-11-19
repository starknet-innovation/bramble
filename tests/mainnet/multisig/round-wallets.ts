/**
 * The two wallets of a multisig privacy round. Each is the built extension on
 * its own kept profile, onboarded from its owner phrase and pointed at the
 * dedicated RPC. Everything after onboarding goes through the background's
 * own runtime messages, the same boundary the wallet's pages use, so a step
 * fails with the background's refusal rather than with a missing selector.
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "@bramble/core/json";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { Page } from "@playwright/test";
import { type LoadedExtension, launchExtension } from "../../e2e/extension-fixture";
import { importWalletFromPhrase, sendRuntimeMessage, unlockWallet } from "../../e2e/wallet-helpers";
import type { OwnerRole } from "./round-owners";
import { ownerProfile } from "./round-state";

const UNLOCK_TIMEOUT_MS = 30_000;
const LOCKED = "wallet locked";

/** One co-owner's wallet and the public identity the other owner saves. */
export type OwnerWallet = {
  /** Vault account id of the owner key, as `wallet.status` reports it. */
  readonly accountId: string;
  readonly address: string;
  readonly extension: LoadedExtension;
  readonly nostrPublicKey: string;
  readonly page: Page;
  readonly publicKeyX: string;
  readonly role: OwnerRole;
};

type StatusReply = {
  readonly accounts?: readonly {
    readonly address: string;
    readonly id: string;
    readonly networkId?: string;
    readonly publicKeyX?: string;
  }[];
  readonly activeAccountId?: string | null;
  readonly hasVault?: boolean;
  readonly locked?: boolean;
  readonly networkId?: string;
};

/** A background message: its type and whatever fields that type takes. */
export type WalletMessage = Readonly<Record<string, unknown>> & { readonly type: string };

const LAGGING_NODE_RETRIES = 4;
const LAGGING_NODE_PAUSE_MS = 3_000;
// Messages that broadcast. They are never repeated by this helper, though the
// wallet guards each against sending twice.
const BROADCASTS: ReadonlySet<string> = new Set([
  "wallet.deployArgentMultisig",
  "wallet.submitArgentMultisigIntent",
  "wallet.submitArgentMultisigStrk20Relay",
]);

/**
 * True when `reply` is a JSON-RPC 24, "Block not found", for a message that
 * does not broadcast. The shared RPC load-balances across nodes that can be a
 * block apart; the wallet re-pins three times, and a round makes enough pinned
 * reads that a short lag can still exhaust them. The read failed before the
 * message acted, so asking again is safe.
 */
export const isLaggingNode = (message: WalletMessage, reply: unknown): boolean => {
  const refusal = errorOf(reply);
  return refusal !== null && !BROADCASTS.has(message.type) && /Block not found/.test(refusal);
};

const errorOf = (reply: unknown): string | null =>
  isRecord(reply) && typeof reply["error"] === "string" ? reply["error"] : null;

const unlock = async (page: Page): Promise<void> => {
  await page.reload();
  const gate = page.locator('input[name="vaultPassphrase"]');
  await gate.waitFor({ state: "visible", timeout: UNLOCK_TIMEOUT_MS });
  await unlockWallet(page);
  await page
    .getByRole("button", { name: "Lock wallet" })
    .waitFor({ state: "visible", timeout: UNLOCK_TIMEOUT_MS });
};

/**
 * Sends one background message from `page` and returns the reply. A reply
 * carrying `error` throws that text, prefixed with the message type. A locked
 * wallet is unlocked once and the message repeated: a round outlasts the
 * session. The repeat follows a refusal, so the first attempt did nothing.
 * A refusal from a lagging RPC node is retried too; see {@link isLaggingNode}.
 */
export const callWallet = async <T>(page: Page, message: WalletMessage): Promise<T> => {
  let reply = await sendRuntimeMessage<unknown>(page, message);
  if (errorOf(reply) === LOCKED) {
    await unlock(page);
    reply = await sendRuntimeMessage<unknown>(page, message);
  }
  for (let retry = 1; retry <= LAGGING_NODE_RETRIES && isLaggingNode(message, reply); retry += 1) {
    await new Promise((resolve) => setTimeout(resolve, LAGGING_NODE_PAUSE_MS * retry));
    reply = await sendRuntimeMessage<unknown>(page, message);
  }
  const refusal = errorOf(reply);
  if (refusal !== null) {
    throw new Error(`${message.type}: ${refusal}`);
  }
  if (reply === undefined || reply === null) {
    throw new Error(`${message.type}: the background did not answer`);
  }
  return reply as T;
};

/**
 * Like {@link callWallet}, but returns the refusal text instead of throwing,
 * for a step whose refusals the caller tells apart.
 */
export const tryWallet = async <T>(
  page: Page,
  message: WalletMessage,
): Promise<{ readonly error: string } | { readonly reply: T }> => {
  try {
    return { reply: await callWallet<T>(page, message) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "wallet call failed" };
  }
};

const onboard = async (page: Page, phrase: string): Promise<void> => {
  const status = await sendRuntimeMessage<StatusReply>(page, { type: "wallet.status" });
  if (status?.hasVault !== true) {
    await importWalletFromPhrase(page, phrase);
    return;
  }
  if (status.locked === true) {
    await unlock(page);
  }
};

const ownerAccount = (
  status: StatusReply,
): { readonly address: string; readonly id: string; readonly publicKeyX: string } => {
  if (status.networkId !== "SN_MAIN") {
    throw new Error("The owner wallet is not on Starknet mainnet.");
  }
  const account = status.accounts?.find((entry) => entry.id === status.activeAccountId);
  if (!account || typeof account.publicKeyX !== "string") {
    throw new Error("The owner wallet has no active account with a Stark key.");
  }
  return { address: account.address, id: account.id, publicKeyX: account.publicKeyX };
};

/**
 * Opens one owner's wallet on its kept profile. A fresh profile is onboarded
 * from `phrase`; a kept one is unlocked. The wallet is pointed at `rpcUrl`
 * before any balance is read, and at `nostrRelayUrl` when one is given. The
 * phrase is typed into the wallet's own import field and held nowhere else.
 */
export const openOwnerWallet = async (input: {
  readonly directory: string;
  readonly nostrRelayUrl?: string;
  readonly phrase: string;
  readonly role: OwnerRole;
  readonly rpcUrl: string;
}): Promise<OwnerWallet> => {
  const profile = ownerProfile(input.directory, input.role);
  await mkdir(profile, { mode: 0o700, recursive: true });
  // Chromium keeps running the background script it cached when the profile
  // was made, even after dist/ is rebuilt, so a resumed round would test old
  // wallet code. Dropping the service-worker cache makes it load the current
  // build. The wallet's own data is in extension storage, not here.
  await rm(join(profile, "Default", "Service Worker"), { force: true, recursive: true });
  const extension = await launchExtension({ userDataDir: profile });
  try {
    let page = await extension.openExtensionPage("sidepanel.html");
    await onboard(page, input.phrase);
    // Onboarding can leave this tab on its last screen; start from the panel.
    await page.close().catch(() => undefined);
    page = await extension.openExtensionPage("sidepanel.html");
    await page
      .locator("#account-trigger")
      .waitFor({ state: "visible", timeout: UNLOCK_TIMEOUT_MS });
    await callWallet(page, {
      networkId: "SN_MAIN",
      rpcUrl: input.rpcUrl,
      type: "wallet.setRpcOverride",
    });
    if (input.nostrRelayUrl !== undefined) {
      await callWallet(page, {
        relayUrl: input.nostrRelayUrl,
        type: "wallet.setNostrRelayUrl",
      });
    }
    const account = ownerAccount(await callWallet<StatusReply>(page, { type: "wallet.status" }));
    const nostr = await callWallet<{ readonly nostrPublicKey: string }>(page, {
      type: "wallet.nostrPublicKey",
    });
    return {
      accountId: account.id,
      address: account.address,
      extension,
      nostrPublicKey: nostr.nostrPublicKey,
      page,
      publicKeyX: account.publicKeyX,
      role: input.role,
    };
  } catch (error) {
    await extension.close().catch(() => undefined);
    throw error;
  }
};

/**
 * Saves `other` as a co-signer card in `wallet`, with the Stark key and Nostr
 * key the wallet checks before it accepts a viewing key or a signature from
 * that owner. Saving the same card again replaces it.
 */
export const saveCoOwner = async (wallet: OwnerWallet, other: OwnerWallet): Promise<void> => {
  if (sameFelt(wallet.publicKeyX, other.publicKeyX)) {
    throw new Error("Both owner wallets hold the same key.");
  }
  await callWallet(wallet.page, {
    address: other.address,
    label: `Round owner ${other.role.toUpperCase()}`,
    networkId: "SN_MAIN",
    nostrPublicKey: other.nostrPublicKey,
    publicKeyX: other.publicKeyX,
    type: "wallet.saveAddress",
  });
};

/** Closes both browsers. The profiles stay on disk. */
export const closeOwnerWallets = async (wallets: readonly OwnerWallet[]): Promise<void> => {
  await Promise.all(wallets.map((wallet) => wallet.extension.close().catch(() => undefined)));
};
