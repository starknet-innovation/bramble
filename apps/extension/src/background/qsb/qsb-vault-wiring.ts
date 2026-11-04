/**
 * The QSB vault flows' composition, built once by the background root: the
 * coordinator client over the root's fetch boundary, the in-memory session
 * tokens, the per-account QSB locks, the QSB runtime, the clock, and the
 * vault-id randomness boundary.
 *
 * This module is that randomness boundary: a vault's coordinator id is a
 * fresh `crypto.randomUUID()` for every registration attempt and is never
 * kept (vaults are matched by script hash), so it identifies nothing beyond
 * one request. `clearSessions` drops every coordinator token and is called
 * when the wallet locks.
 */
import { createQsbCoordinator, type QsbHttpFetch } from "@bramble/qsb/client";
import { createQsbSessions } from "@bramble/qsb/sessions";
import { createQsbAccountLocks } from "./qsb-vault-locks";
import type { QsbVaultDeps } from "./qsb-vault-session";

/** The wired deps, and the hook that drops their tokens on lock. */
export type QsbVaultWiring = QsbVaultDeps & { readonly clearSessions: () => void };

/** Builds the QSB vault deps over the root's fetch, clock and runtime. */
export const createQsbVaultWiring = (input: {
  readonly fetch: QsbHttpFetch;
  readonly now: () => number;
  readonly runtime: QsbVaultDeps["runtime"];
}): QsbVaultWiring => {
  const sessions = createQsbSessions({ now: input.now });
  return {
    clearSessions: sessions.clear,
    coordinator: createQsbCoordinator({ fetch: input.fetch }),
    drawVaultId: () => crypto.randomUUID(),
    locks: createQsbAccountLocks(),
    now: input.now,
    runtime: input.runtime,
    sessions,
  };
};
