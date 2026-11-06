/**
 * Supply-chain pins for the offline Ledger E2E suite (issue 861): the Ledger
 * Starknet app source, the image that builds it, the Speculos emulator image,
 * and the SHA-256 of each built app binary. Nothing here ships; the wallet
 * never loads these files. They decide what code runs in the E2E job, so every
 * input is pinned by commit or digest, never by tag or branch.
 *
 * - `vendor:ledger-app` (`scripts/vendor-ledger-app.ts`) fetches the commit and
 *   builds each model's binary inside the builder image.
 * - `check:ledger-app` (`scripts/check-ledger-app.ts`, part of `check`) verifies
 *   these pins' shape and, when binaries exist, their recorded hashes.
 * - `test:e2e:ledger` (`tests/e2e/ledger/run-speculos.ts`) refuses to start
 *   Speculos on a binary whose hash is not recorded here.
 *
 * Binary hashes start unrecorded (null): the first build on a machine with
 * Docker prints them, and a reviewed commit records them. Until then the
 * Speculos suite cannot run, by design.
 */

/** Ledger's official Starknet app repository. */
export const APP_STARKNET_REPOSITORY = "https://github.com/LedgerHQ/app-starknet.git";

/** App release the pinned commit carries (tags `*_2.4.3_sdk_v26.6.5`). */
export const APP_STARKNET_VERSION = "2.4.3";

/** Commit of app-starknet 2.4.3 (the commit every `*_2.4.3_*` release tag points at). */
export const APP_STARKNET_REVISION = "f87210cd556cbe9e9c63a5edd6be2c23618c749d";

/**
 * `ledger-app-builder` 5.5.1 (created 2026-10-22). Ships the app's pinned
 * toolchain, `RUSTUP_TOOLCHAIN=nightly-2025-12-05`, matching
 * `starknet/rust-toolchain.toml` at the pinned commit.
 */
export const LEDGER_APP_BUILDER_IMAGE =
  "ghcr.io/ledgerhq/ledger-app-builder/ledger-app-builder@sha256:0e7eac1c8d93bd38ce0c6065062694c00c383b138689b532400a264714da2887";

/** Speculos v0.27.1 (created 2026-10-01, after the app commit of 2026-09-25). */
export const SPECULOS_IMAGE =
  "ghcr.io/ledgerhq/speculos@sha256:028d1e368244631578537e7ca50b6f13ca2932b5f3fd220627289b559c07a886";

/** Where the vendoring script checks out the app source. */
export const LEDGER_APP_DIR = "vendor/ledger-app-starknet";

/**
 * Where built binaries go: outside the checkout, which is wiped to the pinned
 * tree before every build.
 */
export const LEDGER_APP_BIN_DIR = "vendor/ledger-app-bin";

/** Speculos model name → cargo-ledger device and the recorded binary hash. */
export const LEDGER_APP_BINARIES: Readonly<
  Record<
    "nanosp" | "flex" | "stax",
    { readonly cargoDevice: string; readonly sha256: string | null }
  >
> = {
  flex: { cargoDevice: "flex", sha256: null },
  nanosp: { cargoDevice: "nanosplus", sha256: null },
  stax: { cargoDevice: "stax", sha256: null },
};

/** Path of one model's built app binary. */
export const ledgerAppBinaryPath = (model: keyof typeof LEDGER_APP_BINARIES): string =>
  `${LEDGER_APP_BIN_DIR}/${model}.elf`;
