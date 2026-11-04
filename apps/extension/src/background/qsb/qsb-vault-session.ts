/**
 * What the QSB vault flows run on, and how they sign in to the coordinator.
 *
 * {@link QsbVaultDeps} is the composition the background root wires once:
 * the coordinator client over the fetch boundary, the in-memory session
 * tokens (dropped on lock), the QSB runtime that builds a vault script from
 * commitments, the clock and the vault-id randomness boundary.
 *
 * A coordinator session belongs to one account and its owner address. Its
 * token is reused while the cache holds it; a missing one is obtained by
 * signing in, and a token the coordinator calls missing or expired is
 * forgotten and replaced once. Signing in signs nothing but the exact
 * session-only challenge for this origin and address, still in its five
 * minutes on the injected clock (`@bramble/qsb/challenge`); any other
 * challenge, and any refusal of the proof, is `signInRefused`.
 */

import { qsbChallengeRefusal } from "@bramble/qsb/challenge";
import type { QsbCoordinator } from "@bramble/qsb/client";
import { QsbCoordinatorFailure } from "@bramble/qsb/client";
import type { QsbSessions } from "@bramble/qsb/sessions";
import { isOwnerKey, ownerP2wpkhScript } from "@bramble/qsb/transactions";
import type { QsbOwner, QsbVaultAccess } from "@bramble/vault/service-types";
import { isSessionExpired, qsbRefusal } from "./qsb-vault-refusals";
import type { QsbHorsCommitments, QsbVaultSetup } from "./qsb-vault-setup";

/** The collaborators every QSB vault flow is given. */
export type QsbVaultDeps = {
  readonly coordinator: QsbCoordinator;
  /** A fresh random uuid for a vault's coordinator id. */
  readonly drawVaultId: () => string;
  /** Epoch milliseconds. */
  readonly now: () => number;
  readonly runtime: {
    readonly setupFromCommitments: (commitments: QsbHorsCommitments) => Promise<QsbVaultSetup>;
  };
  readonly sessions: QsbSessions;
};

/** Who signs in: the owner address and the one key operation sign-in needs. */
export type QsbSigner = {
  readonly address: string;
  readonly signSignIn: (message: string) => Promise<string>;
};

/** A coordinator session for one account: runs authenticated calls. */
export type QsbCoordinatorSession = {
  readonly call: <T>(run: (token: string) => Promise<T>) => Promise<T>;
};

/**
 * The account's owner, checked: a mainnet P2WPKH address that is the
 * public key's own. Anything else from Krusty fails closed.
 */
export const qsbOwnerOf = async (access: Pick<QsbVaultAccess, "owner">): Promise<QsbOwner> => {
  const owner = await access.owner();
  if (ownerP2wpkhScript(owner.address) === null || !isOwnerKey(owner.address, owner.publicKey)) {
    throw qsbRefusal("runtimeUnavailable");
  }
  return owner;
};

// A sign-in refusal (the challenge, a 4xx) versus no usable answer.
const signInFailure = (error: unknown): never => {
  throw error instanceof QsbCoordinatorFailure &&
    error.kind === "refused" &&
    error.status !== null &&
    error.status < 500
    ? qsbRefusal("signInRefused")
    : qsbRefusal("coordinatorUnavailable");
};

const signIn = async (
  deps: QsbVaultDeps,
  accountId: string,
  signer: QsbSigner,
): Promise<string> => {
  const startedAt = deps.now();
  const challenge = await deps.coordinator.challenge(signer.address).catch(signInFailure);
  if (qsbChallengeRefusal(challenge.message, signer.address, deps.now()) !== null) {
    throw qsbRefusal("signInRefused");
  }
  const proof = await signer.signSignIn(challenge.message);
  const token = await deps.coordinator.verify(challenge.id, proof).catch(signInFailure);
  deps.sessions.remember(accountId, signer.address, token, startedAt);
  return token;
};

/** The session of the account `access` is over, signing in with its owner key. */
export const qsbAccessSession = (
  deps: QsbVaultDeps,
  access: Pick<QsbVaultAccess, "accountId" | "signSignIn">,
  owner: QsbOwner,
): QsbCoordinatorSession =>
  qsbCoordinatorSession(deps, access.accountId, {
    address: owner.address,
    signSignIn: (message) => access.signSignIn(message),
  });

/** Opens the account's coordinator session; nothing is sent until a call runs. */
export const qsbCoordinatorSession = (
  deps: QsbVaultDeps,
  accountId: string,
  signer: QsbSigner,
): QsbCoordinatorSession => ({
  async call(run) {
    const held = deps.sessions.token(accountId, signer.address);
    const token = held ?? (await signIn(deps, accountId, signer));
    try {
      return await run(token);
    } catch (error) {
      if (!isSessionExpired(error)) throw error;
      deps.sessions.forget(accountId);
      return run(await signIn(deps, accountId, signer));
    }
  },
});
