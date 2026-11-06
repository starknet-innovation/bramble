/**
 * The multisig co-signer review decodes a CallSet's `compile_actions` call
 * with its own layout of the pool's `ClientAction` enum (#827), because the
 * pinned SDK does not export its pool ABI. A drifted layout would misread who
 * is paid and how much, so every variant's position and members must match the
 * vendored ABI, and calldata compiled from that ABI must decode. Skipped when
 * the vendored SDK source is absent.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { type Abi, CairoCustomEnum, CallData } from "starknet";
import {
  decodeMultisigStrk20CompileActions,
  POOL_CLIENT_ACTION_LAYOUT,
} from "../../packages/features/privacy/src/multisig/pool-call-decode";

const VENDORED = "vendor/starknet-privacy/sdk/src/internal/abi.ts";

type AbiEntry = {
  readonly items?: readonly AbiEntry[];
  readonly members?: readonly { readonly name: string; readonly type: string }[];
  readonly name?: string;
  readonly type?: string;
  readonly variants?: readonly { readonly name: string; readonly type: string }[];
};

const flatten = (entries: readonly AbiEntry[]): readonly AbiEntry[] =>
  entries.flatMap((entry) => [entry, ...flatten(entry.items ?? [])]);

// Read as text, so type-checking never depends on the vendored source.
const vendoredAbi = (): readonly AbiEntry[] => {
  const source = readFileSync(VENDORED, "utf8");
  const start = source.indexOf("[", source.indexOf("export const PrivacyPoolABI"));
  const end = source.lastIndexOf("] as const");
  return JSON.parse(source.slice(start, end + 1)) as readonly AbiEntry[];
};

const ONE_FELT = new Set([
  "core::felt252",
  "core::integer::u32",
  "core::integer::u128",
  "core::starknet::contract_address::ContractAddress",
]);

describe.skipIf(!existsSync(VENDORED))("pool ClientAction layout", () => {
  test("each decoded variant sits at its ABI index with one-felt members in ABI order", () => {
    const entries = flatten(vendoredAbi());
    const actions = entries.find((entry) => entry.name === "privacy::actions::ClientAction");
    const variants = actions?.variants ?? [];
    POOL_CLIENT_ACTION_LAYOUT.forEach(([name, members], index) => {
      const variant = variants[index];
      expect(variant?.name).toBe(name);
      const struct = entries.find((entry) => entry.name === variant?.type);
      expect(struct?.members?.map((member) => member.name)).toEqual([...members]);
      for (const member of struct?.members ?? []) expect(ONE_FELT.has(member.type)).toBe(true);
    });
  });

  test("calldata compiled from the vendored ABI decodes to the same actions", () => {
    const variant = (name: string, value: unknown) =>
      new CairoCustomEnum(
        Object.fromEntries(
          [
            ...POOL_CLIENT_ACTION_LAYOUT.map(([key]) => key),
            "InvokeExternal",
            "ComputeAndInvoke",
          ].map((key) => [key, key === name ? value : undefined]),
        ),
      );
    const compiled = new CallData(vendoredAbi() as unknown as Abi)
      .compile("compile_actions", [
        0x123n,
        0x777n,
        [
          variant("SetViewingKey", { random: 5n }),
          variant("OpenSubchannel", {
            channel_key: 8n,
            index: 1,
            recipient_addr: 0x456n,
            recipient_public_key: 9n,
            salt: 3n,
            token: 0x99n,
          }),
          variant("Deposit", { amount: 1000n, token: 0x99n }),
          variant("UseNote", { channel_key: 8n, index: 0, token: 0x99n }),
          variant("CreateEncNote", {
            amount: 500n,
            index: 2,
            recipient_addr: 0x456n,
            recipient_public_key: 9n,
            salt: 4n,
            token: 0x99n,
          }),
          variant("Withdraw", { amount: 7n, random: 6n, to_addr: 0x456n, token: 0x99n }),
        ],
      ])
      .map((felt) => `0x${BigInt(felt).toString(16)}`);
    expect(decodeMultisigStrk20CompileActions(compiled, "0x123", "0x777")).toEqual([
      { kind: "register" },
      { kind: "setup" },
      { amount: 1000n, kind: "deposit", token: "0x99" },
      { kind: "setup" },
      { amount: 500n, kind: "note", recipient: "0x456", token: "0x99" },
      { amount: 7n, kind: "withdraw", recipient: "0x456", token: "0x99" },
    ]);
  });
});
