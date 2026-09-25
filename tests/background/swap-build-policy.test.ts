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
 * SHAPE: exactly one approval, on the sell token, for the quoted amount,
 * naming the PINNED AVNU router as spender, plus swap calls on that same
 * pinned router through its pinned entry point. What those calls may then DO —
 * the route calldata itself — is pinned next door in ./swap-route-binding.test.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  AGGREGATOR_CHOSEN_CONTRACT,
  ATTACKER_ADDRESS,
  account,
  approveRouter,
  ETH_TOKEN_ADDRESS,
  prepareSwap,
  ROUTER_ADDRESS,
  routeCall,
  SELL_AMOUNT,
  STRK_TOKEN_ADDRESS,
} from "../support/swap-policy-harness";

const SELL_AMOUNT_HEX = `0x${SELL_AMOUNT.toString(16)}`;

describe("swap build policy covers the whole call set", () => {
  test("the canonical approve-then-route build still prepares", async () => {
    const { response, submitted } = prepareSwap([approveRouter, routeCall]);
    const prepared = await response;
    expect(prepared).toMatchObject({ ok: true });
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
      error: "swap build called a contract that is not the avnu router",
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
        error: "swap build called an entrypoint that is not an avnu swap",
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
      error: "swap build called an entrypoint that is not an avnu swap",
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

  test("an additive allowance cannot masquerade as the reviewed exact approval", async () => {
    for (const entrypoint of ["increase_allowance", "increaseAllowance"]) {
      const { response, submitted } = prepareSwap([{ ...approveRouter, entrypoint }, routeCall]);
      await expect(response).resolves.toEqual({
        error: "swap build requested an additive token allowance",
      });
      expect(submitted).toHaveLength(0);
    }
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
});
