import type { AuditCounts, AuditDetail, AuditKept, AuditsAnswer } from "@/contract/seo/common";
import { api, ask } from "@/lib/api";
import { cx } from "@/lib/cx";
import { clock, DASH, duration, fullDate, num } from "@/lib/format";
import { Badge, Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { AuditLive, AuditStart, STEP_SAYS } from "./ListAct";
import { AUDITS_HREF, auditHref } from "./pages";
import { SeoRefused } from "./Refused";
import "./lists.css";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const STATE = {
  running: { label: "Running", tone: "info" },
  done: { label: "Done", tone: "good" },
  failed: { label: "A step failed", tone: "warn" },
} as const;

/** The section's headline counts, in the order an audit's table lists them. */
const COUNTS: { key: keyof AuditCounts; label: string; better: "up" | "down" }[] = [
  { key: "score", label: "Site score (the desk’s own rules)", better: "up" },
  { key: "pages", label: "Pages the crawl read", better: "up" },
  { key: "critical", label: "Critical findings", better: "down" },
  { key: "warning", label: "Warnings", better: "down" },
  { key: "opportunities", label: "Open opportunities", better: "down" },
  { key: "indexed", label: "Sitemap addresses in Google’s index", better: "up" },
  { key: "notIndexed", label: "Not in Google’s index", better: "down" },
  { key: "keywords", label: "Tracked phrases", better: "up" },
];

const when = (iso: string): string => `${fullDate(iso)}, ${clock(iso)}`;
const took = (a: Pick<AuditKept, "startedAt" | "finishedAt">): string => (a.finishedAt ? duration(Date.parse(a.finishedAt) - Date.parse(a.startedAt)) : "still running");
const tally = (a: AuditKept): string => {
  const n = (s: string) => a.steps.filter((x) => x.state === s).length;
  const done = n("done");
  const skipped = n("skipped");
  const failed = n("failed");
  return [`${done} run`, skipped ? `${skipped} skipped` : null, failed ? `${failed} failed` : null].filter(Boolean).join(", ");
};

/** "235 → 241", or the one figure when nothing changed; a dash where nothing was read. */
function moved(before: number | null, after: number | null | undefined): string {
  if (after === undefined) return before === null ? DASH : num(before);
  if (before === null && after === null) return DASH;
  if (before === after) return num(before);
  return `${before === null ? DASH : num(before)} → ${after === null ? DASH : num(after)}`;
}

/**
 * THE AUDITS KEPT (/seo/list/audits): every "Run full SEO audit" the desk
 * remembers (the newest sixty), with what each ran and the section's
 * headline counts as it started and as it ended; ?open=<id> shows one audit
 * with what changed while it ran, row by row, and its export. The audit
 * running now is followed live. One request (GET /api/v1/seo/audits) draws
 * the page; the head's button and the buttons here ask for a new audit.
 */
export async function AuditsList({ q }: { q: Search }) {
  const open = one(q.open)?.trim().slice(0, 80) || undefined;
  const got = await ask<AuditsAnswer>("/api/v1/seo/audits", { open });
  if (!got.ok) {
    if (got.kind === "signed-out" || got.kind === "off") await api<AuditsAnswer>("/api/v1/seo/audits", { open });
    if (got.kind === "forbidden") return <SeoRefused message={got.message} />;
    return (
      <Card title="SEO audits" icon="list">
        <Empty icon="alert" title="The desk did not answer for this list">
          {got.message}
        </Empty>
      </Card>
    );
  }
  const d = got.value;
  const running = d.audits.find((a) => a.state === "running") ?? null;
  const full = d.steps.filter((s) => !s.deep);
  const deep = d.steps.filter((s) => s.deep);

  return (
    <div className="dk-seo-lists">
      {open ? (
        d.open ? (
          <Opened audit={d.open} />
        ) : (
          <Card title="The audit" icon="list">
            <Empty icon="search" title="No audit is kept under that time" compact>
              The desk keeps the newest sixty audits. The list below has every one it still has.
            </Empty>
          </Card>
        )
      ) : null}

      {running && running.id !== d.open?.id ? (
        <Card title="Running now" icon="refresh" sub={`Asked for by ${running.by} at ${clock(running.startedAt)}.`} right={<LinkButton href={running.href} size="sm">Its page</LinkButton>}>
          <AuditLive initial={running} />
        </Card>
      ) : null}

      <Card
        title="Every audit"
        icon="list"
        count={num(d.audits.length)}
        sub="The newest first. Each counts the section as it started and as it ended."
        flush={d.audits.length > 0}
        right={
          <span className="dk-seo-lists-buttons">
            <AuditStart deep={false} />
          </span>
        }
      >
        {d.audits.length ? (
          <div className="dk-table-wrap">
            <table className="dk-table dk-table--caps dk-seo-lists-table">
              <caption className="dk-sr">Every SEO audit the desk keeps, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">By</th>
                  <th scope="col">State</th>
                  <th scope="col">Steps</th>
                  <th scope="col" className="dk-num">
                    Open opportunities
                  </th>
                  <th scope="col" className="dk-num">
                    Indexed
                  </th>
                  <th scope="col" className="dk-num">
                    New findings
                  </th>
                  <th scope="col">Took</th>
                </tr>
              </thead>
              <tbody>
                {d.audits.map((a) => (
                  <tr key={a.id} className={cx(a.id === d.open?.id && "dk-seo-lists-row--on")}>
                    <td>
                      <Go href={auditHref(a.id)}>{when(a.startedAt)}</Go>
                      {a.deep ? <Chip className="dk-seo-lists-deep">Deep</Chip> : null}
                    </td>
                    <td>{a.by}</td>
                    <td>
                      <Badge tone={STATE[a.state].tone} dot>
                        {STATE[a.state].label}
                      </Badge>
                    </td>
                    <td>{tally(a)}</td>
                    <td className="dk-num">{moved(a.before.opportunities, a.after?.opportunities)}</td>
                    <td className="dk-num">{moved(a.before.indexed, a.after?.indexed)}</td>
                    <td className="dk-num">{a.changes ? num(a.changes.findingsNew) : DASH}</td>
                    <td>{took(a)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="play" title="No audit yet" compact>
            “Run full SEO audit” at the top of every SEO page starts one; each is kept here with what it found.
          </Empty>
        )}
      </Card>

      <Card title="What an audit runs" icon="layers" sub="One step after the other, on the desk’s one scheduler. Every step only reads: nothing on the website changes.">
        <div className="dk-seo-lists-plan">
          <div>
            <h3 className="dk-seo-lists-plan-head">Every full audit</h3>
            <ol className="dk-seo-lists-plan-list">
              {full.map((s) => (
                <li key={s.job}>{s.title}</li>
              ))}
            </ol>
            <p className="dk-seo-lists-plan-note">
              A step whose job finished well moments ago uses that run (the crawl within ten minutes, Search Console’s figures within the hour, PageSpeed within twelve hours). Google’s index check runs again whenever its last day was cut short.
            </p>
          </div>
          {deep.length ? (
            <div>
              <h3 className="dk-seo-lists-plan-head">A deep audit adds</h3>
              <ol className="dk-seo-lists-plan-list">
                {deep.map((s) => (
                  <li key={s.job}>{s.title}</li>
                ))}
              </ol>
              <p className="dk-seo-lists-plan-note">Slow and budgeted: the research spends Google Autocomplete’s weekly allowance, and competitors’ sites are read two seconds apart.</p>
              <AuditStart deep />
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

/** One audit: its steps, the counts before and after, and what changed while it ran. */
function Opened({ audit: a }: { audit: AuditDetail }) {
  const c = a.changes;
  const f = a.found;
  return (
    <>
      <Card
        title={`Audit of ${when(a.startedAt)}`}
        icon="flag"
        sub={`${a.deep ? "A deep audit" : "A full audit"}, asked for by ${a.by}. ${a.finishedAt ? `Ended ${when(a.finishedAt)}, after ${took(a)}.` : "Still running."}`}
        className="dk-seo-lists-opened"
        right={
          <span className="dk-seo-lists-buttons">
            <LinkButton href={`/api/v1/seo/audits/${encodeURIComponent(a.id)}/export.csv`} icon="download" size="sm" title="Its steps, counts and findings as CSV">
              Export
            </LinkButton>
            <LinkButton href={AUDITS_HREF} size="sm" icon="x" aria-label="Close this audit" />
          </span>
        }
      >
        {a.state === "running" ? <AuditLive initial={a} /> : null}
        <div className="dk-seo-lists-audit">
          <div>
            <h3 className="dk-seo-lists-plan-head">Steps</h3>
            <ol className="dk-seo-lists-steps">
              {a.steps.map((s) => (
                <li key={s.job} className={cx("dk-seo-lists-step", `dk-seo-lists-step--${s.state}`)}>
                  <span className="dk-seo-lists-step-title">{s.title}</span>
                  <span className="dk-seo-lists-step-state">
                    {STEP_SAYS[s.state]}
                    {s.startedAt && s.endedAt ? ` · ${duration(Date.parse(s.endedAt) - Date.parse(s.startedAt))}` : ""}
                  </span>
                  {s.note ? <span className="dk-seo-lists-step-note">{s.note}</span> : null}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="dk-seo-lists-plan-head">Before and after</h3>
            <table className="dk-table dk-table--caps dk-seo-lists-counts">
              <caption className="dk-sr">The section’s counts as the audit started and as it ended</caption>
              <thead>
                <tr>
                  <th scope="col">Count</th>
                  <th scope="col" className="dk-num">
                    Before
                  </th>
                  <th scope="col" className="dk-num">
                    After
                  </th>
                </tr>
              </thead>
              <tbody>
                {COUNTS.map((k) => (
                  <tr key={k.key}>
                    <th scope="row">{k.label}</th>
                    <td className="dk-num">{a.before[k.key] === null ? DASH : num(a.before[k.key])}</td>
                    <td className="dk-num">{!a.after ? "running" : a.after[k.key] === null ? DASH : num(a.after[k.key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {c ? (
              <p className="dk-seo-lists-plan-note">
                While it ran: {num(c.opportunitiesNew)} new {c.opportunitiesNew === 1 ? "opportunity" : "opportunities"}, {num(c.opportunitiesCleared)} cleared, {num(c.findingsNew)} new crawl{" "}
                {c.findingsNew === 1 ? "finding" : "findings"}, {num(c.indexedNew)} newly indexed, {num(c.indexedLost)} dropped from the index, {num(c.keywordsNew)} new{" "}
                {c.keywordsNew === 1 ? "phrase" : "phrases"}.
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      {a.finishedAt ? (
        <div className="dk-seo-lists-found">
          <Found title="New opportunities" empty="The rules found nothing new while it ran." rows={f.opportunities.map((o) => ({ key: o.id, href: o.href, title: o.title, sub: o.subject }))} />
          <Found title="Cleared opportunities" empty="The rules still find every opportunity they found before." rows={f.cleared.map((o) => ({ key: o.id, href: o.href, title: o.title, sub: [o.subject, o.why].filter(Boolean).join(" · ") || null }))} />
          <Found
            title="New crawl findings"
            empty="The crawl found nothing it had not found before."
            rows={f.findings.map((x, i) => ({ key: `${x.rule}:${x.path ?? ""}:${i}`, href: x.path ? `/seo/pages?finding=${encodeURIComponent(x.rule)}&open=${encodeURIComponent(x.path)}` : "/seo/technical#issues", title: x.text, sub: [x.severity, x.path].filter(Boolean).join(" · ") }))}
          />
          <Found title="Google’s index" empty="No page entered or left Google’s index while it ran." rows={f.index.map((x, i) => ({ key: `${x.at}:${i}`, href: "/seo/technical#indexing", title: x.text, sub: `${x.indexed ? "Newly indexed" : "Dropped"} · ${clock(x.at)}` }))} />
        </div>
      ) : null}
    </>
  );
}

/** A short list of what an audit found (fifty at most, as the desk sends them). */
function Found({ title, empty, rows }: { title: string; empty: string; rows: { key: string; href: string; title: string; sub: string | null }[] }) {
  return (
    <Card title={title} count={num(rows.length)}>
      {rows.length ? (
        <ul className="dk-seo-lists-found-list">
          {rows.map((r) => (
            <li key={r.key}>
              <Go href={r.href}>{r.title}</Go>
              {r.sub ? <span className="dk-seo-lists-found-sub">{r.sub}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="dk-seo-lists-plan-note">{empty}</p>
      )}
    </Card>
  );
}
