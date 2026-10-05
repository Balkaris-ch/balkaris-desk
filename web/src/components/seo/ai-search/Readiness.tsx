import type { Reading } from "@/contract/common";
import type { Readiness } from "@/contract/seo/ai-search";
import { Bar } from "@/components/charts";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { Info } from "@/components/ui/Tooltip";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { CHECK_STATE, WHO_FIX } from "./look";
import "@/components/ui/table.css";
import "./ai-search.css";

/**
 * AI readiness of the whole site: robots.txt, /llms.txt (optional, and said
 * so), the sitemap's dates, Bing, the Business Profile, one name and
 * address. Each check says what it read and the step that fixes it.
 */
export function ReadinessSite({ reading }: { reading: Reading<Readiness> }) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <Card
      title="AI readiness, site-wide"
      icon="shield-check"
      className="dk-seo-ai-search-panel"
      info="What every AI search engine meets before any page: whether robots.txt lets its crawler in, the sitemap's dates, whether Bing knows the site, the Business Profile, and one name, address and phone. Read once a day by the desk; each line says what was read."
      sub={v ? `${num(v.site.filter((c) => c.state === "pass").length)} of ${num(v.site.length)} pass` : undefined}
      right={v ? <Stamp reading={reading} /> : null}
    >
      {v && v.unread ? (
        <p className="dk-seo-ai-search-unread">
          <Icon name="alert" size={14} />
          <span>{v.unread.line}</span>
        </p>
      ) : null}
      {v ? (
        v.site.length ? (
          <ul className="dk-seo-ai-search-checks">
            {v.site.map((c) => {
              const s = CHECK_STATE[c.state];
              return (
                <li key={c.key} className="dk-seo-ai-search-check">
                  <span className={cx("dk-seo-ai-search-check-mark", `dk-tone-${s.tone}`)} title={s.word}>
                    <Icon name={s.icon} size={16} />
                    <span className="dk-sr">{s.word}: </span>
                  </span>
                  <div className="dk-seo-ai-search-check-text">
                    <p className="dk-seo-ai-search-strong">{c.label}</p>
                    <p className="dk-seo-ai-search-quiet">{c.detail}</p>
                    {c.fix ? (
                      <p className="dk-seo-ai-search-check-fix">
                        <Icon name="arrow-right" size={12} />
                        <span>{c.fix}</span>
                      </p>
                    ) : null}
                  </div>
                  {c.who ? <Chip tone={WHO_FIX[c.who].tone}>{WHO_FIX[c.who].word}</Chip> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="dk-seo-ai-search-quiet">The site-wide checks have not run yet: they run at the end of the daily readiness check.</p>
        )
      ) : reading.state !== "ok" ? (
        <PanelAbsent reading={reading} />
      ) : null}
    </Card>
  );
}

/** Each page check over the pages it applies to: how many pass, and the step that fixes the rest. */
export function ReadinessChecks({ reading }: { reading: Reading<Readiness> }) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <Card
      title="AI readiness, page by page"
      icon="file-text"
      flush
      className="dk-seo-ai-search-panel"
      info="Each check the desk makes on every sitemap page as a crawler gets it, over the pages it applies to (a legal page needs no price). What an assistant needs to quote a page: a direct answer under the heading, questions answered, FAQ data, who and where, a price, how long it takes, a German version, a date."
      sub={v ? `${num(v.ready)} of ${num(v.of)} pages pass every check that applies to them` : undefined}
    >
      {v ? (
        <div className="dk-table-wrap">
          <table className="dk-table dk-table--dense dk-table--caps dk-seo-ai-search-tallies">
            <caption className="dk-sr">Readiness checks over the pages they apply to</caption>
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col" className="dk-table-right">
                  Pass
                </th>
                <th scope="col" aria-label="Share passing" />
                <th scope="col">Who fixes</th>
              </tr>
            </thead>
            <tbody>
              {v.byCheck.map((t) => (
                <tr key={t.key}>
                  <td>
                    <span className="dk-seo-ai-search-tally-label">
                      {t.label}
                      {t.fix ? <Info text={t.fix} label={`How to fix: ${t.label}`} /> : null}
                    </span>
                  </td>
                  <td className="dk-table-right dk-num">
                    <b>{num(t.pass)}</b> <span className="dk-seo-ai-search-quiet">of {num(t.applies)}</span>
                  </td>
                  <td className="dk-seo-ai-search-tally-bar">
                    <Bar value={t.pass} max={t.applies || 1} tone={!t.applies ? "quiet" : t.pass === t.applies ? "good" : t.pass === 0 ? "bad" : "warn"} label={`${t.pass} of ${t.applies} pages pass`} />
                  </td>
                  <td>{t.who && t.fail ? <Chip tone={WHO_FIX[t.who].tone}>{WHO_FIX[t.who].word}</Chip> : <span className="dk-seo-ai-search-quiet">{t.fail ? "" : "Nothing to fix"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : reading.state !== "ok" ? (
        <div className="dk-seo-ai-search-pad">
          <PanelAbsent reading={reading} />
        </div>
      ) : null}
    </Card>
  );
}
