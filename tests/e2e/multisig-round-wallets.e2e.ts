/**
 * Offline check of the driver behind the mainnet multisig privacy round
 * (`bun run test:e2e:mainnet:multisig`). That round only runs on a funded
 * developer machine, so this keeps its two-wallet plumbing from rotting
 * unseen: two kept profiles onboard from their owner phrases, exchange
 * co-signer cards, agree on the multisig address, and one reopens unlocked on
 * its kept profile. Nothing here reaches a network, and the phrases come from
 * a published dummy key, so they guard nothing.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { readPanel } from "../mainnet/multisig/round-cosign";
import { roundMultisigAddress } from "../mainnet/multisig/round-multisig";
import { ownerPhrase } from "../mainnet/multisig/round-owners";
import {
  callWallet,
  closeOwnerWallets,
  type OwnerWallet,
  openOwnerWallet,
  saveCoOwner,
  tryWallet,
} from "../mainnet/multisig/round-wallets";

const DUMMY_FUNDING_KEY = `0x1${"d".repeat(62)}`;
const RPC_URL = "https://rpc.round.invalid/";
const SALT = `0x${"7".repeat(62)}`;

test("the round's two wallets onboard, exchange cards and reopen", async () => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), "bramble-round-"));
  const wallets: OwnerWallet[] = [];
  const open = (role: "a" | "b"): Promise<OwnerWallet> =>
    openOwnerWallet({
      directory,
      phrase: ownerPhrase(DUMMY_FUNDING_KEY, role),
      role,
      rpcUrl: RPC_URL,
    });
  try {
    wallets.push(await open("a"), await open("b"));
    const [a, b] = wallets as [OwnerWallet, OwnerWallet];
    expect(a.publicKeyX).not.toBe(b.publicKeyX);
    expect(a.nostrPublicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(b.nostrPublicKey).not.toBe(a.nostrPublicKey);

    await saveCoOwner(a, b);
    await saveCoOwner(b, a);
    // Saving the same card again is how a resumed round starts.
    await saveCoOwner(a, b);

    const address = roundMultisigAddress(a, b, SALT);
    expect(roundMultisigAddress(b, a, SALT)).toBe(address);
    expect(address).toMatch(/^0x[0-9a-f]{1,64}$/);

    // The reads the round polls answer in the shape it expects.
    const multisigId = `SN_MAIN:${address}`;
    const listed = await callWallet<{ readonly intents: unknown; readonly multisigs: unknown }>(
      a.page,
      { cached: true, type: "wallet.multisigs" },
    );
    expect(listed.multisigs).toEqual([]);
    expect(listed.intents).toEqual([]);
    expect(await readPanel(a, multisigId)).toMatchObject({
      authorizations: [],
      balances: [],
      relays: [],
    });
    // A multisig the wallet does not list is refused by name, not by a hang.
    const unknown = await tryWallet(a.page, {
      multisigId,
      type: "wallet.argentMultisigStrk20KeyStatus",
    });
    expect(unknown).toEqual({
      error: "wallet.argentMultisigStrk20KeyStatus: Argent multisig not found",
    });

    // A kept profile reopens on the same owner without onboarding again.
    await closeOwnerWallets([a]);
    const reopened = await open("a");
    wallets[0] = reopened;
    expect(reopened.publicKeyX).toBe(a.publicKeyX);
    expect(reopened.nostrPublicKey).toBe(a.nostrPublicKey);
  } finally {
    await closeOwnerWallets(wallets);
    await rm(directory, { force: true, recursive: true });
  }
});
