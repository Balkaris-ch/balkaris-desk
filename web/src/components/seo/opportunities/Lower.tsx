import type { OpportunityRow } from "@/contract/seo/common";
import type { OpportunityDetail } from "@/contract/seo/opportunities";
import { Badge, Chip } from "@/components/ui/Badge";
import { Card, CardFoot } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tooltip } from "@/components/ui/Tooltip";
import { DASH, num } from "@/lib/format";
import { gain, hrefWith, noEstimate, pos, PRIORITY_LABEL, PRIORITY_TONE, quoted, TYPE_ICON } from "./look";

/**
 * The three panels under the list (board 111): the selected opportunity's
 * keyword cluster, its ranking potential (our estimate, drawn), and the
 * opportunities that share its page, search or topic.
 */

const KEYWORD_STATUS: Record<string, string> = { relevant: "relevant", weak: "weak", irrelevant: "not relevant", unjudged: "not judged yet" };

export function KeywordCluster({ d }: { d: OpportunityDetail | null }) {
  const c = d?.cluster;
  const page = c?.state === "ok" && c.value.kind === "page";
  return (
    <Card
      className="dk-seo-opps-lower"
      title={page ? "Searches for this page" : "Keyword cluster"}
      icon={page ? "search" : "layers"}
      info="Impressions are how often Google showed the site for the phrase in the head’s range, from the desk’s Search Console history. Not search volume: no free source gives that."
      sub={c?.state === "ok" && c.value.cluster ? <Chip icon="tag" className="dk-seo-opps-cluster-chip">{c.value.cluster.name}</Chip> : null}
      footer={
        /* Where the whole set is: a cluster's phrases in Keywords (every judgement shown), a page's searches in Search Console's explorer. */
        c?.state === "ok" && c.value.total > c.value.rows.length ? (
          <CardFoot href={c.value.href}>{`View all ${num(c.value.total)} ${page ? "searches in Search Console" : "phrases in Keywords"}`}</CardFoot>
        ) : c?.state === "ok" ? (
          <CardFoot href={c.value.href}>{page ? "View in Search Console" : "View in Keywords"}</CardFoot>
        ) : undefined
      }
    >
      {!c ? (
        <Empty compact icon="layers" title="Nothing selected" />
      ) : c.state !== "ok" ? (
        <Absent reading={c} form="panel" />
      ) : c.value.rows.length === 0 ? (
        <Empty compact icon="search" title="No searches reported">
          {page ? "Google reported no search for this page in the range; rare ones are withheld." : "The cluster has no phrases yet."}
        </Empty>
      ) : (
        <>
          <table className="dk-seo-opps-mini">
            <caption className="dk-sr">{page ? "Searches Google showed this page for" : "Phrases of the cluster"}</caption>
            <thead>
              <tr>
                <th scope="col">{page ? "Search" : "Phrase"}</th>
                <th scope="col" className="dk-seo-opps-mini-n">
                  Impr.
                </th>
                <th scope="col" className="dk-seo-opps-mini-n">
                  Pos.
                </th>
              </tr>
            </thead>
            <tbody>
              {c.value.rows.map((r) => (
                <tr key={r.phrase}>
                  <td>
                    <span className="dk-seo-opps-mini-phrase" title={`${r.phrase}${r.status ? `: ${KEYWORD_STATUS[r.status] ?? r.status}` : ""}`}>
                      <Icon name={r.status === "relevant" ? "target" : "circle"} size={12} />
                      <span>{r.phrase}</span>
                    </span>
                  </td>
                  <td className="dk-seo-opps-mini-n dk-num">{r.impressions === null ? DASH : num(r.impressions)}</td>
                  <td className="dk-seo-opps-mini-n dk-num">{r.position === null ? DASH : pos(r.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Stamp reading={c} />
        </>
      )}
    </Card>
  );
}

/** Our estimate, drawn: clicks a month now against clicks a month at the target, from the same impressions. */
export function RankingPotential({ d, curveNote }: { d: OpportunityDetail | null; curveNote: string }) {
  const o = d?.opportunity ?? null;
  const p = o?.potential ?? null;
  const f = d?.figures.state === "ok" ? d.figures.value : null;
  if (!o || !p) {
    return (
      <Card className="dk-seo-opps-lower" title="Ranking potential" icon="trending-up" info={curveNote}>
        <Empty compact icon="target" title="No estimate for this one">
          {o ? noEstimate(o, f?.impressions.value).replace(/^No estimate: /, "").replace(/^./, (c) => c.toUpperCase()) : "Select an opportunity."}
        </Empty>
      </Card>
    );
  }
  const now = (p.impressionsPerMonth * p.currentCtr) / 100;
  const then = (p.impressionsPerMonth * p.targetCtr) / 100;
  const high = Math.max(then, now, 0.0001);
  const subject = o.subject.keyword ? quoted(o.subject.keyword) : (o.subject.page?.path ?? "it");
  const at = p.targetPosition <= 3 ? `the top ${p.targetPosition}` : `position ${p.targetPosition}`;
  const sentence =
    o.type === "low-ctr"
      ? `Our curve’s click rate at position ${p.targetPosition} (${p.targetCtr}%) instead of ${p.currentCtr}% now could bring`
      : `Moving ${subject}${f?.position != null ? ` from position ${pos(f.position)}` : ""} to ${at} could bring`;
  return (
    <Card className="dk-seo-opps-lower" title="Ranking potential" icon="trending-up" info={curveNote}>
      <div className="dk-seo-opps-potential">
        <div className="dk-seo-opps-potential-text">
          <p className="dk-seo-opps-quiet">{sentence}</p>
          <p className="dk-seo-opps-potential-figure dk-num">{gain(p.clicksPerMonth)}</p>
          <p className="dk-seo-opps-quiet">clicks a month, our estimate</p>
        </div>
        <div className="dk-seo-opps-potential-bars" role="img" aria-label={`About ${num(now, 1)} clicks a month now, ${num(then, 1)} at the target, by our curve`}>
          <span className="dk-seo-opps-potential-bar dk-seo-opps-potential-bar--now" style={{ height: `${Math.max(2, (now / high) * 100)}%` }}>
            <b className="dk-num">{num(now, 1)}</b>
          </span>
          <span className="dk-seo-opps-potential-bar" style={{ height: `${Math.max(2, (then / high) * 100)}%` }}>
            <b className="dk-num">{num(then, 1)}</b>
          </span>
        </div>
      </div>
      <p className="dk-seo-opps-legend dk-seo-opps-legend--bars">
        <span>
          <i className="dk-seo-opps-legend-sq dk-seo-opps-legend-sq--now" />
          Now
        </span>
        <span>
          <i className="dk-seo-opps-legend-sq" />
          At {at}
        </span>
      </p>
      <p className="dk-seo-opps-basis">{p.basis}.</p>
    </Card>
  );
}

export function Related({ d, base }: { d: OpportunityDetail | null; base: Record<string, string> }) {
  const list = d?.similar ?? [];
  return (
    <Card className="dk-seo-opps-lower" title="Related opportunities" icon="link" info="Open opportunities that share this one's page, search or keyword cluster.">
      {list.length === 0 ? (
        <Empty compact icon="link" title="None related">
          {d ? "No other open opportunity shares its page, search or topic." : "Select an opportunity."}
        </Empty>
      ) : (
        <ul className="dk-seo-opps-related">
          {list.map((r) => (
            <RelatedRow key={r.id} r={r} href={hrefWith(base, { open: r.id, tab: undefined })} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function RelatedRow({ r, href }: { r: OpportunityRow; href: string }) {
  return (
    <li>
      <span className="dk-seo-opps-icon" aria-hidden>
        <Icon name={TYPE_ICON[r.type]} size={14} />
      </span>
      <Go href={href} scroll={false} className="dk-seo-opps-related-text" title={r.title}>
        <span className="dk-seo-opps-title">{r.title}</span>
        <span className="dk-seo-opps-type">{r.subject.page?.path ?? r.subject.cluster?.name ?? r.typeLabel}</span>
      </Go>
      {r.potential ? (
        <Tooltip text={`${r.potential.basis}.`}>
          <span className="dk-seo-opps-gain-figure dk-num" tabIndex={0}>
            {gain(r.potential.clicksPerMonth)}/mo
          </span>
        </Tooltip>
      ) : null}
      <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge>
    </li>
  );
}

