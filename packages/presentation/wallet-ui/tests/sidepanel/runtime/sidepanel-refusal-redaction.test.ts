/**
 * No endpoint reaches panel text through a refused reply.
 *
 * On the public routes a refusal's text can be a node's or gateway's own
 * words, which may echo the configured RPC URL and the API key in its path.
 * The panel shows that text and lets the user copy it, so every reader that
 * turns a reply's `error` into text — `responseError` for every shape, and the
 * readers that keep the refusal as text — redacts endpoints, and keeps the
 * rest of the diagnostic.
 */
import { describe, expect, test } from "bun:test";
import { PrivacyBlockerError } from "@bramble/wallet-protocol/privacy-blocker";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { createLedgerRuntimeClient } from "../../../src/sidepanel/journeys/ledger/runtime-client";
import { createMultisigClient } from "../../../src/sidepanel/journeys/multisig/multisig-runtime";
import { createOnboardingRuntimeClient } from "../../../src/sidepanel/journeys/onboarding/onboarding-runtime";
import { createSidepanelRuntime } from "../../../src/sidepanel/runtime/runtime";
import { refusalText, responseError } from "../../../src/sidepanel/runtime/runtime-errors";

const KEY = "node-key-123";
const ENDPOINT = `https://rpc.example.test/v0_8/${KEY}`;
// The shape a starknet.js RpcError takes: method, code, message, and the
// node's own data, here echoing the URL it was called on.
const RAW = `RPC: starknet_getNonce with params {}\n\n -32603: Internal error: {"url":"${ENDPOINT}","detail":"upstream 401"}`;
const REDACTED =
  'RPC: starknet_getNonce with params {}\n\n -32603: Internal error: {"url":"[endpoint]","detail":"upstream 401"}';

const HASH = "0x5eed";

const rejection = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};

describe("responseError", () => {
  test("a plain refusal keeps its diagnostic but not its endpoint", () => {
    expect(responseError({ error: RAW }, "fallback").message).toBe(REDACTED);
  });

  test("a typed unknown outcome keeps its hash and loses its endpoint", () => {
    const error = responseError(
      { error: `status unknown at ${ENDPOINT}`, submissionUnknown: true, transactionHash: HASH },
      "fallback",
    );
    expect(error).toBeInstanceOf(SubmissionUnknownError);
    expect(error.message).toBe("status unknown at [endpoint]");
    expect((error as SubmissionUnknownError).transactionHash).toBe(HASH);
  });

  test("a privacy blocker keeps its kind and loses its endpoint", () => {
    const error = responseError(
      { error: `service down at ${ENDPOINT}`, privacyBlocker: "service" },
      "fallback",
    );
    expect(error).toBeInstanceOf(PrivacyBlockerError);
    expect(error.message).toBe("service down at [endpoint]");
    expect((error as PrivacyBlockerError).kind).toBe("service");
  });

  test("an unrecognised reply still falls back, untouched", () => {
    expect(responseError({ error: RAW, extra: true }, "fallback").message).toBe("fallback");
    expect(refusalText(undefined, "fallback")).toBe("fallback");
  });
});

describe("readers that keep a refusal as text", () => {
  const refusing = async (): Promise<unknown> => ({ error: RAW });

  test("the balances line", async () => {
    const wallet = createSidepanelRuntime({ sendMessage: refusing });
    expect(await wallet.loadBalances()).toEqual({ error: REDACTED });
  });

  test("the multisig balances line", async () => {
    const client = createMultisigClient({ sendMessage: refusing });
    expect(await client.loadBalances("multisig-1")).toEqual({ error: REDACTED });
  });

  test("the Ledger and onboarding clients' own Errors", async () => {
    const ledger = await rejection(() =>
      createLedgerRuntimeClient(refusing).addLedgerAccount("SN_MAIN", 0, "0x1", "argent"),
    );
    const onboarding = await rejection(() =>
      createOnboardingRuntimeClient(refusing).generateMnemonic(),
    );
    expect((ledger as Error).message).toBe(REDACTED);
    expect((onboarding as Error).message).toBe(REDACTED);
    expect(
      JSON.stringify([(ledger as Error).message, (onboarding as Error).message]),
    ).not.toContain(KEY);
  });
});
