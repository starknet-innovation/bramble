/**
 * Barrel for the terminal's shared presentational components. Screen agents
 * import these from "../components".
 */
export { Card, type CardProps } from "./Card";
export {
  CandlestickChart,
  type Candle,
  type CandlePlaceholder,
  type CandlestickChartProps,
} from "./CandlestickChart";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { PctChange, type PctChangeProps } from "./PctChange";
export { RankRow, type RankRowProps } from "./RankRow";
export {
  SegmentedTabs,
  type SegmentedOption,
  type SegmentedTabsProps,
} from "./SegmentedTabs";
export { StatPair, type StatPairProps } from "./StatPair";
export { TabStrip, type TabStripItem, type TabStripProps } from "./TabStrip";
export { TokenIcon, type TokenIconProps } from "./TokenIcon";
export { ICON_GRADIENTS, iconGradient } from "./palette";
