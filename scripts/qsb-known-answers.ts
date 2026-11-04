/**
 * Known answers for the QSB runtime's public-only probe, shared by the
 * `check:qsb` gate (real adapter, Bun) and the extension E2E (real adapter,
 * MV3 service worker) so the two cannot disagree about what "it ran" means.
 *
 * Each value was derived independently of the pipeline: SHA-256d of the empty
 * string is the published constant, `validSmallR` is every x in [1, 127] for
 * which x^3 + 7 is a quadratic residue modulo the secp256k1 field prime (by
 * Euler's criterion, where the pipeline takes a square root), and `push20` is
 * the Bitcoin script push of twenty zero bytes.
 */
import type { QsbPublicProbe } from "../apps/extension/src/background/qsb/qsb-runtime";

/**
 * The probe output a correctly loaded pipeline returns, in the adapter's shape.
 */
export const QSB_PUBLIC_PROBE_ANSWERS: QsbPublicProbe = {
  push20: `14${"00".repeat(20)}`,
  sha256dEmpty: "5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456",
  validSmallR: [
    1, 2, 3, 4, 6, 8, 12, 13, 14, 16, 20, 22, 25, 27, 32, 33, 38, 39, 43, 44, 45, 47, 48, 52, 56,
    57, 59, 61, 63, 64, 66, 69, 73, 74, 76, 77, 81, 82, 83, 85, 88, 89, 90, 91, 95, 97, 102, 104,
    106, 107, 110, 111, 112, 115, 118, 119, 123, 126,
  ],
};
