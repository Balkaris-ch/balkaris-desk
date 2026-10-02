import Form from "next/form";
import type { CompareAsk, CompareResult, Comparison, ExperimentsPayload, MetricKey, MetricResult, Verdict } from "@/contract/experiments";
import { Absent } from "@/components/ui/Read";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { Tabs } from "@/components/ui/Tabs";
import { Info } from "@/components/ui/Tooltip";
import { Legend } from "@/components/charts/Legend";
import { duration, fullDate, num } from "@/lib/format";
import { CompareChart } from "./CompareChart";
import { ChangeOrDate, SaveForm } from "./forms";
import { to, type Here } from "./href";

const METRIC_TABS: { key: MetricKey; label: string }[] = [
  { key: "visitors", label: "Visitors" },
  { key: "engagement", label: "Engagement time" },
  { key: "forms", label: "Forms started" },
  { key: "enquiries", label: "Enquiries sent" },
];

const VERDICT: Record<Verdict, { text: string; tone: "good" | "bad" | "quiet" | "info"; icon: IconName }> = {
  higher: { text: "Higher after", tone: "good", icon: "arrow-up" },
  lower: { text: "Lower after", tone: "bad", icon: "arrow-down" },
  unclear: { text: "No clear difference", tone: "info", icon: "minus" },
  "too-few": { text: "Too few to say", tone: "quiet", icon: "hourglass" },
};

/** "12 Sep" or "12–18 Sep" or "28 Sep – 4 Oct": a window in the fewest words. */
function stretch(a: string, b: string): string {
  const [da, db] = [fullDate(a).split(" "), fullDate(b).split(" ")];
  if (a === b) return `${da[0]} ${da[1]}`;
  if (da[1] === db[1] && da[2] === db[2]) return `${da[0]}–${db[0]} ${db[1]}`;
  return `${da[0]} ${da[1]} – ${db[0]} ${db[1]}`;
}

/** A metric's two window figures in its unit. */
function shown(m: MetricResult, v: number): string {
  if (m.unit === "s") return duration(v * 1000);
  return num(v);
}

/** The level each window's line is drawn at: what the comparison compares, per day. */
function levels(m: MetricResult, r: CompareResult): { before: number | null; after: number | null } {
  if (m.key === "visitors") return { before: m.perDayBefore, after: m.perDayAfter };
  if (m.key === "engagement") return { before: m.before, after: m.after };
  return { before: m.before / r.days, after: m.after / r.days };
}

function MetricItem({ m, on, href }: { m: MetricResult; on: boolean; href: string }) {
  const v = VERDICT[m.verdict];
  return (
    <li className="dk-experiments-metric" data-on={on ? "" : undefined}>
      <div className="dk-experiments-metric-head">
        <Go href={href} scroll={false} replace className="dk-experiments-metric-label">
          {m.label}
        </Go>
        <Info text={m.definition} label={`What ${m.label.toLowerCase()} is`} />
        <Chip tone={v.tone} icon={v.icon} className="dk-experiments-verdict">
          {v.text}
        </Chip>
      </div>
      <p className="dk-experiments-figures dk-num">
        <span className="dk-experiments-figure-before">{shown(m, m.before)}</span>
        <Icon name="arrow-right" size={14} />
        <span className="dk-experiments-figure-after">{shown(m, m.after)}</span>
        {m.unit === "s" ? <span className="dk-experiments-unit">per visitor</span> : null}
        {m.perDayBefore !== null && m.perDayAfter !== null ? (
          <span className="dk-experiments-unit">
            {num(m.perDayBefore, 1)} → {num(m.perDayAfter, 1)} a day
          </span>
        ) : null}
        {m.percent !== null ? (
          <span className="dk-experiments-unit">
            {m.percent > 0 ? "+" : m.percent < 0 ? "−" : "±"}
            {num(Math.abs(m.percent), 1)}%
          </span>
        ) : null}
      </p>
      <p className="dk-experiments-says">
        {m.says} <Info text={m.method} label="How this was worked out" />
      </p>
    </li>
  );
}

function Caveats({ r, ask }: { r: CompareResult; ask: CompareAsk }) {
  const page = ask.page;
  const same = r.others.filter((o) => o.samePage).length;
  const listed = (page ? r.others.filter((o) => o.samePage) : r.others).slice(0, 3);
  const theDay = r.onTheDay ? (
    <>
      {" "}
      {num(r.onTheDay)} more {r.onTheDay === 1 ? "was" : "were"} made on {stretch(r.changeDay, r.changeDay)}, the day left out of both windows.
    </>
  ) : null;
  return (
    <section className="dk-experiments-caveats" aria-label="What this comparison can and cannot tell you">
      <h3 className="dk-experiments-caveats-title">What this can and cannot tell you</h3>
      <ul className="dk-experiments-caveats-list">
        <li>
          <b>It is not an experiment.</b> Every visitor saw the same site on each day. Season, campaigns, a post on LinkedIn and the mix of weekdays move these figures too, and nothing here can separate them from the change.
        </li>
        {r.others.length ? (
          <li>
            <b>
              {num(r.others.length)} other change{r.others.length === 1 ? " was" : "s were"} shipped on the days compared
            </b>
            {page ? `, ${same ? num(same) : "none"} of them to ${page}` : ""}.{theDay}{" "}
            {listed.length ? (
              <span className="dk-experiments-quiet">
                {listed.map((o, i) => (
                  <span key={o.sha}>
                    {i ? "; " : ""}
                    {fullDate(o.day).split(" ").slice(0, 2).join(" ")}: {o.subject}
                  </span>
                ))}
                {(page ? same : r.others.length) > listed.length ? "; …" : ""}
              </span>
            ) : null}
          </li>
        ) : (
          <li>
            <b>No other change</b> was shipped on the days compared.{theDay}
          </li>
        )}
        {ask.change.kind === "commit" ? (
          <li>
            <b>The change is placed on the day it was committed</b>, in GA4&apos;s time zone. When it was pushed and went live is not known here: a commit pushed on a later day went live later than the chart marks it.
          </li>
        ) : null}
        {r.shortened ? (
          <li>
            <b>Shorter than asked.</b> {r.shortened}
          </li>
        ) : null}
        {!r.sameWeekdays ? (
          <li>
            <b>Different weekdays.</b> Each window holds {num(r.days)} day{r.days === 1 ? "" : "s"}, so the two do not hold the same weekdays. Windows of 7, 14 or 28 days do.
          </li>
        ) : null}
        <li>
          <b>Consenting visitors only.</b> GA4 counts the visitors who accept the cookie banner, so every figure here is an undercount.
        </li>
        {r.provisional ? (
          <li>
            <b>Still being processed.</b> GA4 may still change the last {r.provisional === 1 ? "day" : `${num(r.provisional)} days`} of the after window.
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function Result({ r, c, now }: { r: CompareResult; c: Comparison; now: Here }) {
  const metric = c.ask.metric;
  const m = r.metrics.find((x) => x.key === metric) ?? r.metrics[0]!;
  const points = r.series[m.key];
  return (
    <>
      <div className="dk-experiments-result">
        <div className="dk-experiments-plot">
          <Tabs
            size="sm"
            label="The figure the chart draws"
            active={m.key}
            items={METRIC_TABS.map((t) => ({ key: t.key, label: t.label, href: to(now, { metric: t.key === "visitors" ? null : t.key }) }))}
          />
          <CompareChart points={points} unit={m.unit} label={`${m.label}, day by day, before and after the change`} means={levels(m, r)} provisional={r.provisional} />
          <div className="dk-experiments-legend">
            <Legend
              items={[
                { label: `Before · ${stretch(r.before.start, r.before.end)}`, color: "s2" },
                { label: `After · ${stretch(r.after.start, r.after.end)}`, color: "s1" },
                { label: `Change · ${stretch(r.changeDay, r.changeDay)}, in neither`, color: "grey", mark: "dash" },
                { label: m.key === "engagement" ? "Each window's time per visitor, in its colour" : "Each window's daily average, in its colour", color: "grey", mark: "dash" },
              ]}
            />
          </div>
          <Caveats r={r} ask={c.ask} />
        </div>
        <ul className="dk-experiments-metrics" aria-label="The four figures, before and after">
          {r.metrics.map((x) => (
            <MetricItem key={x.key} m={x} on={x.key === m.key} href={to(now, { metric: x.key === "visitors" ? null : x.key })} />
          ))}
        </ul>
      </div>
    </>
  );
}

function SaveDialog({ c, now }: { c: Comparison; now: Here }) {
  const ask = c.ask;
  const suggested = ask.change.kind === "commit" ? ask.change.subject.slice(0, 80) : `Around ${fullDate(ask.change.day)}`;
  const carry: Record<string, string> = {
    ...(ask.change.kind === "commit" ? { sha: ask.change.sha } : { day: ask.change.day }),
    page: ask.page ?? "",
    window: String(ask.window),
    range: now.range ?? "",
    metric: ask.metric === "visitors" ? "" : ask.metric,
  };
  return (
    <Dialog
      title="Save this comparison"
      description="Only what is asked is kept: the change, the page and the window. Its figures are worked out again every time it is opened, so they never go stale."
      trigger={{ label: "Save comparison", variant: "primary", size: "sm", icon: "bookmark" }}
    >
      <SaveForm suggested={suggested} carry={carry} />
    </Dialog>
  );
}

/** The line under the panel's title: what is being compared, in words. */
function askLine(c: Comparison): string {
  const a = c.ask;
  const what =
    a.change.kind === "commit"
      ? a.change.subject
        ? `${a.change.short} · ${a.change.subject} · ${fullDate(a.change.at)} · ${a.change.author}`
        : `${a.change.short} · not on the branch as the desk has read it`
      : `Around ${fullDate(a.change.day)}, a date typed`;
  return `${what} · ${a.page ?? "the whole site"} · up to ${a.window} days each side`;
}

/**
 * The comparison: the form that asks for one, the day-by-day chart with the
 * change marked, the four figures with what can be said about each, and what
 * such a comparison cannot conclude.
 */
export function CompareCard({ data, now }: { data: ExperimentsPayload; now: Here }) {
  const c = data.comparison;
  const ask = c?.ask ?? null;
  const pages = data.pages.state === "ok" ? data.pages.value : [];
  const touched = pages.filter((p) => p.touched);
  const rest = pages.filter((p) => !p.touched);
  const formKey = ask ? `${ask.change.kind === "commit" ? ask.change.sha : ask.change.day}|${ask.page ?? ""}|${ask.window}` : "none";
  /* Saving is offered only for a comparison that has figures, or will have them once GA4 has the days: never for one that cannot exist. */
  const savable = c && c.result.state !== "off" ? c : null;

  return (
    <Card
      id="compare"
      className="dk-experiments-compare"
      title="Before and after"
      icon="flask"
      sub={c ? askLine(c) : "Pick a change in Recent changes, or type a date, and the same number of whole days before and after are put side by side."}
      info="A comparison of the days before a change with the same number of days after it, from GA4. The day of the change itself is left out of both. It is not a split test: the website has no machinery for one."
      right={savable ? <SaveDialog c={savable} now={now} /> : undefined}
      divided
    >
      {c?.saved ? (
        <p className="dk-experiments-saved-line">
          <Icon name="bookmark" size={14} />
          <span>
            Saved as <b>{c.saved.name}</b>
            {c.saved.note ? ` · ${c.saved.note}` : ""}
          </span>
        </p>
      ) : null}

      <div key={formKey}>
        <Form action="/experiments" scroll={false} prefetch={false} className="dk-experiments-form">
          {now.range ? <input type="hidden" name="range" value={now.range} /> : null}
          {now.metric ? <input type="hidden" name="metric" value={now.metric} /> : null}
          <ChangeOrDate
            choices={data.choices}
            empty={data.choices.length ? "Pick a commit, or type a date" : "No commit in the last 90 days"}
            change={ask?.change.kind === "commit" ? ask.change.sha : ""}
            date={ask?.change.kind === "date" ? ask.change.day : ""}
          />
          <Field label="Page" className="dk-experiments-field-page" hint={data.pages.state !== "ok" ? `Only the whole site for now: ${data.pages.reason}` : undefined}>
            <span className="dk-experiments-select">
              <select name="page" aria-label="Page" defaultValue={ask?.page ?? ""}>
                <option value="">The whole site</option>
                {ask?.page && !pages.some((p) => p.path === ask.page) ? <option value={ask.page}>{ask.page}</option> : null}
                {touched.length ? (
                  <optgroup label="Touched by this change">
                    {touched.map((p) => (
                      <option key={p.path} value={p.path}>
                        {p.path}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {rest.length ? (
                  <optgroup label="Every page the crawl knows">
                    {rest.map((p) => (
                      <option key={p.path} value={p.path}>
                        {p.path}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <Icon name="chevron-down" size={14} />
            </span>
          </Field>
          <Field label="Days each side" className="dk-experiments-field-window">
            <Select
              name="window"
              label="Days each side"
              size="md"
              defaultValue={String(ask?.window ?? now.window ?? 14)}
              options={[
                { value: "7", label: "7 days" },
                { value: "14", label: "14 days" },
                { value: "28", label: "28 days" },
              ]}
            />
          </Field>
          <Button type="submit" variant="quiet" icon="flask" className="dk-experiments-go">
            Compare
          </Button>
        </Form>
      </div>

      {!c ? (
        <div className="dk-experiments-prompt">
          <span className="dk-experiments-prompt-mark" aria-hidden>
            <Icon name="flask" size={18} />
          </span>
          <p className="dk-experiments-prompt-head">Nothing is being compared yet</p>
          <p className="dk-experiments-prompt-why">
            Press Compare on a change, or pick one above. The day of the change is left out, and the days on each side are counted from GA4.
            {data.measuredFrom ? ` GA4 has measured whole days since ${fullDate(data.measuredFrom)}: a change before then has nothing to compare with.` : ""}
          </p>
        </div>
      ) : c.result.state === "ok" ? (
        <Result r={c.result.value} c={c} now={now} />
      ) : (
        <div className="dk-experiments-absent">
          <Absent reading={c.result} />
        </div>
      )}

      {c && c.result.state === "ok" ? (
        <div className="dk-experiments-foot dk-experiments-foot--inset">
          <Stamp reading={c.result} />
          <span className="dk-experiments-quiet">
            {c.result.value.days} whole day{c.result.value.days === 1 ? "" : "s"} each side · {stretch(c.result.value.before.start, c.result.value.before.end)} against {stretch(c.result.value.after.start, c.result.value.after.end)}
          </span>
        </div>
      ) : null}
    </Card>
  );
}
