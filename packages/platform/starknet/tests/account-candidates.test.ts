/**
 * Candidate address derivation across account families.
 *
 * The fixtures are real Mainnet accounts, each verified by reading its signer
 * public key from chain and confirming the address reproduces. They are here
 * because the failure this code exists to prevent is silent: pair a correct
 * class hash with the wrong constructor calldata, or derive from a class the
 * account merely upgraded to, and you get a well-formed address that belongs to
 * nobody — indistinguishable from the user simply having no account.
 */
import { describe, expect, test } from "bun:test";
import { accountAddressCandidates } from "@bramble/starknet/account-contracts";
import { ACCOUNT_CLASSES, deploymentClasses } from "@bramble/wallet-model/account-families";

const sameFelt = (a: string, b: string): boolean =>
  a.toLowerCase().replace(/^0x0*/, "") === b.toLowerCase().replace(/^0x0*/, "");

// Real Mainnet accounts. Address and public key read from chain; the class is
// the one whose derivation reproduces the address.
const FIXTURES = [
  {
    address: "0x23e1391f6130cfd5d20100cf96f55400ad9f2075d8a4373220d1e7ffdb50fa",
    label: "braavos base",
    // Deployed with the Braavos base class, now running the legacy
    // implementation — the upgrade case that a single pinned hash misses.
    publicKey: "0x7829fdac0277b7dcd88e2ad2dad78a9eed97c323456a185a74e2d271b0d2163",
  },
  {
    address: "0x104a85ce860810d8248f4fddf8d9693a9c7b2ea2ad118a5aab2c0818a90799e",
    label: "argent 0.3.1",
    publicKey: "0x643575e365b6daee762414b822bb9afb10b104715381675923653d3dd330694",
  },
  {
    address: "0x1039e25658cae2e03ee36a92c127e0cb6d0d31de38dc4595f9d871acb91578d",
    label: "argent 0.3.0",
    publicKey: "0x689fa6497d5d8630826855d1016d134322b05d7762324bc6199a7de9ec2f850",
  },
] as const;

describe("accountAddressCandidates", () => {
  for (const fixture of FIXTURES) {
    test(`reproduces a real ${fixture.label} account`, () => {
      const candidates = accountAddressCandidates(fixture.publicKey);
      const hit = candidates.find((candidate) => sameFelt(candidate.address, fixture.address));
      expect(hit).toBeDefined();
      expect(hit?.entry.label).toBe(fixture.label);
    });
  }

  test("derives only from classes an account can be deployed with", () => {
    // A Braavos account never holds the implementation hash at deployment, so
    // deriving from one produces an address belonging to nobody. Implementation
    // -only classes must not appear among candidates.
    const implementationOnly = ACCOUNT_CLASSES.filter(
      (entry) => !entry.roles.includes("deployment"),
    );
    expect(implementationOnly.length).toBeGreaterThan(0);
    const candidateLabels = accountAddressCandidates("0x1234").map((c) => c.entry.label);
    for (const entry of implementationOnly) {
      expect(candidateLabels).not.toContain(entry.label);
    }
  });

  test("covers every deployment class, so a family cannot be silently dropped", () => {
    const candidates = accountAddressCandidates("0x1234");
    expect(candidates).toHaveLength(deploymentClasses().length);
    expect(new Set(candidates.map((c) => c.address)).size).toBe(candidates.length);
    expect(new Set(candidates.map((c) => c.entry.family))).toEqual(new Set(["argent", "braavos"]));
  });

  test("narrows to one family when asked", () => {
    const braavos = accountAddressCandidates("0x1234", "braavos");
    expect(braavos.length).toBeGreaterThan(0);
    expect(braavos.every((c) => c.entry.family === "braavos")).toBe(true);
  });
});
