/**
 * The desk's charts, drawn by hand in SVG and CSS. One import for a screen:
 *
 *   import { AreaChart, Legend, Spark } from "@/components/charts";
 *
 * Every chart is a server component and is complete in the HTML it is sent
 * as; only the hover layer of the x/y charts runs in the browser. Each takes
 * the width of what it is put in. None of them holds a figure of its own:
 * what they draw is what they are given, and given nothing they say so.
 */
export { AreaChart, type AreaChartProps } from "./AreaChart";
export { LineChart, type LineChartProps } from "./LineChart";
export { ComboChart, type ComboChartProps, type ComboSeries } from "./ComboChart";
export { type ChartSeries, type TimeChartProps } from "./TimeChart";
export { Spark, type SparkProps } from "./Spark";
export { SparkBars, foldBars, type SparkBarsProps } from "./SparkBars";
export { Donut, sliceLegend, type DonutProps, type DonutSlice } from "./Donut";
export { Legend, shareTexts, type LegendItem, type LegendProps } from "./Legend";
export { Ring, ringTone, type RingProps } from "./Ring";
export { Funnel, type FunnelProps, type FunnelStep } from "./Funnel";
export { Bar, BarList, type BarListItem, type BarListProps, type BarProps } from "./BarList";
export { Meter, meterTone, type MeterProps } from "./Meter";
export { CalendarMonth, isMonth, shiftMonth, type CalendarKind, type CalendarMark, type CalendarMonthProps } from "./CalendarMonth";
export { WorldMap, type MapCountry, type WorldMapProps } from "./WorldMap";
export { align, asColor, slotColor, toneColor, type Aligned, type ChartColor, type ChartData, type ChartPoint } from "./series";
