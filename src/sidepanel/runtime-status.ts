/**
 * The two synthetic wallet statuses the side panel paints when it does not have
 * a real one: the pre-load placeholder and the fail-closed status used when the
 * background does not answer.
 *
 * They are separated because the screens they select are opposites. `hasVault`
 * is what the panel branches on to choose between the first-run journey and the
 * unlock gate, so a status invented for "we do not know yet" must never be the
 * same value as one invented for "we asked and could not find out".
 */

import type { WalletStatus } from "../popup/responses";

const MAINNET_SHELL = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: false,
} as const;

/**
 * A locked, account-less status used before the first load resolves.
 */
export const emptyStatus = (): WalletStatus => ({
  ...MAINNET_SHELL,
  hasVault: false,
  locked: true,
  network: "Unavailable",
});

/**
 * The status used when a `wallet.status` read fails or answers with something
 * that is not a status: the background is unreachable, so what the vault holds
 * is unknown.
 *
 * It reports `hasVault: true, locked: true, ready: false` deliberately. An
 * unanswered read is not evidence that there is no wallet, and rendering it as
 * one puts a user who already has a vault in front of the first-run screen,
 * inviting them to create a wallet over the top of the one they cannot
 * currently see. Claiming a locked vault instead fails closed: the panel offers
 * the unlock gate, `ready: false` disables its submit, and `network` reads
 * "Unavailable" — an explicit fault state that destroys nothing and resolves
 * itself the moment a real status arrives.
 */
export const unavailableStatus = (): WalletStatus => ({
  ...MAINNET_SHELL,
  hasVault: true,
  locked: true,
  network: "Unavailable",
});
