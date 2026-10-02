import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import { cx } from "@/lib/cx";
import { DASH, sourceLabel } from "@/lib/format";
import { Icon } from "./icons";
import { Tooltip } from "./Tooltip";
import "./read.css";

/** A reading that has its value. */
export type OkReading<T> = Extract<Reading<T>, { state: "ok" }>;
/** A reading that has none, and says why. */
export type AbsentReading = Exclude<Reading<unknown>, { state: "ok" }>;

/**
 *   panel   fills a panel's body: what is missing, why, and the step to take
 *   tile    fits where a tile's figure would be: two short lines, the rest on hover
 *   inline  a dash in a table cell or a sentence, the reason on hover
 */
export type AbsentForm = "panel" | "tile" | "inline";

export interface ReadProps<T> {
  reading: Reading<T>;
  form?: AbsentForm;
  /** Drawn only when the reading is `ok`. */
  children: (value: T, reading: OkReading<T>) => ReactNode;
}

/**
 * The one way a screen shows a figure that may not exist.
 *
 *   <Read reading={data.visitors} form="tile">
 *     {(stat) => <b>{num(stat.value)}</b>}
 *   </Read>
 *
 * `ok`: the children, with the value. `waiting` or `off`: the quiet absent
 * state in the form asked for, in the source's own words. There is no third
 * path, and no way to get a zero out of a reading that has no value.
 */
export function Read<T>({ reading, form = "panel", children }: ReadProps<T>) {
  if (reading.state === "ok") return <>{children(reading.value, reading)}</>;
  return <Absent reading={reading} form={form} />;
}

/**
 * What is missing, why, and what would connect it. Drawn by `Read`; used on
 * its own where a screen lays the absent state out itself.
 */
export function Absent({ reading, form = "panel", className }: { reading: AbsentReading; form?: AbsentForm; className?: string }) {
  const waiting = reading.state === "waiting";
  const step = reading.state === "off" ? reading.step : undefined;
  const from = reading.source === "none" ? null : sourceLabel(reading.source);
  /* "Waiting" is a source that is connected and has nothing to say yet.
     "Not available" is a source that is not connected or cannot give this. */
  const head = waiting ? "Nothing yet" : "Not available";

  if (form === "inline") {
    return (
      <Tooltip
        text={
          <>
            <b className="dk-absent-tip-head">
              {head}
              {from ? ` · ${from}` : ""}
            </b>
            {reading.reason}
            {step ? <span className="dk-absent-tip-step">{step}</span> : null}
          </>
        }
      >
        <span className={cx("dk-absent-inline", className)} tabIndex={0}>
          <span aria-hidden>{DASH}</span>
          <span className="dk-sr">
            {head}. {reading.reason} {step ?? ""}
          </span>
        </span>
      </Tooltip>
    );
  }

  if (form === "tile") {
    return (
      <Tooltip
        text={
          <>
            {reading.reason}
            {step ? <span className="dk-absent-tip-step">{step}</span> : null}
          </>
        }
      >
        <span className={cx("dk-absent", "dk-absent--tile", className)} tabIndex={0}>
          <span className="dk-absent-head">
            <Icon name={waiting ? "hourglass" : "minus"} size={14} />
            {head}
          </span>
          <span className="dk-absent-why">{reading.reason}</span>
        </span>
      </Tooltip>
    );
  }

  return (
    <div className={cx("dk-absent", "dk-absent--panel", className)}>
      <span className="dk-absent-mark" aria-hidden>
        <Icon name={waiting ? "hourglass" : "minus"} size={18} />
      </span>
      <p className="dk-absent-head">
        {head}
        {from ? <span className="dk-absent-from">{from}</span> : null}
      </p>
      <p className="dk-absent-why">{reading.reason}</p>
      {step ? (
        <p className="dk-absent-step">
          <Icon name="arrow-right" size={14} />
          <span>{step}</span>
        </p>
      ) : null}
    </div>
  );
}
