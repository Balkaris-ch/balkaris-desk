import type { Reading, SourceId } from "@/contract/common";
import { cx } from "@/lib/cx";
import { ago, sourceLabel } from "@/lib/format";
import { Tooltip } from "./Tooltip";
import "./stamp.css";

export type StampProps = {
  /** Print the note after the age instead of keeping it for the tooltip. */
  showNote?: boolean;
  className?: string;
} & (
  | {
      /** The reading the figure came from. Nothing is drawn unless it is `ok`. */
      reading: Reading<unknown>;
      source?: undefined;
      asOf?: undefined;
      note?: undefined;
    }
  | {
      reading?: undefined;
      source: SourceId;
      /** ISO time the figure was read. */
      asOf: string;
      /** The caveat that belongs to the figure. */
      note?: string;
    }
);

/**
 * Where a figure comes from and how old it is, in small type: "GA4 · 12 min
 * ago". The reading's note ("consenting visitors only") is the tooltip, and a
 * dotted line under the stamp says there is one.
 *
 * Every figure on a screen should be within sight of one of these.
 */
export function Stamp(props: StampProps) {
  const r = props.reading;
  if (r && r.state !== "ok") return null;
  const source = r ? r.source : props.source;
  const asOf = r ? r.asOf : props.asOf;
  const note = r ? r.note : props.note;
  if (source === undefined || asOf === undefined) return null;

  const body = (
    <span className={cx("dk-stamp", note && !props.showNote && "dk-stamp--noted", props.className)} tabIndex={note && !props.showNote ? 0 : undefined}>
      <span>{sourceLabel(source)}</span>
      <span aria-hidden>·</span>
      {/* The age is worked out when the screen is drawn; a browser a second later may disagree by a minute. */}
      <time dateTime={asOf} suppressHydrationWarning>
        {ago(asOf)}
      </time>
      {note && props.showNote ? (
        <>
          <span aria-hidden>·</span>
          <span>{note}</span>
        </>
      ) : null}
    </span>
  );

  return note && !props.showNote ? <Tooltip text={note}>{body}</Tooltip> : body;
}
