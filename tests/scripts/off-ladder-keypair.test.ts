/**
 * The S-TXN key-import accounts (TX-09, TX-10) must import by key only and
 * never surface in a phrase scan. That rests on the path (the BIP-44 change
 * branch, which no ladder walks); this checks it against the first scan window
 * of the Bramble, Ready and Braavos ladders, since each derivation re-stretches
 * the seed and the full 200-index ceiling is too slow for the unit suite.
 */
import { describe, expect, test } from "bun:test";
import { RECOVERY_SCAN_LIMITS } from "@bramble/wallet-model/recovery";
import {
  braavosKeypair,
  brambleKeypair,
  offLadderKeypair,
  readyKeypair,
} from "../../tools/vendor-dataset/matrix-lib";
import { IMPORT_MNEMONIC } from "../e2e/wallet-helpers";

describe("offLadderKeypair", () => {
  test("is deterministic and distinct per index", () => {
    expect(offLadderKeypair(IMPORT_MNEMONIC, 0)).toEqual(offLadderKeypair(IMPORT_MNEMONIC, 0));
    expect(offLadderKeypair(IMPORT_MNEMONIC, 0).pub).not.toBe(
      offLadderKeypair(IMPORT_MNEMONIC, 1).pub,
    );
  });

  test("never equals a key the first scan window derives", () => {
    const ladders = new Set<string>();
    for (let i = 0; i < RECOVERY_SCAN_LIMITS.defaultCount; i += 1) {
      for (const derive of [brambleKeypair, readyKeypair, braavosKeypair]) {
        ladders.add(derive(IMPORT_MNEMONIC, i).pub);
      }
    }
    for (const index of [0, 1]) {
      expect(ladders.has(offLadderKeypair(IMPORT_MNEMONIC, index).pub)).toBe(false);
    }
  }, 30_000);
});
