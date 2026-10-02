import type { InsightsPayload } from "@/contract/insights";
import { CalendarMonth, shiftMonth, type CalendarKind } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Stamp } from "@/components/ui/Stamp";
import { hrefOf, type View } from "./href";

/** The four things the desk records a date for, in the order the legend lists them. */
const KINDS: CalendarKind[] = [
  { key: "published", label: "Published", color: "green" },
  { key: "unlisted", label: "Live, unlisted", color: "amber" },
  { key: "draft", label: "Draft", color: "violet" },
  { key: "shared", label: "Shared", color: "blue" },
];

/**
 * The month, with a dot for each thing that happened on a day: an article
 * listed, put live unlisted, written as a draft, or a link shared. Only the
 * kinds that occur in the weeks shown are in the legend.
 */
export function CalendarPanel({ data, view }: { data: InsightsPayload; view: View }) {
  const { month, today, dots } = data.calendar;
  const present = new Set(dots.map((d) => d.kind));
  const thisMonth = today.slice(0, 7);
  return (
    <Card
      className="dk-insights-calendar"
      title="Content calendar"
      icon="calendar"
      info="From the desk's own records: when each article was listed, went live unlisted or was written, and when each link was shared."
      right={<Stamp source="desk" asOf={data.inbox.asOf} />}
    >
      <CalendarMonth
        month={month}
        today={today}
        marks={dots.map((d) => ({ date: d.date, kind: d.kind, title: d.title }))}
        kinds={KINDS.filter((k) => present.has(k.key))}
        prevHref={hrefOf(view, { month: shiftMonth(month, -1) })}
        nextHref={hrefOf(view, { month: shiftMonth(month, 1) })}
        todayHref={month === thisMonth ? undefined : hrefOf(view, { month: undefined })}
      />
    </Card>
  );
}
