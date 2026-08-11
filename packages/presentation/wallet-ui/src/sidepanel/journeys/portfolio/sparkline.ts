/**
 * Pure sparkline geometry: turns a price series into an SVG polyline points
 * string scaled to a viewBox. No DOM, no styling — the caller draws it with
 * skin tokens.
 */

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * One scaled point in the sparkline viewBox.
 */
export type SparklinePoint = {
  readonly x: number;
  readonly y: number;
};

/**
 * Scales a numeric series into viewBox coordinates. The first sample sits at
 * x=0 and the last at x=width; y is inverted so higher values rise. A flat
 * series (or one with a single finite value) is centred vertically. Returns an
 * empty array when fewer than two finite samples are present.
 */
export const sparklinePoints = (
  values: readonly number[],
  width: number,
  height: number,
): readonly SparklinePoint[] => {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2 || width <= 0 || height <= 0) {
    return [];
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  const step = width / (finite.length - 1);
  return finite.map((value, index) => ({
    x: round(index * step),
    y: round(span === 0 ? height / 2 : height - ((value - min) / span) * height),
  }));
};

/**
 * Builds the `points` attribute string for an SVG `<polyline>` from a series.
 * Empty when the series cannot be drawn.
 */
export const sparklinePath = (values: readonly number[], width: number, height: number): string =>
  sparklinePoints(values, width, height)
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

/**
 * Direction of a price series from its first to last finite sample, used to
 * pick a trend color.
 */
export const sparklineTrend = (values: readonly number[]): "down" | "flat" | "up" => {
  const finite = values.filter((value) => Number.isFinite(value));
  const first = finite[0];
  const last = finite[finite.length - 1];
  if (first === undefined || last === undefined || first === last) {
    return "flat";
  }
  return last > first ? "up" : "down";
};
