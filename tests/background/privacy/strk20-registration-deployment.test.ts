/** Undeployed registration must stop before privacy services or proof generation. */
import { describe, expect, test } from "bun:test";
import { PRIVACY_DEPLOY_REQUIRED } from "@bramble/wallet-protocol/privacy-blocker";
import {
  buildStrk20Handler,
  makeStrk20Service,
  prepareStrk20Registration,
} from "../../support/strk20-background";

describe("registration deployment prerequisite", () => {
  test("refuses before discovery, fee reads and proving, even when services fail", async () => {
    const calls: string[] = [];
    const handler = buildStrk20Handler({
      deployed: false,
      strk20: {
        ...makeStrk20Service(),
        async registrationStatus() {
          calls.push("discovery");
          throw new Error("offline");
        },
        async poolFee() {
          calls.push("fee");
          throw new Error("offline");
        },
        async prepareRegistration() {
          calls.push("proof");
          throw new Error("offline");
        },
      },
    });
    expect(await prepareStrk20Registration(handler)).toEqual({
      error: PRIVACY_DEPLOY_REQUIRED,
      privacyBlocker: "deploy",
    });
    expect(calls).toEqual([]);
  });
  test("returns a typed funding blocker for a deployed account before proving", async () => {
    const proofs = { value: 0 };
    const handler = buildStrk20Handler({
      deployed: true,
      registered: false,
      publicBalance: "0",
      proveCalls: proofs,
    });
    expect(await prepareStrk20Registration(handler)).toMatchObject({ privacyBlocker: "fund" });
    expect(proofs.value).toBe(0);
  });
});
