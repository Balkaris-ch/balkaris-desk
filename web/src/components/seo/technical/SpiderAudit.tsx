"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { AuditFacts, AuditIssue, AuditSeverity, SpiderAudit, SpiderAuditListed } from "@/contract/spider";
import { Chip } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { send } from "@/components/operator/send";
import { cx } from "@/lib/cx";
import { bytes, clock, duration, fullDate, num } from "@/lib/format";
import { Mark, Quiet } from "./bits";

/**
 * Audit any page: one page of any public website, the site's own or a
 * competitor's, fetched by the desk server and read the way the crawl reads
 * the site's pages (POST /api/v1/spider/audit, src/cc/site/audit.ts). The
 * answer is drawn here; the server keeps it a day and answers the same
 * address from it, lists the day's audits (GET /api/v1/spider/audits) so one
 * can be reopened by its address (?audit=<url>#audit, a link a person can
 * pass on), and fetches again on "Audit again now" ({ fresh: true }).
 *
 * It goes the way the page's other buttons go (Act.tsx): from the browser to
 * /api/v1 on its own origin, so every refusal arrives as the server's own
 * sentence (400 the address may not be fetched, 429 the hour's audits are
 * spent, 504 given up after 90 seconds) and a slow audit is waited for.
 */

type Got = { ok: true; audit: SpiderAudit } | { ok: false; status: number; message: string };

/** The word before the server's own sentence, by what kind of no it was. */
const NO: Record<number, string> = { 400: "Not audited.", 429: "Not now.", 504: "Given up." };

const chars = (s: string): number => [...s].length;
const when = (iso: string): string => `${fullDate(iso)}, ${clock(iso)}`;

/**
 * `recent`: the audits the server keeps (a day), each with the address that
 * reopens it (?audit=<url>#audit, built by the page), so an answer outlives
 * the tab. `opened`: that one audit, read by the page from the server.
 */
export function AuditCard({ recent = [], opened = null, prefill = "" }: { recent?: (SpiderAuditListed & { href: string })[]; opened?: SpiderAudit | null; prefill?: string }) {
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<Got | null>(opened ? { ok: true, audit: opened } : null);
  /* ?audit=<url> with nothing kept for it (a link from another screen, Competitors' for one): the address is filled in, one press audits it. */
  const [asked, setAsked] = useState<string>(opened?.url ?? prefill);

  const ask = async (url: string, fresh: boolean) => {
    if (busy || !url) return;
    setBusy(true);
    setGot(null);
    setAsked(url);
    const r = await send<SpiderAudit>("/api/v1/spider/audit", fresh ? { url, fresh: true } : { url });
    setBusy(false);
    setGot(r.ok ? { ok: true, audit: r.value } : { ok: false, status: r.status, message: r.message });
  };

  const run = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await ask(String(new FormData(e.currentTarget).get("url") ?? "").trim(), false);
  };

  return (
    <Card
      title="Audit any page"
      icon="search"
      id="audit"
      sub="Reads one page of any public website, the site’s own or a competitor’s, the way the crawl reads the site’s pages."
      info="The desk fetches the one address named (five redirects at most, 15 seconds, the first 2 MB of HTML), reads it as the crawl reads the site’s own pages and applies the crawl’s page rules to it alone: nothing that needs the whole site, such as the sitemap or links from other pages. The same address asked again within a day is answered from the earlier audit. Ten fresh audits an hour for each person, thirty for the whole desk."
      className="dk-seo-technical-audit"
    >
      <form className="dk-seo-technical-audit-form" onSubmit={run}>
        <Field label="Address">
          <Input name="url" inputMode="url" autoComplete="off" spellCheck={false} required maxLength={2000} defaultValue={asked} key={asked} />
        </Field>
        <Button type="submit" variant="primary" icon="search" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Auditing…" : "Audit"}
        </Button>
      </form>
      <Quiet>A public web address; without http or https, https is assumed. Private, local and internal addresses are refused.</Quiet>

      {busy ? (
        <p className="dk-seo-technical-audit-wait" role="status">
          <Icon name="hourglass" size={14} />
          Reading the page. It takes up to 15 seconds, longer while the crawl is reading the site.
        </p>
      ) : null}

      {got && !got.ok ? (
        <p className={cx("dk-seo-technical-audit-no", got.status === 429 || got.status === 504 ? "dk-seo-technical-audit-no--warn" : null)} role="alert">
          <Icon name="alert" size={14} />
          <span>
            {NO[got.status] ? <b>{NO[got.status]} </b> : null}
            {got.message}
          </span>
        </p>
      ) : null}

      {got?.ok ? (
        <>
          {got.audit.cached ? (
            <p className="dk-seo-technical-audit-again">
              <span>
                The kept audit of {when(got.audit.at)}: the same address asked within a day is answered from it.
              </span>
              <Button size="sm" variant="quiet" icon="refresh" disabled={busy} onClick={() => void ask(got.audit.url, true)}>
                Audit again now
              </Button>
            </p>
          ) : null}
          <Result a={got.audit} />
        </>
      ) : null}

      {recent.length ? (
        <details className="dk-seo-technical-more">
          <summary>Audited in the last day ({num(recent.length)})</summary>
          <ul className="dk-seo-technical-audit-recent">
            {recent.map((r) => (
              <li key={r.url}>
                <Go href={r.href} className="dk-seo-technical-path dk-seo-technical-path--link" title={`Open the kept audit of ${r.url}`}>
                  {r.url.replace(/^https?:\/\//, "")}
                </Go>
                <span className="dk-seo-technical-entries-date dk-num">
                  {r.error ? "no answer" : `${r.status} · ${r.score === null ? "not scored" : `score ${num(r.score)}`}`}
                </span>
                <span className="dk-seo-technical-entries-date">{when(r.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

/* ---------- the answer ---------- */

const statusTone = (s: number): "good" | "warn" | "bad" => (s >= 200 && s < 300 ? "good" : s >= 300 && s < 400 ? "warn" : "bad");

function Result({ a }: { a: SpiderAudit }) {
  return (
    <div className="dk-seo-technical-audit-result">
      <div className="dk-seo-technical-audit-col">
        <Summary a={a} />
        {a.redirects.length ? <Redirects a={a} /> : null}
        {a.facts ? <Findings issues={a.issues} /> : null}
        <Headers headers={a.headers} />
      </div>
      {a.facts ? (
        <div className="dk-seo-technical-audit-col">
          <Facts f={a.facts} />
        </div>
      ) : null}
    </div>
  );
}

function Summary({ a }: { a: SpiderAudit }) {
  return (
    <section className="dk-seo-technical-audit-sum" aria-label="The page">
      <div className="dk-seo-technical-audit-top">
        <div className="dk-seo-technical-audit-where">
          <span className="dk-seo-technical-audit-status">
            <Chip tone={a.status ? statusTone(a.status) : "bad"}>{a.status ? `Answers ${a.status}` : "No answer"}</Chip>
            {a.loop ? <Chip tone="bad">Redirect loop</Chip> : null}
          </span>
          <Go href={a.finalUrl} className="dk-seo-technical-audit-url" title={`Open ${a.finalUrl} in a new tab`}>
            {a.finalUrl}
            <Icon name="external" size={12} />
          </Go>
          {a.finalUrl !== a.url ? <span className="dk-seo-technical-audit-asked">Asked for {a.url}</span> : null}
        </div>
        <p className="dk-seo-technical-audit-score">
          {a.score === null ? (
            <span className="dk-seo-technical-audit-noscore">No score: the page was not read.</span>
          ) : (
            <>
              <b className={cx(a.score < 70 ? "dk-seo-technical-ink-bad" : a.score < 90 ? "dk-seo-technical-ink-warn" : "dk-seo-technical-ink-good")}>{num(a.score)}</b>
              <span>/ 100</span>
            </>
          )}
        </p>
      </div>

      {a.error ? (
        <p className="dk-seo-technical-audit-no" role="status">
          <Icon name="alert" size={14} />
          <span>
            <b>Nothing could be read. </b>
            {a.error}
          </span>
        </p>
      ) : a.unread ? (
        <p className="dk-seo-technical-audit-no dk-seo-technical-audit-no--warn" role="status">
          <Icon name="alert" size={14} />
          <span>
            <b>The page was not read. </b>
            {a.unread}
          </span>
        </p>
      ) : null}

      <dl className="dk-seo-technical-audit-figs">
        <div>
          <dt>First byte</dt>
          <dd className="dk-num">{duration(a.timing.ttfbMs)}</dd>
        </div>
        <div>
          <dt>Whole fetch</dt>
          <dd className="dk-num">{duration(a.timing.totalMs)}</dd>
        </div>
        <div>
          <dt>HTML read</dt>
          <dd className="dk-num">{bytes(a.bytes)}</dd>
        </div>
        <div>
          <dt>Redirects</dt>
          <dd className="dk-num">{num(a.redirects.length)}</dd>
        </div>
      </dl>
      {a.truncated ? <Quiet>The page is larger than the 2 MB the audit reads; the first 2 MB were read.</Quiet> : null}
      <Quiet className="dk-seo-technical-audit-when">
        {a.cached ? `Kept from an audit at ${when(a.at)}: the same address within a day is answered from it, and the site is not asked again.` : `Read at ${when(a.at)}.`}
      </Quiet>
    </section>
  );
}

function Redirects({ a }: { a: SpiderAudit }) {
  return (
    <section className="dk-seo-technical-audit-part" aria-label="Redirects">
      <h3 className="dk-seo-technical-h3">
        Redirect chain
        <span className="dk-seo-technical-h3-n">
          {num(a.redirects.length)} {a.redirects.length === 1 ? "hop" : "hops"}
          {a.loop ? ", in a loop" : ""}
        </span>
      </h3>
      <ol className="dk-seo-technical-audit-hops">
        {a.redirects.map((h, i) => (
          <li key={`${h.url}-${i}`}>
            <Chip tone={statusTone(h.status)}>{h.status}</Chip>
            <span className="dk-seo-technical-audit-mono">{h.url}</span>
            <span className="dk-seo-technical-audit-to">
              <Icon name="arrow-right" size={12} />
              <span className="dk-seo-technical-audit-mono">{h.location ?? "no Location header"}</span>
            </span>
          </li>
        ))}
        {a.loop ? null : (
          <li>
            <Chip tone={a.status ? statusTone(a.status) : "bad"}>{a.status || "—"}</Chip>
            <span className="dk-seo-technical-audit-mono">{a.finalUrl}</span>
          </li>
        )}
      </ol>
    </section>
  );
}

const ORDER: { severity: AuditSeverity; word: string; tone: "bad" | "warn" | "info" }[] = [
  { severity: "critical", word: "Critical", tone: "bad" },
  { severity: "warning", word: "Warnings", tone: "warn" },
  { severity: "opportunity", word: "Opportunities", tone: "info" },
];

/** The crawl's page rules that fired on this page, critical first. */
function Findings({ issues }: { issues: AuditIssue[] }) {
  return (
    <section className="dk-seo-technical-audit-part" aria-label="Findings">
      <h3 className="dk-seo-technical-h3">
        Findings
        <span className="dk-seo-technical-h3-n">{issues.length ? num(issues.length) : "none"}</span>
      </h3>
      {issues.length ? (
        ORDER.map((o) => {
          const rows = issues.filter((x) => x.severity === o.severity);
          if (!rows.length) return null;
          return (
            <div key={o.severity} className="dk-seo-technical-audit-sev">
              <p className="dk-seo-technical-audit-sev-head">
                {o.word} <span className="dk-num">{num(rows.length)}</span>
              </p>
              <ul className="dk-seo-technical-lines">
                {rows.map((x) => (
                  <li key={`${x.rule}-${x.text}`} className="dk-seo-technical-line">
                    <Mark tone={o.tone} />
                    <span className="dk-seo-technical-line-text">
                      <span className="dk-seo-technical-line-label">{x.title}</span>
                      <span className="dk-seo-technical-line-detail">{x.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      ) : (
        <Quiet>None of the crawl’s page rules fired on this page.</Quiet>
      )}
    </section>
  );
}

/* ---------- what the page says ---------- */

function None({ children = "None" }: { children?: ReactNode }) {
  return <span className="dk-seo-technical-audit-none">{children}</span>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dk-seo-technical-audit-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A value read from the page, with its length in characters the way the crawl counts them. */
function Text({ value }: { value: string | null }) {
  if (value === null) return <None />;
  return (
    <>
      <span className="dk-seo-technical-audit-text">{value}</span>
      <span className="dk-seo-technical-audit-len dk-num">
        {num(chars(value))} {chars(value) === 1 ? "character" : "characters"}
      </span>
    </>
  );
}

const Mono = ({ value }: { value: string | null }) => (value === null ? <None /> : <span className="dk-seo-technical-audit-mono">{value}</span>);

function Facts({ f }: { f: AuditFacts }) {
  const og: [string, string | null][] = [
    ["og:title", f.og.title],
    ["og:description", f.og.description],
    ["og:image", f.og.image],
    ["og:type", f.og.type],
    ["og:url", f.og.url],
    ["twitter:card", f.twitter.card],
    ["twitter:image", f.twitter.image],
  ];
  return (
    <section className="dk-seo-technical-audit-part" aria-label="What the page says">
      <h3 className="dk-seo-technical-h3">What the page says</h3>
      <dl className="dk-seo-technical-audit-facts">
        <Fact label="Title">
          <Text value={f.title} />
        </Fact>
        <Fact label="Description">
          <Text value={f.description} />
        </Fact>
        <Fact label="Canonical">
          <Mono value={f.canonical} />
        </Fact>
        <Fact label="Robots meta">
          <Mono value={f.robots} />
        </Fact>
        <Fact label="Language">
          <Mono value={f.lang} />
        </Fact>
        <Fact label={f.h1.length === 1 ? "H1" : `H1 (${num(f.h1.length)})`}>
          {f.h1.length ? (
            <ul className="dk-seo-technical-audit-list">
              {f.h1.map((h, i) => (
                <li key={`${h}-${i}`}>{h || <None>Empty</None>}</li>
              ))}
            </ul>
          ) : (
            <None />
          )}
        </Fact>
        <Fact label="H2">
          {f.h2.length ? (
            <details className="dk-seo-technical-audit-more">
              <summary>
                {num(f.h2.length)} {f.h2.length === 1 ? "subheading" : "subheadings"}
                {f.h2.length >= 40 ? " (the audit keeps the first 40)" : ""}
                <Icon name="chevron-down" size={12} className="dk-seo-technical-cov-chev" />
              </summary>
              <ol className="dk-seo-technical-audit-list">
                {f.h2.map((h, i) => (
                  <li key={`${h}-${i}`}>{h || <None>Empty</None>}</li>
                ))}
              </ol>
            </details>
          ) : (
            <None />
          )}
        </Fact>
        <Fact label="Words">
          <span className="dk-num">{num(f.words)}</span> <span className="dk-seo-technical-audit-len">in its main content</span>
        </Fact>
        <Fact label="Structured data">
          {f.schema.types.length ? (
            <span className="dk-seo-technical-audit-chips">
              {f.schema.types.map((t) => (
                <Chip key={t} className="dk-seo-technical-audit-type">
                  {t}
                </Chip>
              ))}
            </span>
          ) : (
            <None />
          )}
          {f.schema.unreadable ? (
            <span className="dk-seo-technical-audit-sub dk-seo-technical-ink-bad">
              {num(f.schema.unreadable)} {f.schema.unreadable === 1 ? "block is" : "blocks are"} not valid JSON.
            </span>
          ) : null}
          {f.schema.incomplete.map((n, i) => (
            <span key={`${n.type}-${i}`} className="dk-seo-technical-audit-sub dk-seo-technical-ink-warn">
              {n.type} misses {n.missing.join(", ")}.
            </span>
          ))}
        </Fact>
        <Fact label="Share">
          <dl className="dk-seo-technical-audit-pairs">
            {og.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v === null ? <None /> : <span className="dk-seo-technical-audit-text">{v}</span>}</dd>
              </div>
            ))}
          </dl>
        </Fact>
        <Fact label="Images">
          {f.images.total ? (
            <>
              <span>
                <span className="dk-num">{num(f.images.total)}</span>: <span className="dk-num">{num(f.images.altWritten)}</span> with alt text,{" "}
                <span className="dk-num">{num(f.images.altEmpty)}</span> marked decorative (alt=&quot;&quot;),{" "}
                <span className={cx("dk-num", f.images.altAbsent ? "dk-seo-technical-ink-warn" : null)}>{num(f.images.altAbsent)}</span> without alt.
              </span>
              {f.images.withoutAlt.length ? (
                <ul className="dk-seo-technical-audit-list dk-seo-technical-audit-list--mono" aria-label="Images without alt">
                  {f.images.withoutAlt.map((src, i) => (
                    <li key={`${src}-${i}`}>{src}</li>
                  ))}
                </ul>
              ) : null}
              {f.images.altAbsent > f.images.withoutAlt.length ? <span className="dk-seo-technical-audit-sub">The first {num(f.images.withoutAlt.length)} without alt are listed.</span> : null}
            </>
          ) : (
            <None />
          )}
        </Fact>
        <Fact label="Links">
          <span>
            <span className="dk-num">{num(f.links.internal)}</span> to its own host (<span className="dk-num">{num(f.links.internalFromContent)}</span> from its main content),{" "}
            <span className="dk-num">{num(f.links.external)}</span> elsewhere.
          </span>
          <span className="dk-seo-technical-audit-sub">Distinct addresses.</span>
        </Fact>
        <Fact label="hreflang">
          {f.hreflang.length ? (
            <dl className="dk-seo-technical-audit-pairs">
              {f.hreflang.map((h, i) => (
                <div key={`${h.lang}-${i}`}>
                  <dt>{h.lang}</dt>
                  <dd>
                    <span className="dk-seo-technical-audit-mono">{h.href}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <None />
          )}
        </Fact>
      </dl>
    </section>
  );
}

/** The response headers the audit keeps (those that matter for search and speed), as sent. */
function Headers({ headers }: { headers: Record<string, string> }) {
  const rows = Object.entries(headers);
  return (
    <section className="dk-seo-technical-audit-part" aria-label="Response headers">
      <details className="dk-seo-technical-audit-more">
        <summary>
          <span className="dk-seo-technical-h3">
            Response headers <span className="dk-seo-technical-h3-n">{rows.length ? num(rows.length) : "none"}</span>
          </span>
          <Icon name="chevron-down" size={12} className="dk-seo-technical-cov-chev" />
        </summary>
        {rows.length ? (
          <dl className="dk-seo-technical-audit-pairs dk-seo-technical-audit-pairs--mono">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <Quiet>None of the headers the audit keeps were sent.</Quiet>
        )}
      </details>
    </section>
  );
}
