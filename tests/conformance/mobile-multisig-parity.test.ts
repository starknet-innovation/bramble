/**
 * The Rust core's multisig transactions (wallet-core's P1) are pinned by G5's
 * `extension-multisig-transactions*.json`: deploy, propose, co-sign, submit and change signers
 * as the extension runs them over a canned node, and the inputs it refuses. This fails when a
 * committed part is no longer what the extension produces: re-run `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { computeMultisigTransactionFixture } from "../../scripts/mobile-multisig-refusals";

type Flows = {
  readonly networks: readonly {
    readonly deploy: { readonly submit: readonly string[] };
    readonly proposal: {
      readonly stages: readonly { readonly valid: boolean }[];
      readonly submit: readonly string[];
    };
  }[];
};

const methods = (wire: readonly string[]): readonly string[] =>
  wire.map((exchange) => (JSON.parse(exchange) as { readonly method: string }).method);

describe("mobile multisig transaction parity", () => {
  test("the committed fixture is what the extension's multisig paths do today", async () => {
    const parts = await computeMultisigTransactionFixture();
    for (const [path, part] of parts) {
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(part);
    }
    // The recorded paths reached the node's write methods, and every stage was a valid intent.
    const flows = [...parts.values()][0] as Flows;
    for (const network of flows.networks) {
      expect(methods(network.deploy.submit)).toContain("starknet_addDeployAccountTransaction");
      expect(methods(network.proposal.submit)).toContain("starknet_addInvokeTransaction");
      expect(network.proposal.stages.map((stage) => stage.valid)).toEqual([true, true, true]);
    }
    // About 3.5 s locally; the transaction fixture's test already overruns bun's 5 s default.
  }, 30_000);
});
