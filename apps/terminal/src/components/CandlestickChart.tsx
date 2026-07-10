/**
 * CandlestickChart — renders a candlestick chart with lightweight-charts when
 * real OHLC data is supplied, and falls back to a self-contained SVG mock
 * (ported from the approved mockup's candle generator) when it is not, so the
 * screens render a faithful placeholder until they wire in live data.
 */
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

/** One OHLC candle. `time` is a unix timestamp in seconds. */
export type Candle = {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

/** Config for the SVG placeholder shown when no data is provided. */
export type CandlePlaceholder = {
  readonly start: number;
  readonly vol: number;
  readonly up: boolean;
  readonly format: (value: number) => string;
  /** Number of candles to synthesize. Defaults to 60. */
  readonly count?: number;
};

export type CandlestickChartProps = {
  /** Live OHLC data. When present (non-empty) lightweight-charts is used. */
  readonly data?: readonly Candle[];
  /** Placeholder config used when `data` is absent/empty. */
  readonly placeholder?: CandlePlaceholder;
  readonly height?: number;
};

const DEFAULT_PLACEHOLDER: CandlePlaceholder = {
  start: 100,
  vol: 1.5,
  up: true,
  format: (value) => value.toFixed(2),
};

type MockCandle = { o: number; c: number; hi: number; lo: number; vol: number };

// Ports the mockup's random candle walk into a pure generator.
const buildMockCandles = (opts: CandlePlaceholder): MockCandle[] => {
  const count = opts.count ?? 60;
  const out: MockCandle[] = [];
  let price = opts.start;
  for (let i = 0; i < count; i += 1) {
    const o = price;
    const drift = (Math.random() - 0.47) * opts.vol;
    const c = o + drift;
    const hi = Math.max(o, c) + Math.random() * opts.vol * 0.6;
    const lo = Math.min(o, c) - Math.random() * opts.vol * 0.6;
    const vol = Math.random() * 0.7 + 0.3;
    out.push({ o, c, hi, lo, vol });
    price = c;
  }
  return out;
};

// The SVG candlestick placeholder, matching the mockup geometry.
const MockChart = ({
  opts,
  height,
}: {
  opts: CandlePlaceholder;
  height: number;
}): ReactNode => {
  const data = useMemo(() => buildMockCandles(opts), [opts]);
  const width = 900;
  const pad = 42;
  const volH = 52;
  const n = data.length;
  const cw = (width - pad - 8) / n;
  const bw = cw * 0.6;
  const min = Math.min(...data.map((d) => d.lo));
  const max = Math.max(...data.map((d) => d.hi));
  const chartH = height - volH - 18;
  const y = (v: number): number => 18 + ((max - v) / (max - min)) * (chartH - 18);
  const maxVol = Math.max(...data.map((d) => d.vol));
  const last = data[n - 1]?.c ?? opts.start;
  const green = "#2fcf8e";
  const red = "#f0616d";
  const accent = opts.up ? green : red;

  return (
    <svg
      className="chart-svg"
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {[0, 1, 2, 3, 4].map((k) => {
        const gy = 18 + ((chartH - 18) * k) / 4;
        const val = max - ((max - min) * k) / 4;
        return (
          <g key={`grid-${k}`}>
            <line x1={0} y1={gy} x2={width - pad} y2={gy} stroke="#1a2029" strokeWidth={1} />
            <text x={width - pad + 4} y={gy + 3} fill="#697280" fontSize={9} fontFamily="monospace">
              {opts.format(val)}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = i * cw + 2;
        const bh = (d.vol / maxVol) * (volH - 6);
        return (
          <rect
            key={`vol-${i}`}
            x={x}
            y={height - bh - 2}
            width={bw}
            height={bh}
            fill={d.c >= d.o ? "rgba(47,207,142,.35)" : "rgba(240,97,109,.35)"}
          />
        );
      })}
      {data.map((d, i) => {
        const x = i * cw + 2 + bw / 2;
        const col = d.c >= d.o ? green : red;
        const yTop = y(Math.max(d.o, d.c));
        const yBot = y(Math.min(d.o, d.c));
        return (
          <g key={`candle-${i}`}>
            <line x1={x} y1={y(d.hi)} x2={x} y2={y(d.lo)} stroke={col} strokeWidth={1} />
            <rect
              x={i * cw + 2}
              y={yTop}
              width={bw}
              height={Math.max(1, yBot - yTop)}
              fill={col}
            />
          </g>
        );
      })}
      <line
        x1={0}
        y1={y(last)}
        x2={width - pad}
        y2={y(last)}
        stroke={accent}
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.7}
      />
      <rect x={width - pad} y={y(last) - 8} width={pad} height={16} fill={accent} />
      <text
        x={width - pad + 4}
        y={y(last) + 3}
        fill="#04140d"
        fontSize={9}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {opts.format(last)}
      </text>
    </svg>
  );
};

// The real lightweight-charts renderer, used when live data is present.
const LiveChart = ({
  data,
  height,
}: {
  data: readonly Candle[];
  height: number;
}): ReactNode => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const chart: IChartApi = createChart(container, {
      height,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#697280",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1a2029" },
        horzLines: { color: "#1a2029" },
      },
      rightPriceScale: { borderColor: "#20262f" },
      timeScale: { borderColor: "#20262f" },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#2fcf8e",
      downColor: "#f0616d",
      borderVisible: false,
      wickUpColor: "#2fcf8e",
      wickDownColor: "#f0616d",
    });
    series.setData(
      data.map(
        (candle): CandlestickData => ({
          time: candle.time as UTCTimestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        }),
      ),
    );
    chart.timeScale().fitContent();
    return () => {
      chart.remove();
    };
  }, [data, height]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
};

/**
 * Candlestick chart. Renders live lightweight-charts data when `data` is a
 * non-empty array; otherwise renders the SVG placeholder driven by `placeholder`.
 */
export const CandlestickChart = ({
  data,
  placeholder,
  height = 320,
}: CandlestickChartProps): ReactNode => {
  if (data !== undefined && data.length > 0) {
    return <LiveChart data={data} height={height} />;
  }
  return <MockChart opts={placeholder ?? DEFAULT_PLACEHOLDER} height={height} />;
};
