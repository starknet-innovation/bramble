/**
 * One definition of what an AVNU `multi_route_swap` call looks like on the
 * wire, shared by every suite that needs a build the wallet will accept.
 *
 * Before the route calldata was bound to the reviewed intent, five suites each
 * carried their own one-felt placeholder (`calldata: ["0x3"]`). A gate that
 * decodes the calldata makes those placeholders undecodable, and five local
 * replacements would be five chances to drift apart. Builders take explicit
 * overrides so a test states only the field it is exercising.
 */
import { UINT128_LIMIT } from "@bramble/wallet-model/networks";

// Split through the one shared `2 ** 128`, never a local `1n << 128n`: a
// fixture that disagreed with the decoder about where a limb ends would prove
// the decoder correct against its own mistake.
const uint256 = (value: bigint): readonly string[] => [
  `0x${(value % UINT128_LIMIT).toString(16)}`,
  `0x${(value / UINT128_LIMIT).toString(16)}`,
];

/**
 * One serialized `Route`: sell token, buy token, then a Direct `RouteSwap`
 * (exchange address, percent, and the exchange's opaque parameters). Matches
 * the pinned layout documented in @bramble/wallet-model/avnu-route.
 */
export const avnuDirectRoute = (options: {
  readonly buyToken: string;
  readonly exchange?: string;
  readonly params?: readonly string[];
  readonly percent?: string;
  readonly sellToken: string;
}): readonly string[] => {
  const params = options.params ?? ["0x1f4", "0x0"];
  return [
    options.sellToken,
    options.buyToken,
    options.exchange ?? "0x1114c7103e12c2b2ecbd3a2472ba9c48ddcbf702b1c242dd570057e26212111",
    options.percent ?? "0x2540be400",
    `0x${params.length.toString(16)}`,
    ...params,
  ];
};

/**
 * The fields of a `multi_route_swap` call, in the order the pinned exchange ABI
 * declares them. Every one is explicit: a fixture that defaulted the
 * beneficiary or the minimum would hide the very field a case is about.
 */
export type AvnuRouteFixture = {
  readonly beneficiary: string;
  readonly buyAmount: bigint;
  readonly buyToken: string;
  readonly integratorFeeBps?: bigint;
  readonly integratorFeeRecipient?: string;
  readonly minBuyAmount: bigint;
  readonly routes?: readonly (readonly string[])[];
  readonly sellAmount: bigint;
  readonly sellToken: string;
};

/**
 * Builds the felt calldata for one `multi_route_swap` call. Pure and total:
 * every value is rendered exactly as given, including a deliberately hostile
 * one, so a suite can prove which single field a rejection turns on.
 */
export const avnuRouteCalldata = (fixture: AvnuRouteFixture): string[] => {
  const routes = fixture.routes ?? [
    avnuDirectRoute({ buyToken: fixture.buyToken, sellToken: fixture.sellToken }),
  ];
  return [
    fixture.sellToken,
    ...uint256(fixture.sellAmount),
    fixture.buyToken,
    ...uint256(fixture.buyAmount),
    ...uint256(fixture.minBuyAmount),
    fixture.beneficiary,
    `0x${(fixture.integratorFeeBps ?? 0n).toString(16)}`,
    fixture.integratorFeeRecipient ?? "0x0",
    `0x${routes.length.toString(16)}`,
    ...routes.flat(),
  ];
};
