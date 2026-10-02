import Link from "next/link";
import { cx } from "@/lib/cx";
import { Legend } from "./Legend";
import { colorClass, type ChartColor } from "./series";
import "./charts.css";
import "./calendar-month.css";

/** Something that falls on a day: an article published, one scheduled, a draft. */
export interface CalendarMark {
  /** YYYY-MM-DD */
  date: string;
  /** Which kind it is: a `key` from `kinds`. A mark of an unknown kind is not drawn. */
  kind: string;
  /** What it is, for the day's tooltip: the article's title. */
  title?: string;
}

/** One kind of mark: its dot's colour and its name in the legend. */
export interface CalendarKind {
  key: string;
  label: string;
  color: ChartColor;
}

export interface CalendarMonthProps {
  /**
   * The month shown: "2026-10". A screen that reads it from its address
   * checks it with `isMonth` first (and builds the previous and next links
   * from the checked value). One that is still not a month is replaced by
   * the month of `today`, with a line saying so; without `today` the
   * calendar says it has no month to show.
   */
  month: string;
  /** Today as YYYY-MM-DD by the studio's clock (`zurich(new Date())?.key`). It gets the green outline. Left out, no day is outlined. */
  today?: string;
  marks: readonly CalendarMark[];
  /** The kinds, in the order the legend lists them. */
  kinds: readonly CalendarKind[];
  /** Where the arrows and "Today" go. A page reads the month from its address, so these are links, not handlers. Left out, the control is not drawn. */
  prevHref?: string;
  nextHref?: string;
  todayHref?: string;
  /** Where a day goes when clicked: the list filtered to that day. Left out, days are not links. */
  dayHref?: (date: string) => string;
  className?: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n: number) => String(n).padStart(2, "0");
/* At most this many dots under a day; more are counted. */
const DOTS = 3;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Whether a value is a month the calendar can show: "YYYY-MM", with a month
 * from 01 to 12. For a `?month=` read from the address, which can be stale
 * or typed by hand: `isMonth(asked) ? asked : today.slice(0, 7)`.
 */
export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH.test(value);
}

/**
 * "2026-10" moved by `by` months: the address of the previous or next month.
 * A value that is not a month comes back as it is, so check it with
 * `isMonth` before building links from it.
 */
export function shiftMonth(month: string, by: number): string {
  const m = MONTH.exec(month);
  if (!m) return month;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * A month as a grid, Monday first, with a dot under each day for what falls
 * on it: the boards' Content calendar.
 *
 *   <CalendarMonth month="2026-10" today={today} marks={marks} kinds={KINDS}
 *     prevHref="?month=2026-09" nextHref="?month=2026-11" todayHref="?" />
 *
 * The days of the neighbouring months that fill the first and last week are
 * shown dimmed and carry their marks too, since a week does not stop at a
 * month's edge. A day with more than three marks shows three dots and a
 * count. A month with no marks is an empty grid, which is the truth.
 */
export function CalendarMonth({ month, today, marks, kinds, prevHref, nextHref, todayHref, dayHref, className }: CalendarMonthProps) {
  /* A month that is not one is never drawn as some other month without a word. */
  const own = isMonth(month) ? month : null;
  const todays = today && /^\d{4}-\d{2}-\d{2}$/.test(today) && isMonth(today.slice(0, 7)) ? today.slice(0, 7) : null;
  const shown = own ?? todays;
  if (!shown) {
    return (
      <div className={cx("dk-cal", className)}>
        <p className="dk-chart-note">This address names no month, so there is no calendar to show.</p>
      </div>
    );
  }
  const m = MONTH.exec(shown)!;
  const year = +m[1]!;
  const mon = +m[2]! - 1;

  /* Monday first: JavaScript's Sunday is 0, so shift by six. */
  const lead = (new Date(Date.UTC(year, mon, 1)).getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(year, mon + 1, 0)).getUTCDate();
  const cells = Math.ceil((lead + length) / 7) * 7;

  const byDay = new Map<string, CalendarMark[]>();
  for (const mark of marks) {
    const list = byDay.get(mark.date);
    if (list) list.push(mark);
    else byDay.set(mark.date, [mark]);
  }
  const kind = new Map(kinds.map((k) => [k.key, k]));

  const days = Array.from({ length: cells }, (_, i) => {
    const d = new Date(Date.UTC(year, mon, 1 - lead + i));
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const here = (byDay.get(date) ?? []).filter((mk) => kind.has(mk.kind));
    return { date, day: d.getUTCDate(), outside: d.getUTCMonth() !== mon, here };
  });

  return (
    <div className={cx("dk-cal", className)}>
      <div className="dk-cal-head">
        <h3 className="dk-cal-title">
          {MONTHS[mon]} {year}
        </h3>
        {(todayHref || prevHref || nextHref) && (
          <nav className="dk-cal-nav" aria-label="Month">
            {todayHref && (
              <Link className="dk-cal-btn dk-cal-btn--text" href={todayHref} scroll={false} prefetch={false}>
                Today
              </Link>
            )}
            {prevHref && (
              <Link className="dk-cal-btn" href={prevHref} scroll={false} prefetch={false} aria-label="Previous month">
                <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <path d="M7.5 2.5 4 6l3.5 3.5" />
                </svg>
              </Link>
            )}
            {nextHref && (
              <Link className="dk-cal-btn" href={nextHref} scroll={false} prefetch={false} aria-label="Next month">
                <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <path d="M4.5 2.5 8 6 4.5 9.5" />
                </svg>
              </Link>
            )}
          </nav>
        )}
      </div>

      {!own && <p className="dk-cal-note">The month asked for is not a month; this is the current one.</p>}

      <div className="dk-cal-week" aria-hidden="true">
        {WEEK.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <ol className="dk-cal-grid">
        {days.map(({ date, day, outside, here }) => {
          const said = here.length === 0 ? "" : `: ${here.map((mk) => (mk.title ? `${kind.get(mk.kind)!.label}, ${mk.title}` : kind.get(mk.kind)!.label)).join("; ")}`;
          const body = (
            <>
              <span className="dk-cal-num">{day}</span>
              <span className="dk-cal-dots">
                {here.slice(0, DOTS).map((mk, i) => (
                  <i key={i} className={colorClass(kind.get(mk.kind)!.color)} />
                ))}
                {here.length > DOTS && <b>+{here.length - DOTS}</b>}
              </span>
              <span className="dk-chart-sr">{said}</span>
            </>
          );
          return (
            <li key={date} className="dk-cal-day" data-outside={outside ? "" : undefined} data-today={date === today ? "" : undefined} title={here.length ? `${day} ${MONTHS[+date.slice(5, 7) - 1]}${said}` : undefined}>
              {dayHref ? (
                <Link className="dk-cal-cell" href={dayHref(date)} prefetch={false} aria-current={date === today ? "date" : undefined}>
                  {body}
                </Link>
              ) : (
                <span className="dk-cal-cell" aria-current={date === today ? "date" : undefined}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <Legend className="dk-cal-legend" items={kinds.map((k) => ({ label: k.label, color: k.color }))} />
    </div>
  );
}
