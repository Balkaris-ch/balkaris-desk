import type { ReactNode } from "react";
import type { EarlySignals } from "@/contract/common";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { Info } from "./Tooltip";
import "./early.css";

/**
 * EARLY SIGNALS, as every screen shows them. A Search Console list read in
 * its early mode (the rule is `EARLY` in src/cc/search/gsc.ts) lists rows from
 * one impression up; each row under the list's standard floor carries a quiet
 * "early" beside its figure, and the list carries one line at its head saying
 * what that means. Nothing here decides anything: the server says which rows
 * are early and gives the sentence.
 */

/** The quiet mark beside a figure that stands on fewer impressions than its list's standard floor. */
export function EarlyMark({ standard, className }: { standard: number; className?: string }) {
  const said = `Early signal: shown fewer than ${num(standard)} times in this window, so it can move a lot from day to day.`;
  return (
    <span className={cx("dk-early-mark", className)} title={said}>
      early
      <span className="dk-sr">. {said}</span>
    </span>
  );
}

/** A figure with its early mark when `early` is set: "3 early". */
export function EarlyFigure({ children, early, standard }: { children: ReactNode; early?: boolean; standard: number | undefined }) {
  if (!early || standard === undefined) return <>{children}</>;
  return (
    <span className="dk-early-figure">
      {children}
      <EarlyMark standard={standard} />
    </span>
  );
}

/**
 * The one line at the head of a list read early: what Google showed in the
 * window and which rows carry the mark. The count is of the queries Google
 * REPORTS, and says so: rare queries are withheld, so it is lower than the
 * window's total impressions printed elsewhere on the same screen, and
 * without the qualifier the two would read as a contradiction. The server's
 * whole sentence, with how the list returns to its floor, is on the (i).
 */
export function EarlyLine({ early, rows = "Rows", marked, className }: { early: EarlySignals; rows?: string; marked?: string; className?: string }) {
  return (
    <p className={cx("dk-early-line", className)}>
      <span className="dk-early-mark" aria-hidden>
        early
      </span>
      <span className="dk-early-text">
        Early signals: Google showed the site {num(early.impressions)} {early.impressions === 1 ? "time" : "times"} for the {num(early.queries)}{" "}
        {early.queries === 1 ? "query it reports" : "queries it reports"} (rare queries are withheld) in this window. {marked ?? `${rows} under ${num(early.standard)} impressions are marked early.`}
      </span>
      <Info text={early.line} label="What early signals are" />
    </p>
  );
}
