/** Advisory signability classification for recovery candidates (issue 542). */
import { describe, expect, test } from "bun:test";
import { argentSigningRestriction } from "@bramble/starknet/deployment";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import type { RpcProvider } from "starknet";

const OWNER = "0xabc";
const ACCOUNT = { address: "0x123", publicKeyX: OWNER };

type SignerState = {
  readonly get_guardian?: readonly string[];
  readonly get_owner?: readonly string[];
  readonly get_owner_type?: readonly string[];
};

const providerOf = (liveClass: string, state: SignerState = {}): RpcProvider =>
  ({
    async getClassHashAt() {
      return liveClass;
    },
    async callContract({ entrypoint }: { readonly entrypoint: string }) {
      const result = state[entrypoint as keyof SignerState];
      if (!result) throw new Error(`unexpected read: ${entrypoint}`);
      return [...result];
    },
  }) as unknown as RpcProvider;

const healthy: SignerState = {
  get_guardian: ["0x0"],
  get_owner: [OWNER],
  get_owner_type: ["0x0"],
};

describe("argentSigningRestriction", () => {
  test("answers null for a clean current-release account", async () => {
    await expect(
      argentSigningRestriction(providerOf(ARGENT_ACCOUNT_CLASS_HASH, healthy), ACCOUNT),
    ).resolves.toBeNull();
  });

  test("names the guardian before anything else can be signed", async () => {
    await expect(
      argentSigningRestriction(
        providerOf(ARGENT_ACCOUNT_CLASS_HASH, { ...healthy, get_guardian: ["0x7601"] }),
        ACCOUNT,
      ),
    ).resolves.toBe("guardian");
  });

  test("names a rotated owner and an unsupported owner type", async () => {
    await expect(
      argentSigningRestriction(
        providerOf(ARGENT_ACCOUNT_CLASS_HASH, { ...healthy, get_owner: ["0xother"] }),
        ACCOUNT,
      ),
    ).resolves.toBe("owner-changed");
    await expect(
      argentSigningRestriction(
        providerOf(ARGENT_ACCOUNT_CLASS_HASH, { ...healthy, get_owner_type: ["0x2"] }),
        ACCOUNT,
      ),
    ).resolves.toBe("owner-type");
  });

  test("names a live release this wallet cannot authorize for, without signer reads", async () => {
    const argent030 = deploymentClasses("argent").find((entry) => entry.label === "argent 0.3.0");
    if (!argent030) throw new Error("argent 0.3.0 missing from the class table");
    // No signer state wired: the class verdict must come first, so a signer
    // read here would throw "unexpected read".
    await expect(argentSigningRestriction(providerOf(argent030.classHash), ACCOUNT)).resolves.toBe(
      "release",
    );
    await expect(argentSigningRestriction(providerOf("0x9999"), ACCOUNT)).resolves.toBe("release");
  });
});
