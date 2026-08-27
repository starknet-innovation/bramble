/**
 * The routes the add-account chooser offers.
 *
 * Not Ledger-specific, despite the chooser living in the Ledger onboarding
 * overlay: the list already spans this wallet's recovery phrase, a Ledger, a
 * raw-key import, a shared Argent multisig, and a paired post-quantum device.
 * It lives here so adding a signer model does not grow a Ledger module, and so
 * the chooser's template, its controller, and its DOM binder all name the same
 * closed set.
 */

/**
 * One route out of the add-account chooser. `openzeppelin` and `argent` derive
 * the next account from this wallet's recovery phrase; the two `ledger-*` routes
 * pick an account contract for a device account; and `import`, `mobile-pq`, and
 * `multisig` hand off to their own journeys.
 */
export type AddAccountRoute =
  | "argent"
  | "import"
  | "ledger-argent"
  | "ledger-openzeppelin"
  | "mobile-pq"
  | "multisig"
  | "openzeppelin";

/**
 * Validates a route read off a chooser button's dataset.
 */
export const isAddAccountRoute = (value: string | undefined): value is AddAccountRoute =>
  value === "argent" ||
  value === "import" ||
  value === "ledger-argent" ||
  value === "ledger-openzeppelin" ||
  value === "mobile-pq" ||
  value === "multisig" ||
  value === "openzeppelin";
