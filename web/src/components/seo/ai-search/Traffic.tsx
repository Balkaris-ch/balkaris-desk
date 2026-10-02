import type { Reading } from "@/contract/common";
import type { AiCrawlers, AiReferrals } from "@/contract/seo/ai-search";
import { AreaChart, BarList } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { Delta } from "@/components/ui/Delta";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { num, shortDate } from "@/lib/format";
import "@/components/ui/table.css";
import "./ai-search.css";

const spanText = (w: { start: string; end: string }) => `${shortDate(w.start)} to ${shortDate(w.end)}`;

/**
 * Visits from AI assistants: GA4's sessions whose source is an assistant
 * (the rule is printed in the (i)), by day, by assistant and by the page they
 * landed on. Consenting visitors only.
 */
export function Visits({ reading }: { reading: Reading<AiReferrals> }) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <Card
      title="Visits from AI assistants"
      icon="users"
      className="dk-seo-ai-search-panel"
      info={v ? `${v.rule} Consenting visitors only: a visitor who declined analytics is not counted anywhere.` : "GA4 sessions whose source is an AI assistant, consenting visitors only."}
      sub={v ? spanText(v) : undefined}
      right={v ? <Stamp reading={reading} /> : null}
    >
      {v ? (
        <div className="dk-seo-ai-search-traffic">
          <div className="dk-seo-ai-search-figure-row">
            <p className="dk-seo-ai-search-big dk-num">{num(v.sessions)}</p>
            <div>
              <p className="dk-seo-ai-search-quiet">
                session{v.sessions === 1 ? "" : "s"} · {num(v.users)} visitor{v.users === 1 ? "" : "s"}
              </p>
              {v.previous !== null ? <Delta value={v.sessions} previous={v.previous} size="sm" /> : <p className="dk-seo-ai-search-quiet">Not compared: GA4 does not cover the period before whole.</p>}
            </div>
          </div>
          <AreaChart series={v.days.map((d) => ({ date: d.date, value: d.sessions }))} label="Sessions from AI assistants per day" height={110} zeroNote="No session from an AI assistant in this window." />
          <div className="dk-seo-ai-search-two">
            <div>
              <p className="dk-seo-ai-search-sublabel">By assistant</p>
              <BarList items={v.byAssistant.map((a) => ({ key: a.source, label: a.label, value: a.sessions }))} label="Sessions by assistant" emptyNote="No assistant sent a visitor in this window." />
            </div>
            <div>
              <p className="dk-seo-ai-search-sublabel">Landed on</p>
              {v.byLanding.length ? (
                <ul className="dk-seo-ai-search-landing">
                  {v.byLanding.slice(0, 6).map((l) => (
                    <li key={l.path}>
                      {l.path.startsWith("/") ? (
                        <Go href={`/seo/pages/view?path=${encodeURIComponent(l.path)}`} className="dk-seo-ai-search-path">
                          {l.path}
                        </Go>
                      ) : (
                        <span className="dk-seo-ai-search-path dk-seo-ai-search-quiet" title="GA4 recorded no landing page for this session">
                          {l.path}
                        </span>
                      )}
                      <span className="dk-num">{num(l.sessions)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dk-seo-ai-search-quiet">No landing page recorded.</p>
              )}
            </div>
          </div>
        </div>
      ) : reading.state !== "ok" ? (
        <PanelAbsent reading={reading} />
      ) : null}
    </Card>
  );
}

const PURPOSE: Record<AiCrawlers["byAgent"][number]["purpose"], string> = {
  training: "Training",
  search: "AI search",
  user: "A user's question",
  "search-engine": "Search engine",
  other: "Other",
};

/**
 * AI crawlers: requests by named AI and search crawlers in Vercel's request
 * records, by crawler (with its company and what it does), by day and by
 * page. Until the drain delivers, the panel says so, and shows the one true
 * thing about crawlers the desk already reads: which of them robots.txt lets in.
 */
export function Crawlers({ reading, robots }: { reading: Reading<AiCrawlers>; robots: { agent: string; family: string; allowed: boolean }[] | null }) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <Card
      title="AI crawlers"
      icon="robot"
      className="dk-seo-ai-search-panel"
      info="Requests by named AI and search crawlers (by the user agent each announces) in Vercel's request records, on the days the log drain delivered: a day without a delivery is unknown, never zero. GA4 never sees crawlers, so nothing else counts them."
      sub={v ? `${spanText(v)} · ${num(v.deliveredDays)} days delivered` : undefined}
      right={v ? <Stamp reading={reading} /> : null}
    >
      {v ? (
        <div className="dk-seo-ai-search-traffic">
          <div className="dk-seo-ai-search-figure-row">
            <p className="dk-seo-ai-search-big dk-num">{num(v.hits)}</p>
            <p className="dk-seo-ai-search-quiet">requests by named crawlers</p>
          </div>
          <AreaChart series={v.days.map((d) => ({ date: d.date, value: d.hits }))} label="Requests by AI and search crawlers per delivered day" height={110} zeroNote="No named crawler asked for a page on the delivered days." />
          <div className="dk-seo-ai-search-two">
            <div>
              <p className="dk-seo-ai-search-sublabel">By crawler</p>
              <ul className="dk-seo-ai-search-agents">
                {v.byAgent.map((a) => (
                  <li key={a.agent}>
                    <span className="dk-seo-ai-search-strong">{a.agent}</span>
                    <span className="dk-seo-ai-search-quiet">
                      {a.company}
                      {a.company ? " · " : ""}
                      {PURPOSE[a.purpose]}
                    </span>
                    <span className="dk-num">{num(a.hits)}</span>
                  </li>
                ))}
                {!v.byAgent.length ? <li className="dk-seo-ai-search-quiet">None on the delivered days.</li> : null}
              </ul>
            </div>
            <div>
              <p className="dk-seo-ai-search-sublabel">Pages asked for</p>
              <ul className="dk-seo-ai-search-landing">
                {v.byPage.slice(0, 8).map((p) => (
                  <li key={p.path}>
                    <span className="dk-seo-ai-search-path" title={p.agents.join(", ")}>
                      {p.path}
                    </span>
                    <span className="dk-num">{num(p.hits)}</span>
                  </li>
                ))}
                {!v.byPage.length ? <li className="dk-seo-ai-search-quiet">None on the delivered days.</li> : null}
              </ul>
            </div>
          </div>
        </div>
      ) : reading.state !== "ok" ? (
        <>
          <PanelAbsent reading={reading} />
          {robots ? (
            <div className="dk-seo-ai-search-robots">
              <p className="dk-seo-ai-search-sublabel">Meanwhile, what robots.txt lets in</p>
              <ul className="dk-seo-ai-search-robot-list" aria-label="What robots.txt says to each named crawler">
                {robots.map((r) => (
                  <li key={r.agent} title={r.family}>
                    <Chip tone={r.allowed ? "good" : "bad"}>
                      <Icon name={r.allowed ? "check" : "x"} size={12} />
                      <span className={cx(!r.allowed && "dk-seo-ai-search-bad")}>{r.agent}</span>
                    </Chip>
                  </li>
                ))}
              </ul>
              <p className="dk-seo-ai-search-quiet">From the readiness check's last read of robots.txt: allowed is not the same as visited.</p>
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
