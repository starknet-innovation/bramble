/**
 * The 7-day chart parity block: the extension's real `getTokenChart` driven through scripted
 * CoinGecko answers and a scripted clock (TTL, failure back-off, off-mainnet serving, point cap).
 */
import { createPriceService } from "@bramble/portfolio/prices";
import type { DisplayCurrency } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import { type ScriptedAnswer, scriptedClock, scriptedFetch } from "./shared";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";

type ChartStep = {
  readonly address: string;
  readonly answer: ScriptedAnswer;
  readonly currency: DisplayCurrency;
  readonly networkId: StarknetNetworkId;
  readonly now: number;
};

/** `getTokenChart` timelines. */
export const chartsBlock = async () => {
  const clock = scriptedClock(0);
  let answer: ScriptedAnswer = null;
  const seen: string[] = [];
  const service = createPriceService({
    http: scriptedFetch(() => answer, seen),
    now: clock.read,
    store: createMemoryStore(),
  });
  const series = (points: readonly unknown[]): string =>
    JSON.stringify({ prices: points.map((p, i) => [i, p]) });
  const steps: ChartStep[] = [
    {
      address: STRK,
      answer: { body: series([1.5, 2, 1.75]), status: 200 },
      currency: "usd",
      networkId: "SN_MAIN",
      now: 1_000,
    },
    { address: STRK, answer: null, currency: "usd", networkId: "SN_MAIN", now: 2_000 },
    {
      address: STRK,
      answer: { body: "{}", status: 500 },
      currency: "usd",
      networkId: "SN_MAIN",
      now: 1_000 + 1_800_000,
    },
    { address: STRK, answer: null, currency: "usd", networkId: "SN_MAIN", now: 1_000 + 1_830_000 },
    {
      address: STRK,
      answer: null,
      currency: "usd",
      networkId: "SN_SEPOLIA",
      now: 1_000 + 1_900_000,
    },
    {
      address: STRK,
      answer: { body: `${series([1, "x", null, 2]).slice(0, -2)},[4,1e400]]}`, status: 200 },
      currency: "eur",
      networkId: "SN_MAIN",
      now: 5_000,
    },
    {
      address: ETH,
      answer: { body: series(Array.from({ length: 2_100 }, (_, i) => i)), status: 200 },
      currency: "gbp",
      networkId: "SN_MAIN",
      now: 5_000,
    },
    {
      address: USDC,
      answer: { body: '{"prices":"none"}', status: 200 },
      currency: "usd",
      networkId: "SN_MAIN",
      now: 5_000,
    },
    {
      address: USDC,
      answer: { body: series([1, 1.01]), status: 200 },
      currency: "usd",
      networkId: "SN_MAIN",
      now: 5_500,
    },
  ];
  const outputs = [];
  for (const step of steps) {
    clock.now = step.now;
    answer = step.answer;
    seen.length = 0;
    const chart = await service.getTokenChart({
      address: step.address,
      currency: step.currency,
      networkId: step.networkId,
    });
    outputs.push({ ...step, out: { points: chart.points, urls: [...seen] } });
  }
  return outputs;
};
