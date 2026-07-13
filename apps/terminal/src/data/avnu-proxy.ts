/**
 * Returns whether AVNU reported missing candle history rather than a usable
 * series. The dev proxy maps these responses to an empty array so unsupported
 * assets render the existing no-history state without browser error spam.
 */
export const isMissingAvnuCandleHistory = (path: string, status: number): boolean =>
  path.includes("/prices/candle") && (status === 404 || status >= 500);
