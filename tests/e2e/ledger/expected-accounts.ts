/**
 * Addresses the wallet must derive from the emulated Ledger at index 0, for
 * the repository's PUBLIC test phrase (`IMPORT_MNEMONIC`), which Speculos is
 * seeded with. Shapes follow the Sepolia set: TA-32 (LedgerW path, OZ 3.0.0,
 * salt 0) and TA-33 (argentx path, Argent 0.4.0).
 *
 * Pinned as literals because the derivation tooling runs under Bun and the
 * Playwright runner is Node; `expected-accounts.test.ts` re-derives both with
 * the vendor-dataset tooling (`ledgerKeypair`), so they cannot drift.
 *
 * Test-only. Nothing in `apps/` or `packages/` may import this file.
 */
export const EXPECTED_LEDGER_ACCOUNTS = {
  argentx: "0x42324d970c81af6f9e2f0dd741bd9cab1dab289a9c7a7829f16abef5076d19b",
  ledgerW: "0x267ff61627a5fe9e4a469c7d44bfde5fa381e1a7cf1656a1ff33a2e0aa97f70",
} as const;
