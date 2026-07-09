/**
 * Shared, pure component atoms for the trade terminal screens. Every function
 * returns an escaped-HTML string and never touches the DOM; colors come only
 * from skin tokens via the classes defined in ./styles.ts. Screens compose
 * these into their layouts; event wiring is done by the shell/screen binders
 * through the data-* attributes these atoms emit (see ./bindings.ts).
 */
import { escapeHtml } from "../../shared/html";
import { sparklinePath, sparklineTrend } from "../sparkline";

/**
 * One selectable segment in a segmented tab bar.
 */
export type SegmentTab = {
  readonly id: string;
  readonly label: string;
};

/**
 * Renders a segmented control. `dataAttr` is the data-attribute suffix used for
 * click wiring, e.g. "trade-tab" emits `data-trade-tab="<id>"`; the binder reads
 * the matching dataset key. The active segment carries aria-selected="true".
 */
export const segmentedTabBar = (
  tabs: readonly SegmentTab[],
  activeId: string,
  dataAttr: string,
): string =>
  `<div class="trade-seg-bar" role="tablist">${tabs
    .map(
      (tab) =>
        `<button class="trade-seg" type="button" role="tab" data-${escapeHtml(dataAttr)}="${escapeHtml(
          tab.id,
        )}" aria-selected="${tab.id === activeId}">${escapeHtml(tab.label)}</button>`,
    )
    .join("")}</div>`;

/**
 * Renders a colored 24h-style percentage-change pill: green when non-negative,
 * red when negative, using the skin positive/danger tokens.
 */
export const pctChangePill = (pct: number): string => {
  if (!Number.isFinite(pct)) {
    return "";
  }
  const direction = pct >= 0 ? "up" : "down";
  const arrow = pct >= 0 ? "↑" : "↓";
  return `<span class="trade-pill ${direction}">${arrow} ${Math.abs(pct).toFixed(2)}%</span>`;
};

/**
 * Renders a label-over-value stat pair (e.g. "Market cap" / "$486M").
 */
export const statPair = (label: string, value: string): string =>
  `<div class="trade-stat"><span class="trade-stat-label">${escapeHtml(
    label,
  )}</span><span class="trade-stat-value">${escapeHtml(value)}</span></div>`;

/**
 * Optional click target wired by a binder through a single data-* attribute.
 */
export type TradeRowAction = {
  readonly attr: string;
  readonly value: string;
};

/**
 * Options for a trade list row. `leading` and `trailing` are pre-built HTML
 * fragments (glyphs, pills, sparklines) and are NOT escaped; text fields are.
 */
export type TradeListRowOptions = {
  readonly leading?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly value?: string;
  readonly valueSub?: string;
  readonly trailing?: string;
  readonly action?: TradeRowAction;
};

const rowInner = (options: TradeListRowOptions): string =>
  `${options.leading ? `<span class="trade-row-lead">${options.leading}</span>` : ""}
    <span class="trade-row-copy">
      <strong>${escapeHtml(options.title)}</strong>
      ${options.subtitle ? `<span class="trade-row-sub">${escapeHtml(options.subtitle)}</span>` : ""}
    </span>
    ${options.trailing ? `<span class="trade-row-trail">${options.trailing}</span>` : ""}
    ${
      options.value !== undefined || options.valueSub !== undefined
        ? `<span class="trade-row-side">
            ${options.value !== undefined ? `<span class="trade-row-value">${escapeHtml(options.value)}</span>` : ""}
            ${options.valueSub !== undefined ? `<span class="trade-row-valuesub">${escapeHtml(options.valueSub)}</span>` : ""}
          </span>`
        : ""
    }`;

/**
 * Renders one trade list row as a `<li>`. When `action` is set the row body is a
 * `<button>` carrying the data-* attribute a binder listens on; otherwise it is
 * static markup.
 */
export const tradeListRow = (options: TradeListRowOptions): string => {
  const inner = rowInner(options);
  const body = options.action
    ? `<button class="trade-row-open" type="button" data-${escapeHtml(options.action.attr)}="${escapeHtml(
        options.action.value,
      )}">${inner}</button>`
    : `<div class="trade-row-open">${inner}</div>`;
  return `<li class="trade-row">${body}</li>`;
};

/**
 * Geometry options for the inline mini charts.
 */
export type MiniChartOptions = {
  readonly width?: number;
  readonly height?: number;
};

/**
 * Renders an inline-SVG sparkline from a price series. Stroke color follows the
 * series trend (up/down/flat) via skin tokens; empty when the series is too
 * short to draw.
 */
export const miniSparkline = (
  values: readonly number[],
  options: MiniChartOptions = {},
): string => {
  const width = options.width ?? 72;
  const height = options.height ?? 24;
  const points = sparklinePath(values, width, height);
  if (points.length === 0) {
    return "";
  }
  const trend = sparklineTrend(values);
  return `<svg class="trade-spark ${trend}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" vector-effect="non-scaling-stroke" /></svg>`;
};

/**
 * Renders an inline-SVG mini bar chart from a non-negative series, scaled to the
 * series max. Empty when there is nothing finite to draw.
 */
export const miniBarChart = (values: readonly number[], options: MiniChartOptions = {}): string => {
  const width = options.width ?? 72;
  const height = options.height ?? 24;
  const finite = values.filter((value) => Number.isFinite(value) && value >= 0);
  const max = Math.max(...finite, 0);
  if (finite.length === 0 || max <= 0 || width <= 0 || height <= 0) {
    return "";
  }
  const gap = 2;
  const barWidth = Math.max((width - gap * (finite.length - 1)) / finite.length, 1);
  const round = (value: number): number => Math.round(value * 100) / 100;
  const rects = finite
    .map((value, index) => {
      const barHeight = round((value / max) * height);
      const x = round(index * (barWidth + gap));
      const y = round(height - barHeight);
      return `<rect x="${x}" y="${y}" width="${round(barWidth)}" height="${barHeight}" rx="1" />`;
    })
    .join("");
  return `<svg class="trade-bars" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>`;
};

/**
 * Renders the shared coming-soon placeholder a stub screen shows until phase-2
 * fills it in.
 */
export const tradePlaceholder = (title: string, note: string): string =>
  `<div class="trade-placeholder"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(note)}</p></div>`;

/**
 * Formats a plain USD number as a currency string (two decimals, grouped).
 */
export const formatUsd = (value: number): string =>
  `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

/**
 * Formats a large USD number compactly (e.g. $1.2M, $486K) for market caps and
 * volumes.
 */
export const formatCompactUsd = (value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    return `${sign}$${round1(abs / 1_000_000_000)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${round1(abs / 1_000_000)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${round1(abs / 1_000)}K`;
  }
  return `${sign}$${round1(abs)}`;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Formats a token unit price, keeping small prices legible (more decimals under
 * $1) without ever calling a clock or RNG.
 */
export const formatPrice = (value: number): string => {
  if (value >= 1) {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 2 })}`;
};
