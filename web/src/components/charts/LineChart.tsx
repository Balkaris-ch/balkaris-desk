import { TimeChart, type TimeChartProps } from "./TimeChart";

export interface LineChartProps extends Omit<TimeChartProps, "fill"> {
  /** A faint wash under each line, as on the boards' Response time chart, or nothing. Default "soft". */
  fill?: "soft" | "none";
}

/**
 * Lines that are compared with each other rather than read as volumes: the
 * boards' Response time (edge and origin). The same anatomy as AreaChart, with
 * a faint wash under each line instead of the gradient, or none at all.
 *
 *   <LineChart label="Response time" unit="ms" x={hours}
 *     series={[{ label: "Edge", data: edge }, { label: "Origin", data: origin }]} />
 *
 * `x` holds timestamps here; they are printed as the studio's clock ("08:00").
 */
export function LineChart({ fill = "soft", ...rest }: LineChartProps) {
  return <TimeChart {...rest} fill={fill} />;
}
