import type { ReportFinding, ReportGroup, ReportSection, SeoReport } from "@/contract/seo";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { DASH, num } from "@/lib/format";
import { StatusMark, SeoRead } from "./bits";
import "./seo.css";

const SEVERITY = { critical: { label: "Critical", tone: "bad" }, warning: { label: "Warning", tone: "warn" }, opportunity: { label: "Opportunity", tone: "info" } } as const;

function costText(g: ReportGroup): string {
  if (g.cost === 0) return g.rule.startsWith("desk.") || g.rule.startsWith("gsc.") ? "Listed, not scored" : "Costs no points";
  return g.scope === "site" ? `−${g.cost} points from the site score` : `−${g.cost} points from each page’s score`;
}

function Group({ group }: { group: ReportGroup }) {
  const s = SEVERITY[group.severity];
  return (
    <section className="dk-seo-rgroup" aria-label={group.title}>
      <header className="dk-seo-rgroup-head">
        <h3>{group.title}</h3>
        <Chip tone={s.tone}>{s.label}</Chip>
        <span className="dk-seo-rgroup-cost">{costText(group)}</span>
        <span className="dk-seo-rgroup-count dk-num">{num(group.findings.length)}</span>
        <code className="dk-seo-rgroup-rule">{group.rule}</code>
      </header>
      <Table<ReportFinding>
        caption={group.title}
        rows={group.findings}
        rowKey={(f) => `${f.path ?? "site"}|${f.text}`}
        minWidth={640}
        columns={[
          { key: "page", head: "Page", cell: (f) => <span className="dk-seo-cell-text">{f.path ?? "The site"}</span>, sort: (f) => f.path ?? "", width: "22%" },
          { key: "finding", head: "Finding", cell: (f) => <span className="dk-seo-rtext">{f.text}{f.related?.length ? <span className="dk-seo-rrelated"> · {f.related.slice(0, 6).join(", ")}{f.related.length > 6 ? ` and ${f.related.length - 6} more` : ""}</span> : null}</span> },
          { key: "measured", head: "Measured", numeric: true, cell: (f) => f.measured ?? DASH, width: "12%" },
          { key: "limit", head: "Limit", numeric: true, cell: (f) => f.limit ?? DASH, width: "16%" },
        ]}
      />
    </section>
  );
}

function Section({ section }: { section: ReportSection }) {
  const r = section.reading;
  return (
    <Card
      id={section.key}
      className="dk-seo-rsection"
      title={
        <span className="dk-seo-rtitle">
          <StatusMark tone={r.state === "ok" ? r.value.tone : "absent"} />
          {section.label}
        </span>
      }
      sub={r.state === "ok" ? r.value.summary : undefined}
      right={r.state === "ok" ? <Stamp reading={r} /> : null}
    >
      <SeoRead reading={r}>
        {(b) => (
          <div className="dk-seo-rbody">
            {b.facts.length ? (
              <ul className="dk-seo-rfacts">
                {b.facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}
            {b.groups.map((g) => (
              <Group key={g.rule} group={g} />
            ))}
          </div>
        )}
      </SeoRead>
    </Card>
  );
}

/** The full report: the last crawl in numbers, then every check and every rule that found something. */
export function ReportView({ report }: { report: SeoReport }) {
  return (
    <>
      <Card title="The last crawl" icon="layers">
        <SeoRead reading={report.crawl}>
          {(c, r) => (
            <div className="dk-seo-rsummary">
              <p>
                <b className="dk-num">{num(c.pages)}</b> pages read, <b className="dk-num">{num(c.inSitemap)}</b> of them in the sitemap
              </p>
              <p>
                Site score <b className="dk-num">{c.siteScore === null ? DASH : `${c.siteScore} / 100`}</b>
              </p>
              <p>
                <b className="dk-num dk-seo-rcrit">{num(c.critical)}</b> critical, <b className="dk-num dk-seo-rwarn">{num(c.warning)}</b> warnings, <b className="dk-num dk-seo-ropp">{num(c.opportunity)}</b>{" "}
                opportunities
              </p>
              <Stamp reading={r} />
            </div>
          )}
        </SeoRead>
      </Card>
      {report.sections.map((s) => (
        <Section key={s.key} section={s} />
      ))}
    </>
  );
}
