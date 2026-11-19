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
import { planRound, ROUND_LIMITS } from "./round-budget";
import { isRegisteredInPool, publicStrk, strkLabel } from "./round-chain";
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
    // A kept round resumes where it stopped: funded, deployed, or registered.
    // Only what its address still lacks has to come from the funding account.
    const held = await publicStrk(rpcUrl, address);
    const needed = (plan.funding > held ? plan.funding - held : 0n) + ROUND_LIMITS.maxTransferFee;
    if (startBalance < needed) {
      throw new Error(
        `The funding account holds ${strkLabel(startBalance)} STRK; this round needs ${strkLabel(needed)}. Nothing was sent.`,
      );
    }
    record = { ...record, multisigAddress: address };
    await writeRound(ROUND_DIRECTORY, record);

    const round = await test.step("Fund and deploy the multisig", () =>
      establishMultisig({ a, account, address, b, funding: plan.funding, salt: record.salt }));
    context = round;
    const { multisigId } = round;

    await test.step("Share the viewing key with the co-owner", () =>
      shareViewingKey(a, b, multisigId));

    await test.step("Register the multisig with the pool", async () => {
      // A kept round that registered already paid the pool for it.
      if (await isRegisteredInPool(rpcUrl, address)) return;
      await sendAccountAction(round, { kind: "register" });
      expect(await isRegisteredInPool(rpcUrl, address)).toBe(true);
    });

    const deposited = await test.step("Deposit STRK", async () => {
      const publicBefore = await publicStrk(rpcUrl, address);
      await sendAccountAction(round, { amount: plan.deposit, kind: "deposit" });
      expect(await publicStrk(rpcUrl, address)).toBeLessThanOrEqual(publicBefore - plan.deposit);
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
      expect(await publicStrk(rpcUrl, account.address)).toBe(before + (withdrawn ?? 0n));
      await waitForPrivateStrk(a, multisigId, (seen) => seen < afterTransfer);
    });

    await test.step("Sweep the multisig's public STRK back", async () => {
      const before = await publicStrk(rpcUrl, account.address);
      const swept = await sweepPublicStrk(round, account.address);
      expect(swept).not.toBeNull();
      expect(await publicStrk(rpcUrl, account.address)).toBe(before + (swept?.amount ?? 0n));
    });

    const endBalance = await publicStrk(rpcUrl, account.address);
    const leftPublic = await publicStrk(rpcUrl, address);
    const leftPrivate = await privateStrk(a, multisigId);
    console.log(
      `Round cost ${strkLabel(startBalance - endBalance)} STRK. Left in the multisig: ${strkLabel(leftPublic)} public, ${strkLabel(leftPrivate)} private.`,
    );
    expect(leftPublic).toBeLessThanOrEqual(2n * ROUND_LIMITS.maxTransferFee);
    // The funding account can lose at most what it sent, plus its own fee.
    expect(startBalance - endBalance).toBeLessThanOrEqual(
      plan.funding + ROUND_LIMITS.maxTransferFee,
    );
    await clearRound(ROUND_DIRECTORY);
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
      if (!registered) await clearRound(ROUND_DIRECTORY);
      outcome = `Funds were returned: ${strkLabel(returned.withdrawn ?? 0n)} STRK withdrawn, ${strkLabel(returned.swept ?? 0n)} STRK swept.${registered ? ` The registered multisig was kept; the next run resumes it. ${RESUME}` : ""}`;
    } catch (returnError) {
      const detail = returnError instanceof Error ? returnError.message : "unknown";
      outcome = `Returning the funds failed too (${detail}). ${KEPT}`;
    }
    throw new Error(`${reason}\n${outcome}`);
  } finally {
    await closeOwnerWallets(wallets);
  }
});
