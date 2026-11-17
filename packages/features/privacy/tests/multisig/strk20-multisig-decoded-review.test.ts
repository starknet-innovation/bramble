/**
 * A co-owner's card is decoded from what the digest covers: the pool and its
 * function, the account and network, and each action's token, amount, and
 * recipient. Anything that does not decode is refused rather than shown.
 */
import { describe, expect, test } from "bun:test";
import { redactStrk20Calldata } from "@bramble/privacy/multisig-strk20-redaction";
import {
  type MultisigStrk20ReviewScope,
  reviewMultisigStrk20Calls,
  reviewMultisigStrk20Relay,
  reviewMultisigStrk20TypedData,
} from "@bramble/privacy/multisig-strk20-review";
import { STARKNET_NETWORKS, STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import {
  type Call,
  num,
  OutsideExecutionVersion,
  outsideExecution,
  type TypedData,
  typedData,
} from "starknet";
import {
  type ClientActionFelts,
  compileActionsCalldata,
  deposit,
  encNote,
  invokeExternal,
  openChannel,
  openNote,
  setViewingKey,
  useNote,
  withdraw,
} from "../support/multisig-callset";

const SCALAR = "0x654321";
const ACCOUNT = "0x123";
const POOL = "0x9001";
const BOB = "0xb0b";
const STRK = STRK_TOKEN_ADDRESS;
const ONE = 10n ** 18n;
const SCOPE: MultisigStrk20ReviewScope = {
  accountAddress: ACCOUNT,
  chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
  network: STARKNET_NETWORKS.SN_MAIN.name,
  poolAddress: POOL,
  tokens: [{ address: STRK, decimals: 18, symbol: "STRK" }],
};

const callsFor = (
  actions: readonly ClientActionFelts[],
  overrides: {
    readonly account?: string;
    readonly entrypoint?: string;
    readonly pool?: string;
  } = {},
) => [
  {
    calldata:
      redactStrk20Calldata(
        compileActionsCalldata(overrides.account ?? ACCOUNT, SCALAR, actions),
        SCALAR,
      ) ?? [],
    contractAddress: overrides.pool ?? POOL,
    entrypoint: overrides.entrypoint ?? "compile_actions",
  },
];

describe("decoded multisig CallSet review", () => {
  test("names the pool function, account, network, and every value-moving action", () => {
    const review = reviewMultisigStrk20Calls(
      callsFor([
        setViewingKey(),
        openChannel(ACCOUNT),
        deposit(STRK, 3n * ONE),
        useNote(STRK),
        encNote(BOB, STRK, ONE + ONE / 2n),
        encNote(ACCOUNT, STRK, ONE / 4n),
        withdraw(BOB, STRK, 2n * ONE),
      ]),
      SCALAR,
      SCOPE,
    );
    expect(review).toEqual({
      lines: [
        `Account ${ACCOUNT}`,
        "Network Starknet Mainnet",
        "Register this multisig's private balance",
        "Deposit 3 STRK",
        `Send 1.5 STRK to ${BOB}`,
        "Keep 0.25 STRK in this multisig",
        `Withdraw 2 STRK to ${BOB}`,
      ],
      title: "Privacy pool · compile_actions",
    });
    expect(JSON.stringify(review)).not.toContain(SCALAR);
  });

  test("refuses anything this flow does not produce, rather than showing felts", () => {
    const refused = (calls: ReturnType<typeof callsFor>, scope = SCOPE) =>
      reviewMultisigStrk20Calls(calls, SCALAR, scope);
    expect(refused(callsFor([deposit(STRK, ONE)], { pool: "0x9002" }))).toBeNull();
    expect(refused(callsFor([deposit(STRK, ONE)], { entrypoint: "apply_actions" }))).toBeNull();
    expect(refused(callsFor([deposit(STRK, ONE)], { account: "0x999" }))).toBeNull();
    expect(refused([...callsFor([deposit(STRK, ONE)]), ...callsFor([deposit(STRK, ONE)])])).toBe(
      null,
    );
    expect(refused(callsFor([invokeExternal(BOB)]))).toBeNull();
    expect(refused(callsFor([openNote(BOB, STRK)]))).toBeNull();
    expect(refused(callsFor([deposit("0x7777", ONE)]))).toBeNull();
    expect(refused(callsFor([openChannel(BOB), useNote(STRK)]))).toBeNull();
    // Felts Cairo could not deserialize as the ABI's u32 index or u128 salt.
    const wideIndex = [...openChannel(BOB)];
    wideIndex[2] = num.toHex(1n << 32n);
    expect(refused(callsFor([wideIndex, deposit(STRK, ONE)]))).toBeNull();
    const wideSalt = [...encNote(BOB, STRK, ONE)];
    wideSalt[6] = num.toHex(1n << 128n);
    expect(refused(callsFor([wideSalt]))).toBeNull();
    const [call] = callsFor([deposit(STRK, ONE)]);
    if (!call) throw new Error("missing call");
    expect(refused([{ ...call, calldata: [...call.calldata, "0x1"] }])).toBeNull();
    // The shared key must sit in the key slot, not be dropped or moved.
    const unredacted = compileActionsCalldata(ACCOUNT, "0x1", [deposit(STRK, ONE)]);
    expect(refused([{ ...call, calldata: [...unredacted] }])).toBeNull();
  });
});

const approve = (spender: string, amount: bigint, token = STRK): Call => ({
  calldata: [spender, num.toHex(amount), "0x0"],
  contractAddress: token,
  entrypoint: "approve",
});

const NOW = 1_000;

const envelope = (calls: readonly Call[], chainId = SCOPE.chainId): TypedData =>
  outsideExecution.getTypedData(
    chainId,
    { caller: "0x99", execute_after: "0x1", execute_before: num.toHex(NOW + 600) },
    "0x5",
    [...calls],
    OutsideExecutionVersion.V2,
  );

const digest = (value: TypedData): string => num.toHex(typedData.getMessageHash(value, ACCOUNT));

describe("decoded multisig relay typed data", () => {
  test("shows a token approval to the pool, bound to this account and chain", () => {
    const value = envelope([approve(POOL, 2n * ONE)]);
    expect(reviewMultisigStrk20TypedData(value, digest(value), NOW, SCOPE)).toEqual({
      lines: [
        `Account ${ACCOUNT}`,
        "Network Starknet Mainnet",
        "Allow the privacy pool to spend 2 STRK",
        "Relayer 0x99",
      ],
      title: "Token approval",
    });
  });

  test("refuses a foreign chain, another message type, or any other call", () => {
    const foreign = envelope([approve(POOL, ONE)], STARKNET_NETWORKS.SN_SEPOLIA.chainId);
    expect(reviewMultisigStrk20TypedData(foreign, digest(foreign), NOW, SCOPE)).toBeNull();
    const permit = { ...envelope([approve(POOL, ONE)]), primaryType: "Permit" } as TypedData;
    expect(reviewMultisigStrk20TypedData(permit, digest(envelope([])), NOW, SCOPE)).toBeNull();
    const spender = envelope([approve("0x5151", ONE)]);
    expect(reviewMultisigStrk20TypedData(spender, digest(spender), NOW, SCOPE)).toBeNull();
    const transfer = envelope([{ ...approve(POOL, ONE), entrypoint: "transfer" }]);
    expect(reviewMultisigStrk20TypedData(transfer, digest(transfer), NOW, SCOPE)).toBeNull();
    const valid = envelope([approve(POOL, ONE)]);
    expect(reviewMultisigStrk20TypedData(valid, "0x1", NOW, SCOPE)).toBeNull();
    expect(reviewMultisigStrk20TypedData(valid, digest(valid), NOW + 590, SCOPE)).toBeNull();
    expect(reviewMultisigStrk20TypedData({ message: {} }, "0x1", NOW, SCOPE)).toBeNull();
  });
});

describe("decoded multisig relay before Send", () => {
  test("shows the action and the relay fee in their tokens", () => {
    const relay = {
      call: { contractAddress: POOL, entrypoint: "apply_actions" },
      feeAction: { amount: num.toHex(ONE / 10n), token: STRK },
      request: { amount: num.toHex(ONE), kind: "transfer" as const, recipient: BOB, token: STRK },
    };
    expect(reviewMultisigStrk20Relay(relay, SCOPE)).toEqual({
      lines: [
        `Account ${ACCOUNT}`,
        "Network Starknet Mainnet",
        `Send 1 STRK to ${BOB}`,
        "Relay fee 0.1 STRK",
      ],
      title: "Privacy pool · apply_actions",
    });
    expect(
      reviewMultisigStrk20Relay(
        { ...relay, request: { ...relay.request, kind: "withdraw", recipient: ACCOUNT } },
        SCOPE,
      )?.lines,
    ).toContain("Withdraw 1 STRK to this multisig");
    expect(
      reviewMultisigStrk20Relay(
        { ...relay, call: { ...relay.call, contractAddress: "0x1" } },
        SCOPE,
      ),
    ).toBeNull();
    expect(
      reviewMultisigStrk20Relay(
        { ...relay, feeAction: { ...relay.feeAction, token: "0x7" } },
        SCOPE,
      ),
    ).toBeNull();
  });
});
