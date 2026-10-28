/**
 * Removing an undeployed multisig whose deployment commitment only this
 * record holds needs the same confirmation as deleting history (Sherlock
 * 214). The salt, signer set and threshold behind its counterfactual address
 * are not on chain yet, so the record is their only copy.
 */
import { describe, expect, test } from "bun:test";
import { UNDEPLOYED_REMOVAL_UNCONFIRMED } from "../../../apps/extension/src/background/multisig/multisig-account-ops";
import {
  HARNESS_MULTISIG_ID,
  type MultisigHarnessOptions,
  makeMultisigHarness,
  harnessExtensionSender as sender,
} from "../../support/multisig-harness";

const remove = async (options: MultisigHarnessOptions, confirmHistoryRemoval?: true) => {
  const harness = await makeMultisigHarness(options);
  const response = await harness.handler(
    {
      ...(confirmHistoryRemoval ? { confirmHistoryRemoval } : {}),
      multisigId: HARNESS_MULTISIG_ID,
      type: "wallet.removeMultisig",
    },
    sender,
  );
  return { remaining: await harness.multisigStore.listMultisigs(), response };
};

describe("removing a multisig that holds a deployment commitment", () => {
  test("asks for confirmation while it is undeployed, and keeps the record", async () => {
    const { remaining, response } = await remove({ deploymentStatus: false });
    expect(response).toEqual({ error: UNDEPLOYED_REMOVAL_UNCONFIRMED });
    expect(remaining).toHaveLength(1);
  });

  test("removes it once confirmed", async () => {
    const { remaining, response } = await remove({ deploymentStatus: false }, true);
    expect(response).toEqual({ ok: true });
    expect(remaining).toEqual([]);
  });

  test("asks for confirmation when the deployment status cannot be read", async () => {
    const { remaining, response } = await remove({
      deploymentStatus: () => {
        throw new Error("node unavailable");
      },
    });
    expect(response).toEqual({ error: UNDEPLOYED_REMOVAL_UNCONFIRMED });
    expect(remaining).toHaveLength(1);
  });

  test("removes a deployed multisig without confirmation", async () => {
    const { remaining, response } = await remove({ deploymentStatus: true });
    expect(response).toEqual({ ok: true });
    expect(remaining).toEqual([]);
  });

  test("removes an address-only watch without confirmation, since it holds no commitment", async () => {
    const { remaining, response } = await remove({ deploymentStatus: false, watchedOnly: true });
    expect(response).toEqual({ ok: true });
    expect(remaining).toEqual([]);
  });
});
