/**
 * MCW-V09-118 boundary contract: the origin-bound separator the background
 * derives must be a value the *pinned* privacy SDK can actually use.
 *
 * The SDK's `encodeDappName` short-string-encodes every `string` dapp name
 * (vendor/starknet-privacy/sdk/src/internal/sub-accounts.ts), and starknet.js
 * throws for a short string over 31 bytes. A suite that only inspects a stubbed
 * `Strk20Service` cannot see that: it pins which string the wallet passes, not
 * whether the SDK accepts it. These tests therefore drive the real adapter
 * (`createOfficialStrk20Service`) against an SDK double that runs the pinned
 * encoder verbatim, and assert one sub-account identity across the disclosure
 * and action paths.
 */
import { describe, expect, test } from "bun:test";
import {
  createOfficialStrk20Service,
  type PrivacySdkRuntime,
} from "@bramble/privacy/official-sdk-service";
import { STRK20_SERVICE_UNAVAILABLE } from "@bramble/privacy/service";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { BigNumberish } from "starknet";
import { num, shortString } from "starknet";
import { bindStrk20ActionsToOrigin } from "../../apps/extension/src/background/privacy/strk20-subaccount";
import {
  STRK20_SDK_CONTEXT as context,
  executeResult,
  STRK20_POOL_ADDRESS as poolAddress,
  providerFor,
  STRK20_SDK_TOKEN as token,
} from "../../packages/features/privacy/tests/support/official-sdk";

const ORIGIN = "https://example.com";

// The separator that shipped in v0.9.0's remediation attempt: SHA-256 truncated
// to 248 bits and rendered as a 0x felt. It is 64 characters, so the pinned
// SDK's short-string encoder rejects it for every origin and every label.
const REJECTED_FELT_SEPARATOR = "0xd4b5ddb6229476c950b321c359fdf7fc3abad70ee3c16be300ca7a21421a2b";

// Byte-for-byte the pinned SDK's own `encodeDappName`. The wallet's
// `Strk20Service` contract types `dappName` as `string`, so only the
// short-string branch is reachable from wallet code — which is exactly the
// branch the derivation has to satisfy.
const encodeDappName = (dappName: string): bigint =>
  BigInt(shortString.encodeShortString(dappName));

const subaccountAction = (dappName: string): Strk20Action => ({
  calls: [{ calldata: ["0x1"], contract_address: token, entry_point: "transfer" }],
  collect_policy: { type: "all" },
  dapp_name: dappName,
  nonce: "0x5",
  type: "subaccount_invoke",
});

// Reads the separator out of the production derivation rather than recomputing
// it, so this suite can never drift from the code it is pinning.
const derivedSeparator = async (origin: string, label: string): Promise<string> => {
  const [bound] = await bindStrk20ActionsToOrigin(origin, [subaccountAction(label)]);
  if (bound?.type !== "subaccount_invoke") {
    throw new Error("expected a bound subaccount action");
  }
  return bound.dapp_name;
};

// SDK double whose `subaccounts()` encodes exactly like the pinned SDK and
// records the felt the sub-account identity is actually built from. Both
// `commitment`/`partialCommitment` and `invoke` come from that one felt, which
// is what makes a disclosure/action divergence observable here.
const sdkFor = (seen: bigint[]): PrivacySdkRuntime => ({
  Open: Symbol("OPEN"),
  createPrivateTransfers: () => {
    const self = {
      createProofInvocation: async () => ({ warnings: [] }),
      invoke: () => self,
      simulate: async () => ({
        ...executeResult(),
        callAndProof: {
          call: { calldata: ["0x1"], contractAddress: poolAddress, entrypoint: "apply_actions" },
          proof: { data: "", output: [], proofFacts: [] },
        },
      }),
      subaccounts(dappName: string) {
        const encoded = encodeDappName(dappName);
        seen.push(encoded);
        return {
          commitment: async (nonce: BigNumberish) => encoded + BigInt(nonce),
          invoke: () => self,
          partialCommitment: async () => encoded,
        };
      },
      surplusTo: () => self,
      with: () => {
        const tokenBuilder = {
          deposit: () => tokenBuilder,
          done: () => self,
          transfer: () => tokenBuilder,
          withdraw: () => tokenBuilder,
        };
        return tokenBuilder;
      },
    };
    return {
      build: () => self,
      discoverNotes: async () => ({ notes: new Map() }),
      executeWithInvocation: async () => executeResult(),
    } as unknown as ReturnType<PrivacySdkRuntime["createPrivateTransfers"]>;
  },
});

describe("STRK20 sub-account separator against the pinned SDK", () => {
  test("the derived separator is a dapp name the pinned SDK encodes", async () => {
    const separator = await derivedSeparator(ORIGIN, "Example");
    const seen: bigint[] = [];
    const service = createOfficialStrk20Service({ providerFor, sdk: sdkFor(seen) });

    await expect(service.subaccountCommitment({ ...context, dappName: separator })).resolves.toBe(
      num.toHex(encodeDappName(separator)),
    );
    expect(seen).toEqual([encodeDappName(separator)]);
  });

  test("a 0x-felt separator is rejected by the pinned SDK, so it must never be derived", async () => {
    const service = createOfficialStrk20Service({ providerFor, sdk: sdkFor([]) });

    // Pins why the derivation is length-bounded: the SDK short-string-encodes
    // the string it is handed, and the adapter collapses the resulting throw
    // into a generic unavailable error the user cannot act on.
    expect(REJECTED_FELT_SEPARATOR.length).toBeGreaterThan(31);
    await expect(
      service.subaccountCommitment({ ...context, dappName: REJECTED_FELT_SEPARATOR }),
    ).rejects.toThrow(STRK20_SERVICE_UNAVAILABLE);
    expect(await derivedSeparator(ORIGIN, "Example")).not.toBe(REJECTED_FELT_SEPARATOR);
  });

  test("the disclosed commitment and the approved action name one sub-account", async () => {
    const separator = await derivedSeparator(ORIGIN, "Example");
    const seen: bigint[] = [];
    const service = createOfficialStrk20Service({ providerFor, sdk: sdkFor(seen) });

    await service.subaccountCommitment({ ...context, dappName: separator, nonce: "0x5" });
    await service.prepare({
      ...context,
      actions: await bindStrk20ActionsToOrigin(ORIGIN, [subaccountAction("Example")]),
      simulate: true,
    });

    expect(seen).toEqual([encodeDappName(separator), encodeDappName(separator)]);
  });

  test("two origins reach different sub-accounts for one requested label", async () => {
    const seen: bigint[] = [];
    const service = createOfficialStrk20Service({ providerFor, sdk: sdkFor(seen) });

    for (const origin of [ORIGIN, "https://evil.example"]) {
      await service.prepare({
        ...context,
        actions: await bindStrk20ActionsToOrigin(origin, [subaccountAction("Example")]),
        simulate: true,
      });
    }

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });
});
