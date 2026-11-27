/**
 * The shared scalar is redacted and restored only in the `viewing_key` slot of
 * `compile_actions(user, viewing_key, actions)` (#1073). A co-owner's package
 * with the marker anywhere else would otherwise be restored to the key there:
 * a withdrawal "to" the shared viewing key, shown in full on the review card
 * and published on chain if approved.
 */
import { describe, expect, test } from "bun:test";
import { multisigStrk20CallSetHash } from "@bramble/privacy/multisig-strk20";
import {
  MULTISIG_STRK20_REDACTED_FELT,
  redactStrk20Calldata,
  restoreStrk20Calldata,
} from "@bramble/privacy/multisig-strk20-redaction";
import {
  type MultisigStrk20ReviewScope,
  reviewMultisigStrk20Calls,
} from "@bramble/privacy/multisig-strk20-review";
import {
  canonicalFelt,
  STARKNET_NETWORKS,
  STRK_TOKEN_ADDRESS,
} from "@bramble/wallet-model/networks";
import {
  type ClientActionFelts,
  compileActionsCalldata,
  encNote,
  openChannel,
  withdraw,
} from "../support/multisig-callset";

const SCALAR = "0x654321";
const MARKER = MULTISIG_STRK20_REDACTED_FELT;
const ACCOUNT = "0x123";
const POOL = "0x9001";
const BOB = "0xb0b";
const STRK = STRK_TOKEN_ADDRESS;
const SCOPE: MultisigStrk20ReviewScope = {
  accountAddress: ACCOUNT,
  chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
  network: STARKNET_NETWORKS.SN_MAIN.name,
  poolAddress: POOL,
  tokens: [{ address: STRK, decimals: 18, symbol: "STRK" }],
};

// Redacted `compile_actions` calldata as a co-owner could send it: the marker
// in the key slot, plus wherever `actions` put it.
const sent = (actions: readonly ClientActionFelts[]): readonly string[] =>
  compileActionsCalldata(ACCOUNT, MARKER, actions);

const MISPLACED: Record<string, readonly ClientActionFelts[]> = {
  "a withdrawal's to_addr": [withdraw(MARKER, STRK, 10n ** 18n)],
  "a note's recipient_addr": [encNote(MARKER, STRK, 10n ** 18n)],
  "a channel's recipient": [openChannel(MARKER)],
};

describe("multisig STRK20 redaction is confined to the key slot", () => {
  test("round-trips the scalar in the key slot", () => {
    // Both sides come back as canonical felts, so the token loses its leading zero.
    const restored = compileActionsCalldata(ACCOUNT, SCALAR, [withdraw(BOB, STRK, 1n)]);
    const canonical = restored.map((felt) => canonicalFelt(felt) ?? felt);
    const redacted = redactStrk20Calldata(restored, SCALAR);
    expect(redacted).toEqual(canonical.map((felt, index) => (index === 1 ? MARKER : felt)));
    expect(restoreStrk20Calldata(redacted ?? [], SCALAR)).toEqual(canonical);
  });

  for (const [where, actions] of Object.entries(MISPLACED)) {
    test(`refuses a marker in ${where}`, () => {
      const calls = [
        { calldata: sent(actions), contractAddress: POOL, entrypoint: "compile_actions" },
      ];
      expect(restoreStrk20Calldata(calls[0]?.calldata ?? [], SCALAR)).toBeNull();
      expect(multisigStrk20CallSetHash(ACCOUNT, calls, SCOPE.chainId, SCALAR)).toBeNull();
      expect(reviewMultisigStrk20Calls(calls, SCALAR, SCOPE)).toBeNull();
    });

    test(`will not redact the scalar from ${where}`, () => {
      const scalarThere = actions.map((action) =>
        action.map((felt) => (felt === MARKER ? SCALAR : felt)),
      );
      expect(
        redactStrk20Calldata(compileActionsCalldata(ACCOUNT, SCALAR, scalarThere), SCALAR),
      ).toBeNull();
    });
  }

  test("refuses a marker or scalar outside slot 1, or missing from it", () => {
    expect(restoreStrk20Calldata([MARKER, MARKER, "0x0"], SCALAR)).toBeNull();
    expect(restoreStrk20Calldata([ACCOUNT, "0x5", MARKER], SCALAR)).toBeNull();
    expect(restoreStrk20Calldata([ACCOUNT, "0x5", "0x0"], SCALAR)).toBeNull();
    expect(redactStrk20Calldata([SCALAR, SCALAR, "0x0"], SCALAR)).toBeNull();
    expect(redactStrk20Calldata([ACCOUNT, "0x5", SCALAR], SCALAR)).toBeNull();
    expect(redactStrk20Calldata([ACCOUNT, "0x5", "0x0"], SCALAR)).toBeNull();
  });
});
