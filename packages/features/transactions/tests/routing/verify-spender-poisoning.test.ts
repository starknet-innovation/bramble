/**
 * Address poisoning on the SPENDER of a grant: an allowance, an NFT approval,
 * or a collection-wide operator grant whose authorized address mimics a saved
 * contact or one of the user's own accounts is refused exactly like a poisoned
 * payee. A grant that only takes reach away (a known-token `approve(_, 0)`, an
 * operator `false`) is exempt so a past poisoned grant can still be revoked.
 * The payee-only rules (self-send, token-contract recipient) stay payee-only.
 */
import { describe, expect, test } from "bun:test";
import { refuseOnPoisonedRecipient, verifyCalls } from "@bramble/transactions/verify";
import { spenderFeltIndex } from "@bramble/transactions/verify-selectors";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { AddressBookEntry, TokenConfig } from "@bramble/wallet-model/preferences";
import type { Call } from "starknet";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const NFT = "0x0511a2b3c4d5e6f7a8b9c0d1e2f30411223344556677889900aabbccddeeff00";
const UNKNOWN = "0x0456000000000000000000000000000000000000000000000000000000000456";
const ROUTER = "0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f";

const account: Pick<AccountRef, "address" | "networkId"> = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
};
const contact: AddressBookEntry = {
  address: "0x777aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc",
  id: "SN_MAIN:0x777aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc",
  label: "Ada",
  networkId: "SN_MAIN",
};
const tokens: readonly TokenConfig[] = [
  {
    address: ETH,
    decimals: 18,
    id: `SN_MAIN:ETH:${ETH}`,
    name: "Ether",
    networkId: "SN_MAIN",
    symbol: "ETH",
  },
];
const context = { account, addressBook: [contact], nftContracts: [NFT], tokens };

// Same visible `0x` + four and last four as the contact / the account.
const CONTACT_TWIN = `0x777a${"9".repeat(55)}bbcc`;
const ACCOUNT_TWIN = `0x1234${"0".repeat(54)}bcde`;
const SPENDER_SENTENCE =
  "The address this allows closely mimics an address you saved or paid but is a different account. Re-check every character before approving.";

const call = (contractAddress: string, entrypoint: string, calldata: string[]): Call => ({
  calldata,
  contractAddress,
  entrypoint,
});
const codes = (calls: Call[]) => verifyCalls(calls, context).flags.map((flag) => flag.code);
const refused = (calls: Call[]) => refuseOnPoisonedRecipient(verifyCalls(calls, context));

describe("spenderFeltIndex", () => {
  test("reads felt zero for every grant spelling and nothing else", () => {
    for (const entrypoint of [
      "approve",
      "increase_allowance",
      "increaseAllowance",
      "set_approval_for_all",
      "setApprovalForAll",
    ]) {
      expect(spenderFeltIndex(entrypoint)).toBe(0);
    }
    for (const entrypoint of ["transfer", "decrease_allowance", "Approve", "transfer_from"]) {
      expect(spenderFeltIndex(entrypoint)).toBeNull();
    }
  });
});

describe("a lookalike spender is refused", () => {
  test("ERC20 approve, hex and decimal calldata, with the spender sentence", () => {
    for (const spender of [CONTACT_TWIN, BigInt(CONTACT_TWIN).toString()]) {
      expect(refused([call(ETH, "approve", [spender, "100", "0"])])).toEqual({
        error: SPENDER_SENTENCE,
      });
    }
  });

  test("both increase_allowance spellings, including an increase by zero", () => {
    for (const entrypoint of ["increase_allowance", "increaseAllowance"]) {
      expect(refused([call(ETH, entrypoint, [CONTACT_TWIN, "5", "0"])])).not.toBeNull();
      expect(refused([call(ETH, entrypoint, [CONTACT_TWIN, "0", "0"])])).not.toBeNull();
    }
  });

  test("a twin of the user's own account", () => {
    expect(codes([call(ETH, "approve", [ACCOUNT_TWIN, "1", "0"])])).toContain("address-poisoning");
  });

  test("ERC721 approve, including token id zero", () => {
    expect(refused([call(NFT, "approve", [CONTACT_TWIN, "7", "0"])])).not.toBeNull();
    expect(refused([call(NFT, "approve", [CONTACT_TWIN, "0", "0"])])).not.toBeNull();
  });

  test("set_approval_for_all in both spellings", () => {
    for (const entrypoint of ["set_approval_for_all", "setApprovalForAll"]) {
      expect(refused([call(NFT, entrypoint, [CONTACT_TWIN, "1"])])).not.toBeNull();
    }
  });

  test("a zero approve on a contract that is not a tracked token (may be ERC721 id 0)", () => {
    expect(refused([call(UNKNOWN, "approve", [CONTACT_TWIN, "0", "0"])])).not.toBeNull();
  });

  test("a span the decoder cannot describe is still checked", () => {
    expect(refused([call(ETH, "approve", [CONTACT_TWIN, "1", "0", "0"])])).not.toBeNull();
    expect(refused([call(NFT, "set_approval_for_all", [CONTACT_TWIN])])).not.toBeNull();
  });

  test("a lookalike grant inside a multicall refuses the whole transaction", () => {
    const report = verifyCalls(
      [call(ETH, "approve", [ROUTER, "1", "0"]), call(ETH, "approve", [CONTACT_TWIN, "1", "0"])],
      context,
    );
    expect(refuseOnPoisonedRecipient(report)).not.toBeNull();
  });
});

describe("grants that are not poisoned are unchanged", () => {
  test("the exact contact or own account as spender raises no poisoning flag", () => {
    for (const spender of [contact.address, `0x0${contact.address.slice(2)}`, account.address]) {
      expect(codes([call(ETH, "approve", [spender, "1", "0"])])).not.toContain("address-poisoning");
    }
  });

  test("payee-only rules do not fire on a spender", () => {
    const flags = codes([call(ETH, "approve", [account.address, "1", "0"])]);
    expect(flags).not.toContain("self-transfer");
    expect(codes([call(ETH, "approve", [ETH, "1", "0"])])).not.toContain(
      "token-contract-recipient",
    );
  });

  test("an unrelated spender is not refused and keeps its summary", () => {
    const report = verifyCalls([call(ETH, "approve", [ROUTER, "1", "0"])], context);
    expect(refuseOnPoisonedRecipient(report)).toBeNull();
    expect(report.calls[0]?.summary).toContain("Allow 0x0427");
  });
});

describe("revoking a grant to a lookalike still works", () => {
  test("approve(lookalike, 0) on a tracked token", () => {
    expect(refused([call(ETH, "approve", [CONTACT_TWIN, "0", "0"])])).toBeNull();
    expect(refused([call(ETH, "approve", [CONTACT_TWIN, "0x0", "0x0"])])).toBeNull();
  });

  test("set_approval_for_all(lookalike, false)", () => {
    expect(refused([call(NFT, "set_approval_for_all", [CONTACT_TWIN, "0"])])).toBeNull();
    expect(refused([call(NFT, "setApprovalForAll", [CONTACT_TWIN, "0x0"])])).toBeNull();
  });

  test("decrease_allowance is never a grant", () => {
    expect(refused([call(ETH, "decrease_allowance", [CONTACT_TWIN, "5", "0"])])).toBeNull();
  });
});
