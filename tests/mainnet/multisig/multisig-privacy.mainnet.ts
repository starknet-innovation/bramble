/**
 * Opt-in mainnet round for STRK20 private balances on an Argent multisig.
 * One funded sncast account pays a 2-of-2 multisig co-owned by two wallets on
 * separate browser profiles. The multisig is deployed, shares its viewing key,
 * registers, deposits, transfers privately to itself and withdraws to the
 * funding account, with every signature collected between the two wallets over
 * Nostr. What is left is swept back to the funding account.
 */
import { randomBytes } from "node:crypto";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { expect, test } from "@playwright/test";
import { RpcProvider } from "starknet";
import { requireLocalMainnetAccount } from "../local-mainnet-account";
import { readProtocolFee } from "../strk20-pool-fee";
import {
  privateStrk,
  type RoundContext,
  sendAccountAction,
  sendRelayAction,
  settledPrivateStrk,
  sweepPublicStrk,
  waitForPrivateStrk,
} from "./round-actions";
import { depositDone, planRound, ROUND_LIMITS, resumeFunding } from "./round-budget";
import {
  fundFromAccount,
  isDeployed,
  isRegisteredInPool,
  publicStrk,
  strkLabel,
} from "./round-chain";
import { shareViewingKey } from "./round-cosign";
import { establishMultisig, roundMultisigAddress } from "./round-multisig";
import { ownerPhrase } from "./round-owners";
import { returnFunds, withdrawPrivateStrk } from "./round-return";
import {
  clearRound,
  ROUND_DIRECTORY,
  type RoundRecord,
  readRound,
  writeRound,
} from "./round-state";
import { closeOwnerWallets, type OwnerWallet, openOwnerWallet, saveCoOwner } from "./round-wallets";

const RESUME = "Run the command again from this checkout.";
const KEPT =
  "The round's directory was kept. Run the command again from this checkout to return what is left.";

// Refuses before anything is sent when the funding account cannot bring the
// multisig at `address` up to `target` and still pay for that transfer.
const requireFunds = async (
  startBalance: bigint,
  target: bigint,
  address: string,
  rpcUrl: string,
): Promise<void> => {
  const held = await publicStrk(rpcUrl, address);
  const needed = (target > held ? target - held : 0n) + ROUND_LIMITS.maxTransferFee;
  if (startBalance < needed) {
    throw new Error(
      `The funding account holds ${strkLabel(startBalance)} STRK; this round needs ${strkLabel(needed)}. Nothing was sent.`,
    );
  }
};

// What the round did to the funding account. A resumed round can send
// nothing and still withdraw, so it may come out ahead.
const roundOutcome = (startBalance: bigint, endBalance: bigint): string =>
  endBalance > startBalance
    ? `The funding account got back ${strkLabel(endBalance - startBalance)} STRK more than it sent.`
    : `Round cost ${strkLabel(startBalance - endBalance)} STRK.`;

// A balance read right after a receipt can come from a node that has not seen
// that block yet, so balance checks poll until the transaction shows.
const SETTLED = { intervals: [2_000, 4_000, 8_000], timeout: 90_000 };

const freshSalt = (): string => {
  const salt = canonicalFelt(`0x${randomBytes(31).toString("hex")}`);
  if (salt === null || BigInt(salt) === 0n) {
    throw new Error("Could not draw a multisig salt.");
  }
  return salt;
};

const nostrRelayOverride = (): string | undefined =>
  process.env["BRAMBLE_MAINNET_MULTISIG_NOSTR_RELAY"] || undefined;

test("an Argent multisig uses private balances and returns its funds", async () => {
  const account = await requireLocalMainnetAccount();
  const rpcUrl = account.rpcUrl;
  const plan = planRound(await readProtocolFee(new RpcProvider({ nodeUrl: rpcUrl })));
  const startBalance = await publicStrk(rpcUrl, account.address);

  const stored = await readRound(ROUND_DIRECTORY);
  if (stored.kind === "damaged") {
    throw new Error(
      `${ROUND_DIRECTORY}/round.json cannot be read. It may name a funded multisig, so nothing was started.`,
    );
  }
  let record: RoundRecord =
    stored.kind === "kept" ? stored.record : { salt: freshSalt(), version: 1 };
  if (stored.kind === "none") {
    await writeRound(ROUND_DIRECTORY, record);
  }

  const wallets: OwnerWallet[] = [];
  const relay = nostrRelayOverride();
  let context: RoundContext | null = null;
  let actionCost: bigint | null = null;
  let clearWhenClosed = false;
  try {
    for (const role of ["a", "b"] as const) {
      wallets.push(
        await openOwnerWallet({
          directory: ROUND_DIRECTORY,
          phrase: ownerPhrase(account.privateKey, role),
          role,
          rpcUrl,
          ...(relay ? { nostrRelayUrl: relay } : {}),
        }),
      );
    }
    const [a, b] = wallets as [OwnerWallet, OwnerWallet];
    await saveCoOwner(a, b);
    await saveCoOwner(b, a);

    const address = roundMultisigAddress(a, b, record.salt);
    if (record.multisigAddress !== undefined && record.multisigAddress !== address) {
      throw new Error("The kept round names a different multisig than these owners derive.");
    }
    // A kept round resumes where it stopped. A multisig an earlier run
    // deployed is listed first with nothing sent, then funded for what it has
    // left to do; an undeployed address is funded for the whole round.
    const deployedBefore = await isDeployed(rpcUrl, address);
    if (!deployedBefore) await requireFunds(startBalance, plan.funding, address, rpcUrl);
    record = { ...record, multisigAddress: address };
    await writeRound(ROUND_DIRECTORY, record);

    const round = await test.step("Fund and deploy the multisig", () =>
      establishMultisig({
        a,
        account,
        address,
        b,
        funding: deployedBefore ? 0n : plan.funding,
        salt: record.salt,
      }));
    context = round;
    const { multisigId } = round;

    await test.step("Share the viewing key with the co-owner", () =>
      shareViewingKey(a, b, multisigId));

    const registered = await isRegisteredInPool(rpcUrl, address);
    const progress = {
      privateBalance: registered ? await settledPrivateStrk(a, multisigId) : 0n,
      registered,
    };
    if (deployedBefore) {
      const target = resumeFunding(plan, progress);
      await requireFunds(startBalance, target, address, rpcUrl);
      const held = await publicStrk(rpcUrl, address);
      if (held < target) await fundFromAccount(account, address, target - held);
    }

    await test.step("Register the multisig with the pool", async () => {
      // A kept round that registered already paid the pool for it.
      if (registered) return;
      await sendAccountAction(round, { kind: "register" });
      expect(await isRegisteredInPool(rpcUrl, address)).toBe(true);
    });

    const deposited = await test.step("Deposit STRK", async () => {
      // A kept round whose deposit is in carries on from its private balance.
      if (depositDone(plan, progress)) return progress.privateBalance;
      const publicBefore = await publicStrk(rpcUrl, address);
      await sendAccountAction(round, { amount: plan.deposit, kind: "deposit" });
      await expect
        .poll(() => publicStrk(rpcUrl, address), SETTLED)
        .toBeLessThanOrEqual(publicBefore - plan.deposit);
      const floor = plan.deposit - plan.poolFee;
      const seenByA = await waitForPrivateStrk(a, multisigId, (balance) => balance >= floor);
      // The co-owner reads the same balance with the key it was sent.
      await waitForPrivateStrk(b, multisigId, (balance) => balance === seenByA);
      return seenByA;
    });

    const afterTransfer = await test.step("Transfer privately to the multisig itself", async () => {
      await sendRelayAction(round, {
        amount: plan.transferAmount,
        kind: "transfer",
        recipient: address,
      });
      await waitForPrivateStrk(a, multisigId, (seen) => seen < deposited);
      // The transferred note comes back to the multisig; wait for it too.
      const balance = await settledPrivateStrk(a, multisigId);
      actionCost = deposited - balance;
      expect(actionCost).toBeGreaterThan(0n);
      expect(actionCost).toBeLessThanOrEqual(
        plan.poolFee + ROUND_LIMITS.relayReserve + plan.transferAmount,
      );
      return balance;
    });

    await test.step("Withdraw to the funding account", async () => {
      const before = await publicStrk(rpcUrl, account.address);
      const withdrawn = await withdrawPrivateStrk(round, account.address, plan.poolFee, actionCost);
      expect(withdrawn).not.toBeNull();
      await expect
        .poll(() => publicStrk(rpcUrl, account.address), SETTLED)
        .toBe(before + (withdrawn ?? 0n));
      await waitForPrivateStrk(a, multisigId, (seen) => seen < afterTransfer);
    });

    await test.step("Sweep the multisig's public STRK back", async () => {
      const before = await publicStrk(rpcUrl, account.address);
      const swept = await sweepPublicStrk(round, account.address);
      // Nothing to sweep is a pass when what is left is only the fee margin a
      // sweep keeps back, as after a resumed round that sent no public STRK.
      if (swept === null) {
        expect(await publicStrk(rpcUrl, address)).toBeLessThanOrEqual(
          2n * ROUND_LIMITS.maxTransferFee,
        );
        return;
      }
      await expect
        .poll(() => publicStrk(rpcUrl, account.address), SETTLED)
        .toBe(before + swept.amount);
    });

    const endBalance = await publicStrk(rpcUrl, account.address);
    const leftPublic = await publicStrk(rpcUrl, address);
    const leftPrivate = await privateStrk(a, multisigId);
    console.log(
      `${roundOutcome(startBalance, endBalance)} Left in the multisig: ${strkLabel(leftPublic)} public, ${strkLabel(leftPrivate)} private.`,
    );
    expect(leftPublic).toBeLessThanOrEqual(2n * ROUND_LIMITS.maxTransferFee);
    // The funding account can lose at most what it sent, plus its own fee.
    expect(startBalance - endBalance).toBeLessThanOrEqual(
      plan.funding + ROUND_LIMITS.maxTransferFee,
    );
    clearWhenClosed = true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The round failed.";
    if (context === null) {
      throw new Error(`${reason}\n${KEPT}`);
    }
    // The round failed with a deployed multisig. Send back what it holds now.
    // A registered multisig is kept, so the next run resumes it instead of
    // paying the pool to register a new one; any other is cleared once its
    // funds are back. If returning fails, the next run retries it.
    let outcome: string;
    try {
      const returned = await returnFunds(context, account.address, plan.poolFee, actionCost);
      const registered = await isRegisteredInPool(rpcUrl, context.multisigAddress);
      if (!registered) clearWhenClosed = true;
      outcome = `Funds were returned: ${strkLabel(returned.withdrawn ?? 0n)} STRK withdrawn, ${strkLabel(returned.swept ?? 0n)} STRK swept.${registered ? ` The registered multisig was kept; the next run resumes it. ${RESUME}` : ""}`;
    } catch (returnError) {
      const detail = returnError instanceof Error ? returnError.message : "unknown";
      outcome = `Returning the funds failed too (${detail}). ${KEPT}`;
    }
    throw new Error(`${reason}\n${outcome}`);
  } finally {
    await closeOwnerWallets(wallets);
    // Only once the browsers are closed: Chromium writes its profile back as
    // it shuts down, which would leave part of a cleared round behind.
    if (clearWhenClosed) await clearRound(ROUND_DIRECTORY);
  }
});
