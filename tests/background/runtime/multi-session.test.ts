/**
 * Multi-session isolation: two dapp origins hold independent account grants and
 * receive independent provider events. Grants are read per origin through the
 * background handler; page events are derived per origin through pageEventsFor,
 * so one site never sees another site's accounts or connection state.
 */
import { describe, expect, test } from "bun:test";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  accountsChangedEvent,
  networkChangedEvent,
  pageEventsFor,
} from "@bramble/wallet-protocol/events";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";

const ORIGIN_A = "https://a.test";
const ORIGIN_B = "https://b.test";
const CHAIN_ID = "0x534e5f4d41494e";

const accountA: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x0a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a",
  classHash: "0xabcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:a",
  networkId: "SN_MAIN",
  publicKeyX: "0xa1",
  publicKeyY: "0xa2",
};
const accountB: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x0b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b",
  classHash: "0xabcdef",
  derivation: { accountIndex: 1, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:b",
  networkId: "SN_MAIN",
  publicKeyX: "0xb1",
  publicKeyY: "0xb2",
};

const grantsByOrigin: Readonly<Record<string, readonly AccountRef[]>> = {
  [ORIGIN_A]: [accountA],
  [ORIGIN_B]: [accountB],
};

const senderFor = (origin: string): RuntimeSender => ({ id: "extension-id", url: `${origin}/app` });

const wallet = {
  async addDerivedAccount() {
    return accountA;
  },
  async createAccount() {
    return accountA;
  },
  async ensureNetworkAccount() {
    return accountA;
  },
  async getGrantedAccounts(origin: string) {
    return grantsByOrigin[origin] ?? [];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    return [accountA];
  },
  async readVault() {
    throw new Error("unused");
  },
  async setActiveAccount() {
    return accountA;
  },
  async signHash() {
    return { publicKey: "0xa1", r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 2,
      activeAccountId: accountA.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
};

const makeHandler = () => {
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  return createMessageHandler(wallet, "extension-id", { session });
};

describe("multi-session grants", () => {
  test("each origin reads only its own granted accounts", async () => {
    const handler = makeHandler();

    await expect(
      handler({ origin: ORIGIN_A, type: "wallet.getGrantedAccounts" }, senderFor(ORIGIN_A)),
    ).resolves.toEqual({ accounts: [accountA], ok: true });
    await expect(
      handler({ origin: ORIGIN_B, type: "wallet.getGrantedAccounts" }, senderFor(ORIGIN_B)),
    ).resolves.toEqual({ accounts: [accountB], ok: true });
  });

  test("an origin cannot read another origin's grant", async () => {
    const handler = makeHandler();

    await expect(
      handler({ origin: ORIGIN_B, type: "wallet.getGrantedAccounts" }, senderFor(ORIGIN_A)),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("permissions reflect each origin's grant independently", async () => {
    const handler = makeHandler();

    await expect(
      handler({ origin: ORIGIN_A, type: "wallet.getPermissions" }, senderFor(ORIGIN_A)),
    ).resolves.toEqual({ ok: true, permissions: ["accounts"] });
    await expect(
      handler(
        { origin: "https://c.test", type: "wallet.getPermissions" },
        senderFor("https://c.test"),
      ),
    ).resolves.toEqual({ ok: true, permissions: [] });
  });
});

describe("multi-session events", () => {
  const networkMessage = {
    chainId: CHAIN_ID,
    event: "networkChanged",
    type: "wallet.event",
  } as const;
  const accountsMessage = { event: "accountsChanged", type: "wallet.event" } as const;

  test("a network change reaches each connected origin with its own accounts", () => {
    expect(
      pageEventsFor({
        addresses: [accountA.address],
        lastAddresses: null,
        message: networkMessage,
      }),
    ).toEqual([networkChangedEvent(CHAIN_ID), accountsChangedEvent([accountA.address])]);
    expect(
      pageEventsFor({
        addresses: [accountB.address],
        lastAddresses: null,
        message: networkMessage,
      }),
    ).toEqual([networkChangedEvent(CHAIN_ID), accountsChangedEvent([accountB.address])]);
  });

  test("an unconnected origin receives no network or account events", () => {
    expect(pageEventsFor({ addresses: [], lastAddresses: null, message: networkMessage })).toEqual(
      [],
    );
  });

  test("account changes are computed per origin from that origin's history", () => {
    expect(
      pageEventsFor({
        addresses: [accountA.address],
        lastAddresses: [accountA.address],
        message: accountsMessage,
      }),
    ).toEqual([]);
    expect(
      pageEventsFor({ addresses: [accountB.address], lastAddresses: [], message: accountsMessage }),
    ).toEqual([accountsChangedEvent([accountB.address])]);
  });
});
