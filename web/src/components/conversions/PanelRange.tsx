import { Suspense } from "react";
import type { ConversionsRange } from "@/contract/conversions";
import { Select } from "@/components/ui/Select";
import { rangeLabel, RANGES } from "@/lib/format";
import "./conversions.css";

/**
 * The "Last 30 days" select in a panel's head. It writes the panel's own
 * search param (`?funnel=90d`), which the server reads for that panel only;
 * left at the page's period it removes the param, so the panel follows the
 * page's switch again.
 */
export function PanelRange({ param, page, label }: { param: "funnel" | "channels" | "trend"; page: ConversionsRange; label: string }) {
  return (
    <Suspense fallback={<span className="dk-conversions-range-space" aria-hidden />}>
      <Select param={param} fallback={page} label={label} options={RANGES.map((r) => ({ value: r, label: rangeLabel(r) }))} />
    </Suspense>
  );
}
