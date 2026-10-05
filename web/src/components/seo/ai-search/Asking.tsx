import type { Reading } from "@/contract/common";
import type { AiAsking, AiSearchAsked, ReadinessCheck } from "@/contract/seo/ai-search";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { LangMark } from "@/components/seo/overview/bits";
import { cx } from "@/lib/cx";
import { num, shortDate } from "@/lib/format";
import { PostButton } from "./Act";
import { CHECK_STATE, hrefWith, paramsOf } from "./look";
import "@/components/ui/table.css";
import "./ai-search.css";

const SOURCE: Record<string, string> = { gsc: "Search Console", autocomplete: "Autocomplete", audit: "Audit", manual: "Added by hand" };

/** A check's state as a small mark, or a dot when the page was not read. */
function Mark({ state, label }: { state: ReadinessCheck["state"] | null; label: string }) {
  if (!state || state === "n/a") return <span className="dk-seo-ai-search-cell dk-seo-ai-search-cell--none" title={`${label}: not read`}>·</span>;
  const s = CHECK_STATE[state];
  return (
    <span className={cx("dk-seo-ai-search-cell", `dk-tone-${s.tone}`)} title={`${label}: ${s.word.toLowerCase()}`}>
      <Icon name={s.icon} size={14} />
      <span className="dk-sr">
        {label}: {s.word.toLowerCase()}.
      </span>
    </span>
  );
}

/**
 * QUESTIONS PEOPLE SEARCH. The eight questions asked of the assistants were
 * the audit's guess; the site's own search data shows the long,
 * question-shaped searches AI answers are built for. Each phrase with Search
 * Console's impressions where Google showed the site for it, the page mapped
 * to it with the two checks an assistant quotes from (a direct answer,
 * questions answered), and "Track" to ask it of the assistants each round.
 */
export function Asking({ reading, asked, range, owner }: { reading: Reading<AiAsking>; asked: AiSearchAsked; range: string; owner: boolean }) {
  const v = reading.state === "ok" ? reading.value : null;
  const base = paramsOf(range, asked);
  return (
    <Card
      id="asking"
      title="Questions people search"
      icon="search"
      flush
      className="dk-seo-ai-search-panel"
      info="Question-shaped phrases from the keyword table (Search Console's queries, Google Autocomplete's suggestions, the audit) that were not judged irrelevant: the searches AI answers are built for. Impressions are Search Console's, where Google showed the site for the phrase. The page is the one mapped to the phrase, with whether it opens with a direct answer and answers questions. Track a phrase to ask it of the assistants each round."
      sub={v ? `${num(v.total)} question-shaped phrases${v.window ? ` · impressions ${shortDate(v.window.start)} – ${shortDate(v.window.end)}` : " · no Search Console history yet"}` : undefined}
      right={v ? <Stamp reading={reading} /> : null}
    >
      {v ? (
        <>
          <div className="dk-table-wrap">
            <table className="dk-table dk-table--dense dk-table--caps">
              <caption className="dk-sr">Question-shaped searches, with Search Console's impressions and the page that answers them</caption>
              <thead>
                <tr>
                  <th scope="col">Phrase</th>
                  <th scope="col" className="dk-table-right">
                    Impressions
                  </th>
                  <th scope="col">Page</th>
                  <th scope="col" className="dk-table-center">
                    Answer
                  </th>
                  <th scope="col" className="dk-table-center">
                    FAQ
                  </th>
                  <th scope="col">
                    <span className="dk-sr">Track</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {v.rows.map((r) => (
                  <tr key={r.phrase}>
                    <td className="dk-seo-ai-search-asked">
                      <span className="dk-seo-ai-search-asked-phrase">{r.phrase}</span>
                      <span className="dk-seo-ai-search-qa-meta">
                        {r.lang ? <LangMark lang={r.lang} /> : null}
                        {r.price ? <Chip tone="warn">Price</Chip> : null}
                        <span className="dk-seo-ai-search-quiet">{r.sources.map((s) => SOURCE[s] ?? s).join(", ")}</span>
                      </span>
                    </td>
                    <td className="dk-table-right dk-num">
                      {r.impressions !== null ? (
                        <>
                          {num(r.impressions)}
                          {r.position !== null ? <span className="dk-seo-ai-search-quiet"> · #{num(r.position, 1)}</span> : null}
                        </>
                      ) : (
                        <span className="dk-seo-ai-search-quiet" title="Google reported no impression of the site for this phrase in the window">
                          none
                        </span>
                      )}
                    </td>
                    <td className="dk-seo-ai-search-clip">
                      {r.page ? (
                        <Go href={hrefWith(base, { page: r.page.path }, "pages")} scroll={false} className="dk-seo-ai-search-path" title="Open its readiness checks">
                          {r.page.path}
                        </Go>
                      ) : (
                        <span className="dk-seo-ai-search-quiet">No page yet</span>
                      )}
                    </td>
                    <td className="dk-table-center">{r.page ? <Mark state={r.page.answer} label="Direct answer under the heading" /> : null}</td>
                    <td className="dk-table-center">{r.page ? <Mark state={r.page.faq} label="Questions answered on the page" /> : null}</td>
                    <td className="dk-table-right">
                      {r.tracked ? (
                        <span className="dk-seo-ai-search-quiet">Tracked</span>
                      ) : owner ? (
                        <PostButton path="/questions" body={{ question: r.phrase, lang: r.lang ?? undefined, kind: r.price ? "price" : "category", active: true }} label="Track" busyLabel="Adding…" icon="plus" title="Ask it of every assistant each round" />
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!v.rows.length ? (
                  <tr className="dk-table-none">
                    <td colSpan={6}>No question-shaped phrase in the keyword table.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {v.total > v.rows.length || asked.asking === "all" ? (
            <Go href={hrefWith(base, { asking: asked.asking === "all" ? undefined : "all" }, "asking")} scroll={false} replace className="dk-seo-ai-search-more">
              {asked.asking === "all" ? "Show the first twelve" : `Show all ${num(v.total)} phrases`}
              <Icon name={asked.asking === "all" ? "chevron-up" : "chevron-down"} size={14} />
            </Go>
          ) : null}
        </>
      ) : reading.state !== "ok" ? (
        <div className="dk-seo-ai-search-pad">
          <PanelAbsent reading={reading} />
        </div>
      ) : null}
    </Card>
  );
}
