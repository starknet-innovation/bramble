import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { VesuMarket } from "../data";

const WIDTH = 300;
const HEIGHT = 118;
const PADDING = { bottom: 18, left: 30, right: 8, top: 9 } as const;
const TOOLTIP_WIDTH = 92;
const TOOLTIP_HEIGHT = 27;

/** Reproduces Vesu's current piecewise rate curve at a given utilization. */
export const vesuBorrowAprAt = (market: VesuMarket, utilization: number): number => {
  const bounded = Math.max(0, Math.min(100, utilization));
  const zero = market.zeroUtilizationApr;
  const full = Math.max(zero, market.fullUtilizationApr);
  const targetUtilization = Math.max(0.01, Math.min(99.99, market.targetUtilization));
  const targetRate = zero + (full - zero) * (market.targetRatePercent / 100);
  return bounded < targetUtilization
    ? zero + (bounded * (targetRate - zero)) / targetUtilization
    : targetRate +
        ((bounded - targetUtilization) * (full - targetRate)) / (100 - targetUtilization);
};

type Props = {
  readonly market: VesuMarket;
};

/** Interactive Vesu interest-rate curve with current/target/max utilization markers. */
export const InterestRateCurve = ({ market }: Props): ReactNode => {
  const [inspected, setInspected] = useState(market.utilization);
  useEffect(() => {
    setInspected(market.utilization);
  }, [market.assetAddress, market.poolId, market.utilization]);
  const points = useMemo(
    () =>
      Array.from({ length: 41 }, (_, index) => {
        const utilization = index * 2.5;
        return { utilization, rate: vesuBorrowAprAt(market, utilization) };
      }),
    [market],
  );
  const maxRate = Math.max(
    0.01,
    market.fullUtilizationApr,
    market.maxFullUtilizationApr,
    ...points.map((point) => point.rate),
  );
  const x = (utilization: number): number =>
    PADDING.left + (utilization / 100) * (WIDTH - PADDING.left - PADDING.right);
  const y = (rate: number): number =>
    PADDING.top +
    (1 - rate / maxRate) * (HEIGHT - PADDING.top - PADDING.bottom);
  const line = points.map((point) => `${x(point.utilization)},${y(point.rate)}`).join(" ");
  const inspectedRate = vesuBorrowAprAt(market, inspected);
  const tooltipX = Math.max(
    PADDING.left,
    Math.min(WIDTH - PADDING.right - TOOLTIP_WIDTH, x(inspected) - TOOLTIP_WIDTH / 2),
  );
  const tooltipY = Math.max(
    PADDING.top,
    Math.min(HEIGHT - PADDING.bottom - TOOLTIP_HEIGHT, y(inspectedRate) - TOOLTIP_HEIGHT - 6),
  );

  const inspectPointer = (event: PointerEvent<SVGSVGElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const local = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const utilization =
      ((local - PADDING.left) / (WIDTH - PADDING.left - PADDING.right)) * 100;
    setInspected(Math.max(0, Math.min(100, utilization)));
  };

  const inspectKeyboard = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    setInspected((value) =>
      Math.max(0, Math.min(100, value + (event.key === "ArrowRight" ? 0.5 : -0.5))),
    );
  };

  return (
    <div className="rate-curve">
      <svg
        aria-label={`Vesu borrow rate curve. Current utilization ${market.utilization.toFixed(1)} percent and borrow APR ${market.borrowApr.toFixed(2)} percent. Use left and right arrow keys to inspect the curve.`}
        onKeyDown={inspectKeyboard}
        onPointerLeave={() => setInspected(market.utilization)}
        onPointerMove={inspectPointer}
        role="img"
        tabIndex={0}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <rect
          className="rate-curve-target-band"
          height={HEIGHT - PADDING.top - PADDING.bottom}
          width={Math.max(1, x(market.maxTargetUtilization) - x(market.minTargetUtilization))}
          x={x(market.minTargetUtilization)}
          y={PADDING.top}
        />
        <line className="rate-curve-grid" x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y(maxRate / 2)} y2={y(maxRate / 2)} />
        <line className="rate-curve-axis" x1={PADDING.left} x2={WIDTH - PADDING.right} y1={HEIGHT - PADDING.bottom} y2={HEIGHT - PADDING.bottom} />
        <polyline className="rate-curve-line" points={line} />
        <line className="rate-curve-max" x1={x(market.maxUtilization)} x2={x(market.maxUtilization)} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} />
        <line className="rate-curve-current" x1={x(market.utilization)} x2={x(market.utilization)} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} />
        <circle className="rate-curve-current-dot" cx={x(market.utilization)} cy={y(vesuBorrowAprAt(market, market.utilization))} r="3.5" />
        <line className="rate-curve-inspect" x1={x(inspected)} x2={x(inspected)} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} />
        <circle className="rate-curve-inspect-dot" cx={x(inspected)} cy={y(inspectedRate)} r="3" />
        <g className="rate-curve-tooltip" aria-live="polite">
          <rect
            height={TOOLTIP_HEIGHT}
            rx="3"
            width={TOOLTIP_WIDTH}
            x={tooltipX}
            y={tooltipY}
          />
          <text x={tooltipX + 6} y={tooltipY + 10}>
            <tspan>{inspected.toFixed(1)}% utilization</tspan>
            <tspan className="rate-curve-tooltip-rate" x={tooltipX + 6} dy="10">
              {inspectedRate.toFixed(2)}% borrow APR
            </tspan>
          </text>
        </g>
        <text x={PADDING.left} y={HEIGHT - 4}>0%</text>
        <text
          className="rate-curve-target-label"
          textAnchor="end"
          x={Math.min(x(market.targetUtilization) - 3, WIDTH - PADDING.right - 20)}
          y={HEIGHT - PADDING.bottom - 4}
        >
          target {market.targetUtilization.toFixed(0)}%
        </text>
        <text textAnchor="end" x={WIDTH - PADDING.right} y={HEIGHT - 4}>100%</text>
        <text x="1" y={PADDING.top + 3}>{maxRate.toFixed(0)}%</text>
        <text x="1" y={HEIGHT - PADDING.bottom}>0%</text>
      </svg>
      <div className="rate-curve-legend">
        <span><i className="current" /> Current</span>
        <span><i className="target" /> Adaptive target band</span>
        <span><i className="maximum" /> Max utilization</span>
      </div>
    </div>
  );
};
