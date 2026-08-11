/**
 * MCW-V09-103: the AVNU build-output policy is judged over the COMPLETE call
 * set, against a counterparty the WALLET pinned.
 *
 * The aggregator is untrusted infrastructure. The wallet asks it for one swap
 * of one exact amount and then executes whatever it returns, so a policy that
 * constrained only `approve` selectors let a hostile or compromised aggregator
 * append arbitrary calls — a direct transfer, a call on the user's own account
 * contract — that reached the confirm screen as one more unannotated summary
 * line. Requiring only that the build be internally consistent (every call on
 * the contract the approval happens to name) does not close it either: the
 * aggregator picks both sides of that equality, so it still reaches an
 * arbitrary contract with an arbitrary selector. These tests pin the admitted
 * shape: exactly one approval, on the sell token, for the quoted amount,
 * naming the PINNED AVNU router as spender, with every remaining call running
 * on that same pinned router through one of its swap entry points. Anything
 * else is rejected before a preparation is frozen; an admitted build carrying
 * more swap calls than the one reviewed is flagged so the receipt annotates it.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../src/background/messages";
import type { RuntimeSender } from "../../src/background/senders";
import { createUnlockSession } from "../../src/background/session";
import { avnuRouterAddress, type SwapCall, type SwapService } from "../../src/starknet/avnu";
import { DEFAULT_TOKENS, STARKNET_NETWORKS } from "../../src/starknet/networks";
import { createActivityLog } from "../../src/storage/activity-store";
import { createMemoryStore } from "../../src/storage/kv";
import type { AccountRef, Vault } from "../../src/storage/vault-schema";

const mainnetToken = (symbol: string): string =>
  DEFAULT_TOKENS.find((token) => token.networkId === "SN_MAIN" && token.symbol === symbol)
    ?.address ?? "";
const ETH_TOKEN_ADDRESS = mainnetToken("ETH");
const STRK_TOKEN_ADDRESS = mainnetToken("STRK");

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const vaultPassphrase = "correct horse battery staple";
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const sellTokenId = `SN_MAIN:ETH:${ETH_TOKEN_ADDRESS}`;
const buyTokenId = `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`;
const QUOTE_ID = "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca";

// 0.01 ETH in wei — the exact amount the quote below sells and the only
// allowance the policy admits.
const SELL_AMOUNT_HEX = `0x${(10n ** 16n).toString(16)}`;
const BUY_AMOUNT_HEX = `0x${(125n * 10n ** 17n).toString(16)}`;
// The pinned mainnet counterparty, read from the wallet-side pin rather than
// restated: a fixture that carried its own address would keep passing after a
// pin change while every real build started failing.
const ROUTER_ADDRESS = avnuRouterAddress("SN_MAIN");
const ATTACKER_ADDRESS = "0x6666666666666666666666666666666666666666666666666666666666666";
// Stands in for any contract the aggregator might name instead of the router —
// an NFT collection the victim holds, a lending pool they have a position in.
const AGGREGATOR_CHOSEN_CONTRACT =
  "0x7777777777777777777777777777777777777777777777777777777777777";

const approveRouter: SwapCall = {
  calldata: [ROUTER_ADDRESS, SELL_AMOUNT_HEX, "0x0"],
  contractAddress: ETH_TOKEN_ADDRESS,
  entrypoint: "approve",
};
const routeCall: SwapCall = {
  calldata: ["0x3"],
  contractAddress: ROUTER_ADDRESS,
  entrypoint: "multi_route_swap",
};

const walletStub = {
  async createAccount() {
    return account;
  },
  async addDerivedAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return vault;
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: false,
    };
  },
};

const makeHarness = (build: readonly SwapCall[]) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  let tick = 0;
  const activity = createActivityLog({
    now: () => {
      tick += 1000;
      return tick;
    },
    store: createMemoryStore(),
  });
  const submitted: unknown[] = [];
  const swap: SwapService = {
    async listTokens() {
      return [];
    },
    async buildCalls() {
      return { calls: build, chainId: STARKNET_NETWORKS.SN_MAIN.chainId };
    },
    async getQuote(input) {
      return {
        buyAmount: BUY_AMOUNT_HEX,
        buyAmountInUsd: 18.8,
        buyTokenAddress: STRK_TOKEN_ADDRESS,
        gasFeesInUsd: 0.025,
        quoteId: QUOTE_ID,
        sellAmount: input.sellAmount,
        sellAmountInUsd: 18.79,
        sellTokenAddress: ETH_TOKEN_ADDRESS,
      };
    },
  };
  const handler = createMessageHandler(walletStub, "extension-id", {
    activity,
    runtimeRpc: {
      async submitInvokeTransaction({ calls }: { readonly calls: readonly unknown[] }) {
        submitted.push(calls);
        return { calls: [], transactionHash: "0x5aa9" };
      },
    } as never,
    session,
    swap,
  });
  return { handler, submitted };
};

const prepareSwap = (build: readonly SwapCall[]) => {
  const { handler, submitted } = makeHarness(build);
  return {
    response: handler(
      {
        amount: "0.01",
        buyAmount: "12.5",
        buyTokenId,
        quoteId: QUOTE_ID,
        sellTokenId,
        type: "wallet.swapPrepare",
      },
      extensionSender,
    ),
    submitted,
  };
};

describe("swap build policy covers the whole call set", () => {
  test("the canonical approve-then-route build still prepares", async () => {
    const { response, submitted } = prepareSwap([approveRouter, routeCall]);
    const prepared = await response;
    expect(prepared).toMatchObject({ ok: true });
    const flags = "swapPreparation" in prepared ? prepared.swapPreparation.flags : [];
    expect(flags.some((flag) => flag.code === "swap-extra-calls")).toBe(false);
    expect(submitted).toHaveLength(0);
  });

  test("the pinned mainnet counterparty is AVNU's published exchange contract", () => {
    // The pin IS the control: with it the aggregator picks the route's
    // internals, without it the aggregator picks who this account transacts
    // with. Restating the audited address here makes an edit to it a visible,
    // reviewed change rather than a silent one.
    expect(ROUTER_ADDRESS).toBe(
      "0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f",
    );
  });

  test("a call injected on a contract the approval does not name is rejected unsigned", async () => {
    const { response, submitted } = prepareSwap([
      approveRouter,
      routeCall,
      { calldata: ["0x1"], contractAddress: ATTACKER_ADDRESS, entrypoint: "drain" },
    ]);
    await expect(response).resolves.toEqual({
      error: "swap build called a contract that is not the AVNU router",
    });
    expect(submitted).toHaveLength(0);
  });

  // The attack an internally-consistent policy admits: the aggregator names its
  // own contract as spender and then calls it, so "the approval covers every
  // call" holds while the selector is anything it likes. Here that is blanket
  // operator rights over an NFT collection, from a transaction the user
  // believes is a 0.01 ETH swap.
  test("an aggregator-chosen spender is rejected even when every call agrees with it", async () => {
    const { response, submitted } = prepareSwap([
      {
        calldata: [AGGREGATOR_CHOSEN_CONTRACT, SELL_AMOUNT_HEX, "0x0"],
        contractAddress: ETH_TOKEN_ADDRESS,
        entrypoint: "approve",
      },
      {
        calldata: [ATTACKER_ADDRESS, "0x1"],
        contractAddress: AGGREGATOR_CHOSEN_CONTRACT,
        entrypoint: "set_approval_for_all",
      },
    ]);
    await expect(response).resolves.toEqual({
      error: "swap build approved an unexpected spender",
    });
    expect(submitted).toHaveLength(0);
  });

  // Same shape, but pointed at a token the wallet TRACKS: every risk flag the
  // verifier could have raised stays silent (the contract is known, and there
  // is only one route call), so the confirm receipt read completely clean. The
  // policy, not the flag list, has to be what stops this.
  test("a tracked non-sell token named as spender is rejected before any receipt", async () => {
    const { response, submitted } = prepareSwap([
      {
        calldata: [STRK_TOKEN_ADDRESS, SELL_AMOUNT_HEX, "0x0"],
        contractAddress: ETH_TOKEN_ADDRESS,
        entrypoint: "approve",
      },
      { calldata: ["0x1", "0x0"], contractAddress: STRK_TOKEN_ADDRESS, entrypoint: "burn" },
    ]);
    await expect(response).resolves.toEqual({
      error: "swap build approved an unexpected spender",
    });
    expect(submitted).toHaveLength(0);
  });

  // The pinned router is not a blank cheque either: only the swap entry points
  // it exposes are admitted. An opaque selector on the right contract is still
  // an arbitrary call rendered as "Call <selector> on 0x…".
  test("a non-swap entrypoint on the pinned router is rejected unsigned", async () => {
    for (const entrypoint of ["set_approval_for_all", "upgrade", "collect_fees"]) {
      const { response, submitted } = prepareSwap([
        approveRouter,
        { calldata: ["0x1"], contractAddress: ROUTER_ADDRESS, entrypoint },
      ]);
      await expect(response).resolves.toEqual({
        error: "swap build called an entrypoint that is not an AVNU swap",
      });
      expect(submitted).toHaveLength(0);
    }
  });

  // The transfer gate is decode-shape dependent: the verifier only decodes a
  // transfer whose calldata carries an amount, so a two-felt `transfer` reads
  // as "unknown" and walks past it. It is defence in depth behind the
  // entrypoint allowlist, never the thing standing between the two.
  test("a transfer the verifier cannot decode is still rejected by the allowlist", async () => {
    const { response, submitted } = prepareSwap([
      approveRouter,
      {
        calldata: [ATTACKER_ADDRESS, SELL_AMOUNT_HEX],
        contractAddress: ROUTER_ADDRESS,
        entrypoint: "transfer",
      },
    ]);
    await expect(response).resolves.toEqual({
      error: "swap build called an entrypoint that is not an AVNU swap",
    });
    expect(submitted).toHaveLength(0);
  });

  test("a build with more calls than the wallet reviews is rejected on the cap", async () => {
    const { response, submitted } = prepareSwap([
      approveRouter,
      routeCall,
      routeCall,
      routeCall,
      routeCall,
    ]);
    await expect(response).resolves.toEqual({ error: "swap build returned too many calls" });
    expect(submitted).toHaveLength(0);
  });

  // Two individually acceptable approvals are not an acceptable build: the
  // reviewed spend is one allowance, and a second one doubles what the route
  // can pull while every per-call check still passes.
  test("a second approval on the sell token is rejected unsigned", async () => {
    const { response, submitted } = prepareSwap([approveRouter, approveRouter, routeCall]);
    await expect(response).resolves.toEqual({
      error: "swap build returned multiple token approvals",
    });
    expect(submitted).toHaveLength(0);
  });

  // MCW-V09-130: the gate reads the approval's uint256 through the one shared
  // limb join. A malformed limb has to become this refusal — not a thrown
  // BigInt SyntaxError out of the handler, and above all not a zero that the
  // amount comparison then judges. The join is the same one the allowance
  // decoder and the reviewer use, so all three agree on what was approved.
  test("an approval with a limb that is not a felt is refused, not misread", async () => {
    for (const calldata of [
      [ROUTER_ADDRESS, "not-a-felt", "0x0"],
      [ROUTER_ADDRESS, "", "0x0"],
      [ROUTER_ADDRESS, SELL_AMOUNT_HEX, ""],
    ]) {
      const { response, submitted } = prepareSwap([
        { calldata, contractAddress: ETH_TOKEN_ADDRESS, entrypoint: "approve" },
        routeCall,
      ]);
      await expect(response).resolves.toEqual({
        error: "swap build requested an unexpected token allowance",
      });
      expect(submitted).toHaveLength(0);
    }
  });

  // An approval with nothing to spend it is not a swap; admitting it would
  // leave a standing allowance behind for a route that never ran.
  test("an approve-only build is rejected unsigned", async () => {
    const { response, submitted } = prepareSwap([approveRouter]);
    await expect(response).resolves.toEqual({ error: "swap build returned no swap call" });
    expect(submitted).toHaveLength(0);
  });

  // A route never moves the user's tokens itself — the approved contract pulls
  // them. Both placements a hostile build could use for a direct transfer (on
  // the sell token, or smuggled onto the very contract the user approved) are
  // rejected on the decoded call kind, so every transfer spelling the verifier
  // knows is covered without this gate keeping a second list.
  test("a direct transfer injected into the build is rejected unsigned", async () => {
    for (const contractAddress of [ETH_TOKEN_ADDRESS, ROUTER_ADDRESS]) {
      const { response, submitted } = prepareSwap([
        approveRouter,
        routeCall,
        {
          calldata: [ATTACKER_ADDRESS, SELL_AMOUNT_HEX, "0x0"],
          contractAddress,
          entrypoint: "transfer",
        },
      ]);
      await expect(response).resolves.toEqual({
        error: "swap build requested a direct token transfer",
      });
      expect(submitted).toHaveLength(0);
    }
  });

  test("a build with no approval has no reviewable spend boundary and is rejected", async () => {
    const { response, submitted } = prepareSwap([routeCall]);
    await expect(response).resolves.toEqual({
      error: "swap build omitted the sell token approval",
    });
    expect(submitted).toHaveLength(0);
  });

  test("an approval naming this account as spender is rejected before any account call", async () => {
    const { response, submitted } = prepareSwap([
      {
        calldata: [account.address, SELL_AMOUNT_HEX, "0x0"],
        contractAddress: ETH_TOKEN_ADDRESS,
        entrypoint: "approve",
      },
      { calldata: ["0x9"], contractAddress: account.address, entrypoint: "set_public_key" },
    ]);
    await expect(response).resolves.toEqual({
      error: "swap build approved an unexpected spender",
    });
    expect(submitted).toHaveLength(0);
  });

  // Everything that survives the allowlist is a swap on the pinned router, so
  // the residual risk is no longer "an unexplained call" but "more swaps than
  // the one reviewed" — and that is what the flag now counts.
  test("a second swap call beyond the reviewed one is admitted but flagged", async () => {
    const { response } = prepareSwap([
      approveRouter,
      routeCall,
      { calldata: ["0x4"], contractAddress: ROUTER_ADDRESS, entrypoint: "swap_exact_token_to" },
    ]);
    const prepared = await response;
    expect(prepared).toMatchObject({ ok: true });
    const flags = "swapPreparation" in prepared ? prepared.swapPreparation.flags : [];
    expect(flags).toContainEqual({
      code: "swap-extra-calls",
      message:
        "This build runs 1 swap call beyond the single swap you reviewed. Confirm only if you expect the extra steps.",
    });
  });
});
