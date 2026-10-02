import type { Reading } from "@/contract/common";
import type { ReadinessCheck } from "@/contract/seo/ai-search";
import type { BrokenCheck, LinkRow, RedirectsCheck, SchemaCheck, SeoTechnicalPayload, SitemapCheck, SubmittedSitemap } from "@/contract/seo/technical";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { cx } from "@/lib/cx";
import { ago, fullDate, num } from "@/lib/format";
import { TaskButton } from "./Act";
import { Body, Mark, PathLink, Quiet } from "./bits";
import { IssueRows } from "./Issues";

/** The site-wide files and the link graph: sitemap, robots.txt and the crawlers it lets in, structured data, redirects, broken links. */

const checkTone = (c: ReadinessCheck): "good" | "bad" | "absent" => (c.state === "pass" ? "good" : c.state === "fail" ? "bad" : "absent");

/** A list of plain pass/fail lines. */
function Lines({ rows }: { rows: { key: string; tone: "good" | "warn" | "bad" | "info" | "absent"; label: string; detail?: string | null; who?: string | null }[] }) {
  return (
    <ul className="dk-seo-technical-lines">
      {rows.map((r) => (
        <li key={r.key} className="dk-seo-technical-line">
          <Mark tone={r.tone} />
          <span className="dk-seo-technical-line-text">
            <span className="dk-seo-technical-line-label">{r.label}</span>
            {r.detail ? <span className="dk-seo-technical-line-detail">{r.detail}</span> : null}
          </span>
          {r.who ? <Chip tone={r.who === "Needs you" ? "violet" : "quiet"}>{r.who}</Chip> : null}
        </li>
      ))}
    </ul>
  );
}

const WHO: Record<string, string> = { code: "Website code", owner: "Needs you", content: "Content" };

/** "Google fetched it 3 days ago": what Search Console records for each submitted sitemap. */
function submittedLine(s: SubmittedSitemap): { tone: "good" | "warn" | "bad"; label: string; detail: string } {
  const name = s.path.replace(/^https?:\/\/[^/]+/, "") || s.path;
  const fetched = s.lastDownloaded ? `Google last fetched it ${ago(s.lastDownloaded)} (${fullDate(s.lastDownloaded)})` : "Google has not fetched it yet";
  const parts = [
    `${fetched}; it counted ${num(s.submitted)} address${s.submitted === 1 ? "" : "es"}`,
    s.lastSubmitted ? `submitted ${fullDate(s.lastSubmitted)}` : null,
    s.isPending ? "Google is still processing it" : null,
    s.errors ? `${num(s.errors)} error${s.errors === 1 ? "" : "s"}` : null,
    s.warnings ? `${num(s.warnings)} warning${s.warnings === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return { tone: s.errors ? "bad" : s.warnings || !s.lastDownloaded ? "warn" : "good", label: `Google: ${name}`, detail: `${parts.join("; ")}.` };
}

export function SitemapCard({ sitemap, checks, submitted }: { sitemap: Reading<SitemapCheck>; checks: Reading<{ rows: ReadinessCheck[] }>; submitted: Reading<{ rows: SubmittedSitemap[] }> }) {
  const bing = checks.state === "ok" ? (checks.value.rows.find((c) => c.key === "bing") ?? null) : null;
  return (
    <Card
      title="Sitemap"
      icon="sitemap"
      id="sitemap"
      info="sitemap.xml as the desk’s sitemap job reads it every quarter of an hour, held against the sitemap rules. Google uses a real lastmod (the date a page’s content last changed) to notice new and changed pages."
      right={sitemap.state === "ok" ? <Stamp reading={sitemap} /> : null}
      className="dk-seo-technical-sitemap"
    >
      <Body reading={sitemap}>
        {(m) => (
          <div className="dk-seo-technical-stackv">
            <Lines
              rows={[
                { key: "answers", tone: m.status === 200 ? "good" : "bad", label: m.status === 200 ? "sitemap.xml answers 200" : `sitemap.xml ${m.status ? `answers ${m.status}` : "does not answer"}`, detail: `${num(m.addresses)} addresses listed.` },
                { key: "valid", tone: m.findings?.some((f) => f.severity === "critical") ? "bad" : m.findings?.length ? "warn" : "good", label: m.findings?.length ? `${num(m.findings.length)} finding${m.findings.length === 1 ? "" : "s"} against the sitemap rules` : "Valid by the sitemap rules", detail: m.findings?.map((f) => f.text).join(" ") || null },
                { key: "named", tone: m.named ? "good" : "warn", label: m.named ? "robots.txt names it" : "robots.txt does not name it" },
                { key: "lastmod", tone: m.ok ? "good" : "bad", label: `${num(m.withLastmod)} of ${num(m.addresses)} addresses carry a lastmod`, detail: m.codeTask, who: m.codeTask ? WHO.code : null },
              ]}
            />
            {m.byKind?.length ? (
              <table className="dk-seo-technical-mini">
                <caption className="dk-sr">Sitemap addresses by kind of page</caption>
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Addresses</th>
                    <th scope="col">With lastmod</th>
                  </tr>
                </thead>
                <tbody>
                  {m.byKind.map((k) => (
                    <tr key={k.kind}>
                      <th scope="row">{k.label}</th>
                      <td className="dk-num">{num(k.addresses)}</td>
                      <td className={cx("dk-num", k.withLastmod < k.addresses ? "dk-seo-technical-ink-warn" : "dk-seo-technical-ink-good")}>{num(k.withLastmod)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        )}
      </Body>
      <div className="dk-seo-technical-subsection">
        <h3 className="dk-seo-technical-h3">Submitted to search engines</h3>
        {submitted.state === "ok" ? (
          <Lines rows={submitted.value.rows.map((s, i) => ({ key: `g${i}`, ...submittedLine(s) }))} />
        ) : (
          <Lines rows={[{ key: "g", tone: "absent", label: "Google: Search Console’s record of the sitemap", detail: `${submitted.reason}${submitted.state === "off" && submitted.step ? ` ${submitted.step}` : ""}` }]} />
        )}
        {bing ? <Lines rows={[{ key: "bing", tone: checkTone(bing), label: bing.label, detail: bing.state === "fail" && bing.fix ? `${bing.detail} ${bing.fix}` : bing.detail, who: bing.state === "fail" && bing.who ? WHO[bing.who] : null }]} /> : null}
        <div className="dk-seo-technical-stampline dk-seo-technical-stampline--flat">
          <Stamp reading={submitted.state === "ok" ? submitted : checks} />
        </div>
      </div>
    </Card>
  );
}

export function RobotsCard({ robots, llms }: { robots: SeoTechnicalPayload["robots"]; llms: SeoTechnicalPayload["llms"] }) {
  return (
    <Card
      title="Robots.txt and crawlers"
      icon="robot"
      id="robots"
      info="robots.txt as the sitemap job reads it, and whether it lets each named search and AI crawler read the site (the AI-readiness check, once a day). The site’s answers can only be found by search engines and AI assistants whose crawler may read it."
      right={robots.state === "ok" ? <Stamp reading={robots} /> : null}
      flush
      className="dk-seo-technical-robots"
    >
      <Body reading={robots}>
        {(r) => (
          <div>
            <div className="dk-seo-technical-pad-x">
              <Lines
                rows={[
                  { key: "answers", tone: r.status === 200 ? "good" : "warn", label: r.status === 200 ? "robots.txt answers 200" : `robots.txt ${r.status ? `answers ${r.status}` : "does not answer"}`, detail: r.rules !== undefined ? `${num(r.rules)} rule${r.rules === 1 ? "" : "s"} for every crawler${r.sitemaps?.length ? `; names ${r.sitemaps.join(", ")}` : "; names no sitemap"}.` : null },
                  ...(r.findings ?? []).map((f, i) => ({ key: `f${i}`, tone: (f.severity === "critical" ? "bad" : "warn") as "bad" | "warn", label: f.title, detail: f.text })),
                ]}
              />
            </div>
            {r.agents.length ? (
              <ul className="dk-seo-technical-agents" aria-label="Crawlers robots.txt lets in">
                {r.agents.map((a) => (
                  <li key={a.agent} className="dk-seo-technical-agent">
                    <Mark tone={a.allowed ? "good" : "bad"} />
                    <span className="dk-seo-technical-agent-name">{a.agent}</span>
                    <span className="dk-seo-technical-agent-family">{a.family}</span>
                    <span className={cx("dk-seo-technical-agent-state", a.allowed ? "dk-seo-technical-ink-good" : "dk-seo-technical-ink-bad")}>{a.allowed ? "Allowed" : "Blocked"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Quiet className="dk-seo-technical-pad">Each crawler’s access is read by the AI-readiness check, which has not run yet.</Quiet>
            )}
            {r.agentsAt ? <Quiet className="dk-seo-technical-pad-x">Crawlers read {ago(r.agentsAt)}.</Quiet> : null}
          </div>
        )}
      </Body>
      <div className="dk-seo-technical-subsection dk-seo-technical-pad-x">
        <h3 className="dk-seo-technical-h3">/llms.txt</h3>
        {llms.state === "ok" ? (
          <Lines rows={[{ key: "llms", tone: llms.value.present ? "good" : "info", label: llms.value.line, detail: "Optional: Google says it is not needed, and no AI company’s crawler documentation asks for it.", who: llms.value.present ? null : WHO.code }]} />
        ) : (
          <Quiet>{llms.reason}</Quiet>
        )}
      </div>
    </Card>
  );
}

export function SchemaCard({ reading }: { reading: Reading<SchemaCheck> }) {
  return (
    <Card
      title="Structured data"
      icon="code"
      id="schema"
      info="The JSON-LD on every page as the crawl read it, held against the fields Google requires for each type. Google’s own Rich Results test is not asked; Search Console’s enhancement reports have no API."
      right={reading.state === "ok" ? <Stamp reading={reading} /> : null}
      flush
      className="dk-seo-technical-schema"
    >
      <Body reading={reading}>
        {(s) => (
          <div>
            <div className="dk-seo-technical-pad-x">
              <Lines
                rows={[
                  { key: "with", tone: s.withSchema === s.read ? "good" : "warn", label: `${num(s.withSchema)} of ${num(s.read)} pages carry structured data` },
                  { key: "valid", tone: s.invalid ? "bad" : "good", label: s.invalid ? `${num(s.invalid)} page${s.invalid === 1 ? "" : "s"} with invalid or incomplete structured data` : "All of it valid JSON with the required fields" },
                ]}
              />
            </div>
            <ul className="dk-seo-technical-types" aria-label="Structured-data types on the site">
              {s.types.map((t) => (
                <li key={t.key}>
                  <span className="dk-seo-technical-type">{t.label}</span>
                  <span className="dk-num dk-seo-technical-ink-quiet">{num(t.value)}</span>
                </li>
              ))}
            </ul>
            {s.rows.length ? <IssueRows rows={s.rows} label="Structured-data findings" /> : null}
          </div>
        )}
      </Body>
    </Card>
  );
}

const OUTCOME = { ok: { tone: "good", word: "Works" }, broken: { tone: "bad", word: "Broken" }, chain: { tone: "warn", word: "Chain" }, untested: { tone: "quiet", word: "Not tried" } } as const;
const BY = { config: "next.config", desk: "approved on the desk", hosting: "hosting" } as const;

export function RedirectsCard({ reading }: { reading: Reading<RedirectsCheck> }) {
  return (
    <Card
      title="Redirects"
      icon="redirect"
      id="redirects"
      info="Every redirect the website’s config promises, those approved on the desk and the bare domain’s, each tried once at the last crawl: does it land, in one hop, on a page that answers 200."
      right={reading.state === "ok" ? <Stamp reading={reading} /> : null}
      flush
      className="dk-seo-technical-redirects"
    >
      <Body reading={reading}>
        {(r) => (
          <div>
            <Quiet className="dk-seo-technical-pad-x">
              {num(r.rows.length)} promised: {num(r.working)} work in one hop{r.broken ? `, ${num(r.broken)} broken` : ""}
              {r.chains ? `, ${num(r.chains)} take more than one hop` : ""}. {r.linksThrough.length ? `${num(r.linksThrough.length)} link target${r.linksThrough.length === 1 ? "" : "s"} on the site go through a redirect.` : "No link on the site goes through a redirect."}
              {r.sitemapRedirects.length ? ` ${num(r.sitemapRedirects.length)} sitemap address${r.sitemapRedirects.length === 1 ? "" : "es"} redirect.` : ""}
            </Quiet>
            {r.broken ? (
              <div className="dk-seo-technical-pad-x">
                <TaskButton task={{ kind: "redirect", depth: "deep" }} label="Propose redirects" variant="good" icon="sparkles" />
              </div>
            ) : null}
            <ul className="dk-seo-technical-rows dk-seo-technical-scroll" aria-label="Redirects">
              {r.rows.map((x, i) => (
                <li key={`${x.source}-${i}`} className="dk-seo-technical-redirect">
                  <span className="dk-seo-technical-redirect-from">
                    <span className="dk-seo-technical-path">{x.source}</span>
                    <Icon name="arrow-right" size={12} />
                    <span className="dk-seo-technical-path">{x.destination}</span>
                  </span>
                  <Chip tone={OUTCOME[x.outcome].tone}>{OUTCOME[x.outcome].word}</Chip>
                  <span className="dk-seo-technical-redirect-sub" title={x.remark}>
                    {BY[x.by]}
                    {x.hops > 1 ? ` · ${num(x.hops)} hops` : ""}
                    {x.outcome !== "ok" ? ` · ${x.remark}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {r.linksThrough.length ? <LinkList rows={r.linksThrough} label="Links through a redirect" /> : null}
          </div>
        )}
      </Body>
    </Card>
  );
}

function LinkList({ rows, label }: { rows: LinkRow[]; label: string }) {
  return (
    <ul className="dk-seo-technical-rows" aria-label={label}>
      {rows.map((l) => (
        <li key={l.target} className="dk-seo-technical-link">
          <span className="dk-seo-technical-link-target">
            {l.target.startsWith("/") ? <span className="dk-seo-technical-path">{l.target}</span> : (
              <Go href={l.target} className="dk-seo-technical-path dk-seo-technical-path--link">
                {l.target.replace(/^https?:\/\//, "")}
              </Go>
            )}
            <span className="dk-seo-technical-link-status dk-num">{l.status ? `answers ${l.status}` : "no answer"}</span>
          </span>
          <span className="dk-seo-technical-link-from">
            from {l.sources.slice(0, 3).map((s, i) => (
              <span key={`${s.path}-${i}`}>
                {i ? ", " : ""}
                <PathLink path={s.path} />
              </span>
            ))}
            {l.sources.length > 3 ? ` and ${num(l.sources.length - 3)} more` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function BrokenCard({ reading }: { reading: Reading<BrokenCheck> }) {
  return (
    <Card
      title="Broken links"
      icon="link"
      id="broken"
      info="Links on the site’s pages to addresses that do not answer: the site’s own (checked at every crawl) and other sites’ (asked at most once a week). A site that refuses automated checks is “could not check”, not broken."
      right={reading.state === "ok" ? <Stamp reading={reading} /> : null}
      flush
      className="dk-seo-technical-broken"
    >
      <Body reading={reading}>
        {(b) => (
          <div>
            <div className="dk-seo-technical-pad-x">
              <Lines
                rows={[
                  { key: "inside", tone: b.inside.length ? "bad" : "good", label: b.inside.length ? `${num(b.inside.length)} address${b.inside.length === 1 ? "" : "es"} on the site that links point to do not answer` : "Every link to the site’s own pages answers" },
                  { key: "outside", tone: b.outside.length ? "warn" : "good", label: b.outside.length ? `${num(b.outside.length)} outside page${b.outside.length === 1 ? "" : "s"} linked from the site ${b.outside.length === 1 ? "is" : "are"} gone` : "No outside page linked from the site is gone", detail: b.unchecked ? `${num(b.unchecked)} other site${b.unchecked === 1 ? "" : "s"} refused or failed the check: could not check, not counted.` : null },
                  { key: "down", tone: b.pagesDown.length ? "bad" : "good", label: b.pagesDown.length ? `${num(b.pagesDown.length)} page${b.pagesDown.length === 1 ? "" : "s"} the crawl read do not answer` : "Every page the crawl read answers", detail: b.pagesDown.map((p) => `${p.path} (${p.status || "no answer"})`).join(", ") || null },
                ]}
              />
            </div>
            {b.inside.length ? (
              <>
                <div className="dk-seo-technical-pad-x">
                  <TaskButton task={{ kind: "redirect", depth: "deep" }} label="Propose redirects" variant="good" icon="sparkles" />
                </div>
                <LinkList rows={b.inside} label="Broken links to the site" />
              </>
            ) : null}
            {b.outside.length ? <LinkList rows={b.outside} label="Broken links to other sites" /> : null}
          </div>
        )}
      </Body>
    </Card>
  );
}

