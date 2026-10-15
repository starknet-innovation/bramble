/**
 * Cross-layer SNIP-12 CallSet golden vector from the pinned privacy protocol.
 * A drift here would make every private proof authorization fail on-chain.
 */
import { describe, expect, test } from "bun:test";
import { computeStrk20CallSetHash, Strk20CallSetSigner } from "@bramble/privacy/call-set-signer";
import {
  type Call,
  ec,
  type InvocationsSignerDetails,
  num,
  shortString,
  type TypedData,
} from "starknet";

const chainId = shortString.encodeShortString("TEST");
const account = 0x1234n;
const calls: readonly Call[] = [
  { calldata: ["0x1", "0x2"], contractAddress: "0x111", entrypoint: "approve" },
];
const golden = "0x79d05f5b8993f5a0a18c6f7001e4d573c3eb97f322f6008cc1420f4f611501f";

describe("STRK20 CallSet authorization", () => {
  test("matches the privacy contract golden vector", () => {
    expect(num.toHex(computeStrk20CallSetHash(account, calls, chainId))).toBe(golden);
  });

  test("binds calls, account, chain, and additional data", () => {
    const baseline = computeStrk20CallSetHash(account, calls, chainId);
    expect(computeStrk20CallSetHash(account, [], chainId)).not.toBe(baseline);
    expect(computeStrk20CallSetHash(0x999n, calls, chainId)).not.toBe(baseline);
    expect(
      computeStrk20CallSetHash(account, calls, shortString.encodeShortString("OTHER")),
    ).not.toBe(baseline);
    expect(computeStrk20CallSetHash(account, calls, chainId, ["0x1"])).not.toBe(baseline);
  });

  test("signs exactly the CallSet digest through the injected account boundary", async () => {
    const privateKey = "0x1234567890abcdef";
    const signer = new Strk20CallSetSigner({
      accountAddress: account,
      chainId,
      sign: async (messageHash) => ec.starkCurve.sign(messageHash, privateKey),
    });
    const signature = await signer.signTransaction([...calls], {} as InvocationsSignerDetails);
    expect(
      ec.starkCurve.verify(signature as never, golden, ec.starkCurve.getPublicKey(privateKey)),
    ).toBe(true);
  });

  test("keeps the privacy contract's raw Stark signature shape unchanged", async () => {
    const signer = new Strk20CallSetSigner({
      accountAddress: account,
      chainId,
      sign: async () => ["0x01", "0x02"],
    });

    await expect(
      signer.signTransaction([...calls], {} as InvocationsSignerDetails),
    ).resolves.toEqual(["0x01", "0x02"]);
  });

  test("fails closed for unsupported signer operations", async () => {
    const signer = new Strk20CallSetSigner({
      accountAddress: account,
      chainId,
      sign: async () => ["0x1", "0x2"],
    });
    await expect(signer.getPubKey()).rejects.toThrow("does not expose public keys");
    await expect(signer.signDeclareTransaction({} as never)).rejects.toThrow(
      "does not declare classes",
    );
    await expect(signer.signDeployAccountTransaction({} as never)).rejects.toThrow(
      "does not deploy accounts",
    );
    await expect(signer.signMessage({} as TypedData, "0x999")).rejects.toThrow(
      "does not sign messages",
    );
  });

  test("never signs a SNIP-12 message, even for its own account (Sherlock 246)", async () => {
    let signed = 0;
    const signer = new Strk20CallSetSigner({
      accountAddress: account,
      chainId,
      sign: async () => {
        signed += 1;
        return ["0x1", "0x2"];
      },
    });
    const message: TypedData = {
      domain: { chainId, name: "Any dapp", revision: "1", version: "1" },
      message: { amount: "1000", to: "0xbeef" },
      primaryType: "Transfer",
      types: {
        StarknetDomain: [
          { name: "name", type: "shortstring" },
          { name: "version", type: "shortstring" },
          { name: "chainId", type: "shortstring" },
          { name: "revision", type: "shortstring" },
        ],
        Transfer: [
          { name: "to", type: "ContractAddress" },
          { name: "amount", type: "u128" },
        ],
      },
    };

    await expect(signer.signMessage(message, num.toHex(account))).rejects.toThrow(
      "does not sign messages",
    );
    expect(signed).toBe(0);
  });
});
