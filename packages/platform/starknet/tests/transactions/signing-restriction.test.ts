/** Advisory signability classification for recovery candidates (issue 542). */
import { describe, expect, test } from "bun:test";
import { argentSigningRestriction, braavosSigningRestriction } from "@bramble/starknet/rpc";
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

describe("braavosSigningRestriction", () => {
  const BRAAVOS_IMPL = "0x3957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a";
  const braavosProvider = (
    reads: Readonly<Record<string, readonly string[]>>,
    timestamp = 1_000,
    liveClass = BRAAVOS_IMPL,
  ): RpcProvider =>
    ({
      async getClassHashAt() {
        return liveClass;
      },
      async getBlock() {
        return { block_hash: "0xb", timestamp };
      },
      async callContract({ entrypoint }: { readonly entrypoint: string }) {
        const result = reads[entrypoint];
        if (!result) throw new Error(`unexpected read: ${entrypoint}`);
        return [...result];
      },
    }) as unknown as RpcProvider;
  const starkOnly = { get_signers: ["0x1", OWNER, "0x0", "0x0"] };
  const guarded = {
    get_deferred_remove_signers: ["0x0"],
    get_signers: ["0x1", OWNER, "0x1", "0xaa", "0x0"],
  };

  test("answers null for a stark-only account on a known release", async () => {
    await expect(
      braavosSigningRestriction(braavosProvider(starkOnly), ACCOUNT),
    ).resolves.toBeNull();
  });

  test("names the strong signer, and clears it once a removal request expired", async () => {
    await expect(braavosSigningRestriction(braavosProvider(guarded), ACCOUNT)).resolves.toBe(
      "strong-signer",
    );
    const expiring = { ...guarded, get_deferred_remove_signers: ["0x5"] };
    // Request expires at 5; at block time 1000 the account itself treats the
    // strong signers as removed, so the stark key signs.
    await expect(
      braavosSigningRestriction(braavosProvider(expiring, 1_000), ACCOUNT),
    ).resolves.toBeNull();
    await expect(braavosSigningRestriction(braavosProvider(expiring, 3), ACCOUNT)).resolves.toBe(
      "strong-signer",
    );
  });

  test("names a foreign stark key and an unknown live release", async () => {
    await expect(
      braavosSigningRestriction(
        braavosProvider({ get_signers: ["0x1", "0xdead", "0x0", "0x0"] }),
        ACCOUNT,
      ),
    ).resolves.toBe("owner-changed");
    await expect(
      braavosSigningRestriction(braavosProvider(starkOnly, 1_000, "0x9999"), ACCOUNT),
    ).resolves.toBe("release");
  });
});
