import { TimeChart, type TimeChartProps } from "./TimeChart";

/** Everything a TimeChart takes, except the fill: an area chart is the one with the gradient. */
export type AreaChartProps = Omit<TimeChartProps, "fill">;

/**
 * The boards' large chart: Website traffic, Article traffic, Ranking trend,
 * Performance trend. One to three series over time, each a line with a ringed
 * dot on every point and a gradient under it; y ticks on round numbers, x
 * labels thinned to what fits, an optional dashed previous period, and the
 * newest points drawn as provisional when the source is still counting them.
 *
 *   <AreaChart label="Visitors per day" series={days} unit="count" provisional={2} />
 *
 * `days` can be the `DayPoint[]` the server sent; its `previous` values become
 * the dashed line. With several series, give each a label and place a
 * `<Legend>` beside the chart. Series of dated points are each placed on
 * their own dates, so sources that end on different days need no reshaping.
 * Series share one axis and one unit, so they must be the same quantity:
 * the boards' Performance trend, which plots LCP (s), INP (ms) and CLS (a
 * ratio) on one axis, is built as three LineCharts, one per metric with its
 * own unit. An empty series, a single point, all zeros and nulls are all
 * drawn truthfully (see TimeChart).
 */
export function AreaChart(props: AreaChartProps) {
  return <TimeChart {...props} fill="area" />;
}
