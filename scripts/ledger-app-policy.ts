/**
 * Pure checks for the Ledger E2E supply-chain pins (`scripts/ledger-app-pins.ts`).
 * Kept apart from the filesystem and git reads in `check-ledger-app.ts` so the
 * rules are unit-tested (`tests/scripts/ledger-app-pins.test.ts`).
 */

const IMAGE_BY_DIGEST = /^ghcr\.io\/ledgerhq\/[a-z0-9/_-]+@sha256:[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** The pin values a check reads. */
export type LedgerAppPins = {
  readonly binaries: Readonly<Record<string, { readonly sha256: string | null }>>;
  readonly builderImage: string;
  readonly revision: string;
  readonly speculosImage: string;
};

/**
 * Reports malformed pins: a revision that is not a full commit, an image named
 * by tag rather than digest (or outside Ledger's ghcr namespace), or a binary
 * hash that is neither unrecorded (null) nor a SHA-256.
 */
export const ledgerAppPinFailures = (pins: LedgerAppPins): readonly string[] => {
  const failures: string[] = [];
  if (!/^[0-9a-f]{40}$/.test(pins.revision)) {
    failures.push("app-starknet must be pinned to a full 40-hex commit");
  }
  for (const [name, image] of [
    ["ledger-app-builder", pins.builderImage],
    ["Speculos", pins.speculosImage],
  ] as const) {
    if (!IMAGE_BY_DIGEST.test(image)) {
      failures.push(`${name} image must be a ghcr.io/ledgerhq image pinned by sha256 digest`);
    }
  }
  for (const [model, binary] of Object.entries(pins.binaries)) {
    if (binary.sha256 !== null && !SHA256.test(binary.sha256)) {
      failures.push(`${model} app binary hash must be null or a lowercase SHA-256`);
    }
  }
  return failures;
};

/**
 * Reports a built binary that is not covered by a recorded hash. `digest` is
 * null when the binary is absent, which is not a failure: CI does not build
 * the app, and the Speculos runner refuses to start without a recorded match.
 */
export const ledgerAppBinaryFailure = (
  model: string,
  pinned: string | null,
  digest: string | null,
): string | null => {
  if (digest === null) {
    return null;
  }
  if (pinned === null) {
    return `${model} app binary exists but its hash is not recorded in scripts/ledger-app-pins.ts`;
  }
  return digest === pinned ? null : `${model} app binary does not match its recorded hash`;
};
