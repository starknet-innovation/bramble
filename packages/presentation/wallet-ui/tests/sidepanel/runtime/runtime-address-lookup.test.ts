/** The panel's import-by-address calls (issue 398): what they send, accept, and refuse. */
import { describe, expect, test } from "bun:test";
import type { RecoveryAccountCandidate } from "@bramble/wallet-model/recovery";
import { createAccountRuntimeClient } from "../../../src/sidepanel/runtime/runtime-accounts";

const candidate: RecoveryAccountCandidate = {
  account: {
    accountContractType: "argent",
    address: "0x7e57ad0e55",
    classHash: "0x36078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f",
    deploymentSalt: "0x2a",
    derivation: { addressIndex: 4, kind: "argentx-bip44" },
    id: "SN_MAIN:0x7e57ad0e55",
    networkId: "SN_MAIN",
    publicKeyX: "0x2a",
  },
  byAddress: true,
  deployed: true,
  funded: false,
};

const clientAnswering = (response: unknown) => {
  const sent: unknown[] = [];
  const client = createAccountRuntimeClient(async (message) => {
    sent.push(message);
    return response;
  });
  return { client, sent };
};

describe("import-by-address runtime calls", () => {
  test("the phrase lookup sends the phrase, network, and address, and returns the candidate", async () => {
    const { client, sent } = clientAnswering({ candidate, ok: true });
    await expect(
      client.findRecoveryAccountByAddress("phrase words", "SN_MAIN", "0x7e57ad0e55"),
    ).resolves.toEqual(candidate);
    expect(sent).toEqual([
      {
        address: "0x7e57ad0e55",
        mnemonic: "phrase words",
        networkId: "SN_MAIN",
        type: "wallet.findRecoveryAccountByAddress",
      },
    ]);
  });

  test("the own-phrase lookup sends no phrase", async () => {
    const { client, sent } = clientAnswering({ candidate, ok: true });
    await expect(client.findOwnAccountByAddress("SN_SEPOLIA", "0x7e57ad0e55")).resolves.toEqual(
      candidate,
    );
    expect(sent).toEqual([
      { address: "0x7e57ad0e55", networkId: "SN_SEPOLIA", type: "wallet.findOwnAccountByAddress" },
    ]);
  });

  test("a refusal, or a candidate not marked as found by address, is thrown", async () => {
    const refused = clientAnswering({ error: "recovery phrase does not control this account" });
    await expect(
      refused.client.findRecoveryAccountByAddress("phrase", "SN_MAIN", "0x1"),
    ).rejects.toThrow("recovery phrase does not control this account");
    const { byAddress: _marker, ...unmarked } = candidate;
    const odd = clientAnswering({ candidate: unmarked, ok: true });
    await expect(odd.client.findOwnAccountByAddress("SN_MAIN", "0x1")).rejects.toThrow(
      "account lookup unavailable",
    );
  });
});
