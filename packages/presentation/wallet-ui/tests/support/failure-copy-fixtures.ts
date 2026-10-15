/**
 * Shared fixtures for the "Copy error details" coverage: the panel-side error a
 * private-transaction stage failure becomes, built through the same boundary
 * the wallet uses, and a clipboard stub that records what a copy control wrote.
 * Test support only — never imported by production code.
 */

import { walletErrorMessage } from "@bramble/core/errors";
import { mapStrk20StageError, type Strk20FailureStage } from "@bramble/privacy/official-sdk-errors";
import { responseError } from "../../src/sidepanel/runtime/runtime-errors";

/** An endpoint in the SDK's own failure text, which must never reach a copy. */
export const STAGE_FAILURE_ENDPOINT = "https://rpc.example.test/v3/node-key-123";

/** A felt in the SDK's own failure text, which must never reach a copy. */
export const STAGE_FAILURE_FELT = `0x${"a".repeat(64)}`;

/**
 * The Error the panel holds when a private transaction fails at `stage`. The
 * SDK failure is mapped by `mapStrk20StageError`, reduced to wallet-authored
 * text by `walletErrorMessage` (the rule the background's `errorText` applies
 * to every privacy reply), and rebuilt from the `{ error }` reply by the
 * panel's own `responseError`.
 */
export const panelStageError = (stage: Strk20FailureStage = "submission"): Error => {
  let mapped: unknown;
  try {
    mapStrk20StageError(
      stage,
      new Error(
        `execution reverted: u256_sub Overflow at ${STAGE_FAILURE_FELT} from ${STAGE_FAILURE_ENDPOINT}`,
      ),
    );
  } catch (error) {
    mapped = error;
  }
  return responseError(
    { error: walletErrorMessage(mapped, "Private transaction failed") },
    "Private transaction failed",
  );
};

/**
 * What {@link panelStageError} carries for the submission stage: the stage and
 * category the friendly sentence drops, then the sanitized revert detail.
 */
export const SUBMISSION_STAGE_DETAILS =
  "strk20 services unavailable (submission/execution-reverted): execution reverted: u256_sub Overflow at [value] from [endpoint]";

/** Installs a clipboard that records every write, and returns the record. */
export const captureClipboard = (): string[] => {
  const copied: string[] = [];
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        copied.push(value);
      },
    },
  });
  return copied;
};
