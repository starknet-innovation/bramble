/**
 * Xverse account address derivation (issue 734).
 *
 * The expected address is computed exactly the way xverse-core does it
 * (`createAX040W0GContractDescription` + `getExpectedAccountContractAddress`,
 * secretkeylabs/xverse-core `starknet/utils.ts`): the Argent build Xverse pins,
 * `owner = Signer::Starknet(pubkey)`, `guardian = None`, salt = pubkey,
 * deployer 0. Building it independently with starknet.js's Cairo encoders
 * catches a wrong class or a wrong calldata layout, either of which yields a
 * well-formed address that belongs to nobody.
 */
import { describe, expect, test } from "bun:test";
import { accountAddressCandidates } from "@bramble/starknet/account-contracts";
import { XVERSE_ARGENT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { CairoCustomEnum, CairoOption, CairoOptionVariant, CallData, ec, hash } from "starknet";

const sameFelt = (a: string, b: string): boolean =>
  a.toLowerCase().replace(/^0x0*/, "") === b.toLowerCase().replace(/^0x0*/, "");

const xverseAddress = (publicKey: string): string =>
  hash.calculateContractAddressFromHash(
    publicKey,
    "0x663fc01a0dbe1bacc4cd2a4c856eb9784b255a20988aa33d4d52b6fc20bd024",
    CallData.compile({
      // starknet.js numbers a variant by its key's position; Xverse lists
      // Starknet first, as Argent's `Signer` enum does (variant 0). The other
      // variants it lists after it are all unset, so they change nothing.
      owner: new CairoCustomEnum({ Starknet: { signer: publicKey } }),
      guardian: new CairoOption(CairoOptionVariant.None),
    }),
    0,
  );

describe("Xverse account candidates", () => {
  test("pins the class Xverse deploys at", () => {
    expect(
      sameFelt(
        XVERSE_ARGENT_CLASS_HASH,
        "0x663fc01a0dbe1bacc4cd2a4c856eb9784b255a20988aa33d4d52b6fc20bd024",
      ),
    ).toBe(true);
  });

  for (const privateKey of ["0x1", "0x2f5c1a7e", "0x6b86b273ff34fce19d6b804eff5a3f574"]) {
    test(`reproduces Xverse's own address derivation for key ${privateKey}`, () => {
      const publicKey = ec.starkCurve.getStarkKey(privateKey);
      const hit = accountAddressCandidates(publicKey, "argent").find((candidate) =>
        sameFelt(candidate.entry.classHash, XVERSE_ARGENT_CLASS_HASH),
      );
      expect(hit).toBeDefined();
      expect(sameFelt(hit?.address ?? "0x0", xverseAddress(publicKey))).toBe(true);
    });
  }
});
