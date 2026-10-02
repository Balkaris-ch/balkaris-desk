import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { CheckValue, SeoWindow } from "@/contract/seo";
import { cx } from "@/lib/cx";
import { DASH, fullDate, num, shortDate, sourceLabel } from "@/lib/format";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import type { OkReading } from "@/components/ui/Read";
import "@/components/ui/read.css";
import "./seo.css";

/** "Sep 1 – Sep 30" */
export const windowText = (w: { start: string; end: string }): string => `${shortDate(w.start)} – ${shortDate(w.end)}`;

/** A position as Search Console gives it: an average, one decimal at most. */
export const position = (p: number | null | undefined): string => (p == null ? DASH : num(p, 1));

/**
 * What a missing earlier position means when the list is not `compared`. True
 * for each reason that makes it so (routes/seo.ts, queriesCompared): Google's
 * figures do not cover the period before from its first day, Google reported
 * none of that period's queries (all withheld as rare), or Google's row limit
 * cut the list.
 */
export const NOT_COMPARED = "No earlier position to compare with: Google’s figures do not cover the period before whole, or report none of its queries, so whether it was shown then is not known.";

/** What a missing earlier position means for a query listed early: Google withholds rare queries, so its absence says nothing. */
export const NOT_NEW_EARLY =
  "Google reported no position for it in the period before, but it withholds rare queries, and one shown this few times may have been shown then too. So it is not called new.";

/** Why no change is shown for a row shown too few times in one of the two periods. */
export const changeTooThin = (floor: number): string =>
  `Shown fewer than ${num(floor)} times in one of the two periods: a change in position on so few impressions is noise, so none is shown (the same floor as Recent ranking movements).`;

/** The absent dash with its reason on hover and for a screen reader. */
function NoChange({ why }: { why: string }) {
  return (
    <span className="dk-seo-move dk-seo-move--flat" title={why}>
      <span aria-hidden>{DASH}</span>
      <span className="dk-sr">{why}</span>
    </span>
  );
}

/**
 * Positions gained between two windows: "↑ 4" in green when the page or query
 * moved up (a smaller number), "↓ 3" in red when it fell. Without an earlier
 * position it says "new" only when the window before was measured whole
 * (`compared`) and the row is not an early one (`early`: Google may have
 * withheld it then as rare); otherwise it shows the absent dash with the
 * reason. With `changeFloor` (the row was shown too few times in one of the
 * periods) it shows the dash instead of an arrow.
 */
export function PositionChange({ previous, current, compared, early, changeFloor }: { previous: number | null; current: number; compared: boolean; early?: boolean; changeFloor?: number }) {
  if (previous === null) {
    if (!compared) return <NoChange why={NOT_COMPARED} />;
    if (early) return <NoChange why={NOT_NEW_EARLY} />;
    return (
      <span className="dk-seo-move dk-seo-move--new" title="Google did not show the site for it in the period before">
        new
      </span>
    );
  }
  if (changeFloor !== undefined) return <NoChange why={changeTooThin(changeFloor)} />;
  const gained = previous - current;
  const size = Math.abs(gained);
  const text = size >= 10 ? num(Math.round(size)) : num(size, 1);
  if (size < 0.05) {
    return (
      <span className="dk-seo-move dk-seo-move--flat">
        <span aria-hidden>{DASH}</span>
        <span className="dk-sr">unchanged</span>
      </span>
    );
  }
  return (
    <span className={cx("dk-seo-move", gained > 0 ? "dk-seo-move--up" : "dk-seo-move--down")}>
      <Icon name={gained > 0 ? "arrow-up" : "arrow-down"} size={12} />
      <span aria-hidden>{text}</span>
      <span className="dk-sr">
        {gained > 0 ? "up" : "down"} {text} positions, from {position(previous)}
      </span>
    </span>
  );
}

/** The filled circle a check row carries: a tick, an exclamation, a cross, or a dash when its source is absent. */
export function StatusMark({ tone }: { tone: CheckValue["tone"] | "absent" }) {
  const icon = tone === "good" ? "check" : tone === "bad" ? "x" : tone === "warn" ? "alert" : "minus";
  const said = tone === "good" ? "Passes" : tone === "bad" ? "Fails" : tone === "warn" ? "Needs attention" : "Not available";
  return (
    <span className={cx("dk-seo-mark", `dk-seo-mark--${tone}`)} role="img" aria-label={said}>
      {tone === "warn" ? <b aria-hidden>!</b> : <Icon name={icon} size={11} />}
    </span>
  );
}

/** A small line saying which window a panel's figures cover, for its foot or head. */
export function WindowLine({ window, children }: { window: SeoWindow; children?: ReactNode }) {
  return (
    <p className="dk-seo-window">
      {windowText(window)}
      {children}
    </p>
  );
}

/**
 * The ribbon over a screen fed artificial rows. Loud on purpose: nothing on a
 * specimen screen may be read as the website's figures.
 */
export function SpecimenRibbon({ realHref }: { realHref: string }) {
  return (
    <div className="dk-seo-specimen" role="note">
      <Icon name="flask" size={16} />
      <p>
        <b>Specimen data.</b> The Search Console and Bing panels on this screen are fed artificial rows made by formula (“specimen query 07”, “/specimen/page-03”), so their connected state
        can be looked at before the keys exist. The crawl’s panels are real. This is only possible on a workstation.
      </p>
      <Go href={realHref} className="dk-seo-specimen-go">
        Show the real state
      </Go>
    </div>
  );
}

/** A reading that is absent, as a short line in a table cell or a row, with the reason and the step on hover. */
export function AbsentLine({ reading, children }: { reading: Exclude<Reading<unknown>, { state: "ok" }>; children: ReactNode }) {
  const step = reading.state === "off" ? reading.step : undefined;
  return (
    <Tooltip
      text={
        <>
          {reading.reason}
          {step ? <span className="dk-absent-tip-step">{step}</span> : null}
        </>
      }
    >
      <span className="dk-seo-absent-line" tabIndex={0}>
        {children}
        <span className="dk-sr">
          {reading.reason} {step ?? ""}
        </span>
      </span>
    </Tooltip>
  );
}

/** "1 Oct 2026" */
export const day = (d: string): string => fullDate(d);

/**
 * A panel's absent state, as the Read primitive draws it (the same marks and
 * type), with one difference: the step that connects the source is folded
 * into a disclosure under the reason. Search Console's step is a paragraph,
 * and eight panels of this screen wait for it; written out eight times it
 * would push the screen's real panels off the page. The step is the same
 * sentence the source gives, one click away in every panel.
 */
export function PanelAbsent({ reading }: { reading: Exclude<Reading<unknown>, { state: "ok" }> }) {
  const waiting = reading.state === "waiting";
  const step = reading.state === "off" ? reading.step : undefined;
  return (
    <div className="dk-absent dk-absent--panel dk-seo-absent">
      <span className="dk-absent-mark" aria-hidden>
        <Icon name={waiting ? "hourglass" : "minus"} size={18} />
      </span>
      <p className="dk-absent-head">
        {waiting ? "Nothing yet" : "Not available"}
        {reading.source === "none" ? null : <span className="dk-absent-from">{sourceLabel(reading.source)}</span>}
      </p>
      <p className="dk-absent-why">{reading.reason}</p>
      {step ? (
        <details className="dk-seo-step">
          <summary>
            <Icon name="arrow-right" size={14} />
            <span>The step that connects it</span>
          </summary>
          <p>{step}</p>
        </details>
      ) : null}
    </div>
  );
}

/** `Read` for this screen's panels: the value, or `PanelAbsent`. */
export function SeoRead<T>({ reading, children }: { reading: Reading<T>; children: (value: T, reading: OkReading<T>) => ReactNode }) {
  if (reading.state === "ok") return <>{children(reading.value, reading)}</>;
  return <PanelAbsent reading={reading} />;
}
