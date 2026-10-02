import type { ReactNode } from "react";
import type { Reading, Stat } from "@/contract/common";
import type { SeoAiSearchPayload } from "@/contract/seo/ai-search";
import { SparkBars } from "@/components/charts";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Info } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { fullDate, num } from "@/lib/format";
import "@/components/ui/tile.css";
import "./ai-search.css";

/**
 * A figure that is two counts ("0 of 23"): a share of a few dozen recorded
 * answers is not a rate to print as a percentage. Laid out with the Tile
 * primitive's own classes, its source under it like every tile.
 */
function CountTile({ label, info, reading, tone }: { label: string; info: string; reading: Reading<{ num: number; of: number; under: ReactNode; sub?: string }>; tone?: "bad" | "good" }) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <article className="dk-tile">
      <div className="dk-tile-main">
        <div className="dk-tile-top">
          <h3 className="dk-tile-label">
            <span className="dk-tile-label-text">{label}</span>
            <Info text={info} />
          </h3>
        </div>
        {v ? (
          <div className="dk-tile-row">
            <div className="dk-tile-figures">
              <p className="dk-tile-figure dk-num">
                <span className={cx("dk-tile-value", tone === "bad" && "dk-seo-ai-search-bad", tone === "good" && "dk-seo-ai-search-good")}>{num(v.num)}</span>
                <span className="dk-tile-of">of {num(v.of)}</span>
              </p>
              <p className="dk-tile-under dk-seo-ai-search-tile-under">{v.under}</p>
              {v.sub ? <p className="dk-tile-sub">{v.sub}</p> : null}
              <Stamp reading={reading} />
            </div>
          </div>
        ) : reading.state !== "ok" ? (
          <Absent reading={reading} form="tile" />
        ) : null}
      </div>
    </article>
  );
}

/**
 * The five figures under the head: whether answers name Balkaris when the
 * question does not (the owner's "0%"), all counted answers, visits from
 * AI assistants (GA4), requests by AI crawlers (Vercel's records), and the
 * pages that pass every readiness check that applies to them. The answers
 * are each assistant's newest answer to each question, the same set the
 * panels below count. Labels wrap rather than cut (ai-search.css).
 */
export function AiTiles({ d }: { d: SeoAiSearchPayload }) {
  const c = d.checks;
  const t = c.state === "ok" ? c.value.tally : [];
  const lastDay = t.map((e) => e.day).sort().at(-1) ?? null;
  const firstDay = t.map((e) => e.since).sort()[0] ?? null;
  const unread = c.state === "ok" ? c.value.rows.filter((r) => r.mentioned === null).length : 0;
  const when = lastDay ? (firstDay && firstDay !== lastDay ? `Newest answers, recorded ${fullDate(firstDay)} – ${fullDate(lastDay)}` : `Newest answers, recorded ${fullDate(lastDay)}`) : undefined;

  const unprompted: Reading<{ num: number; of: number; under: ReactNode; sub?: string }> =
    c.state === "ok"
      ? {
          ...c,
          value: {
            num: t.reduce((n, e) => n + e.unprompted.mentioned, 0),
            of: t.reduce((n, e) => n + e.unprompted.asked, 0),
            under: "answers to questions that do not name Balkaris",
            sub: when,
          },
        }
      : c;
  const all: Reading<{ num: number; of: number; under: ReactNode; sub?: string }> =
    c.state === "ok"
      ? {
          ...c,
          value: {
            num: t.reduce((n, e) => n + e.mentioned, 0),
            of: t.reduce((n, e) => n + e.asked, 0),
            under: `answers of ${num(t.length)} assistant${t.length === 1 ? "" : "s"} named Balkaris`,
            sub: unread ? `${num(unread)} could not be read whole` : undefined,
          },
        }
      : c;

  const r = d.referrals;
  const visits: Reading<Stat> = r.state === "ok" ? { ...r, value: { value: r.value.sessions, previous: r.value.previous, unit: "count", series: r.value.days.map((x) => x.sessions), sub: r.value.byAssistant.length ? r.value.byAssistant.map((a) => a.label).join(", ") : "No assistant sent a visitor" } } : r;

  const k = d.crawlers;
  const crawlers: Reading<Stat> = k.state === "ok" ? { ...k, value: { value: k.value.hits, previous: null, unit: "count", series: k.value.days.map((x) => x.hits), sub: `${num(k.value.deliveredDays)} days delivered` } } : k;

  const rd = d.readiness;
  const ready: Reading<Stat> = rd.state === "ok" ? { ...rd, value: { value: rd.value.ready, of: rd.value.of, previous: null, unit: "count", series: [], sub: "pass every check that applies to them" } } : rd;

  const unpromptedTone = unprompted.state === "ok" ? (unprompted.value.num === 0 ? "bad" : "good") : undefined;

  return (
    <Tiles count={5} className="dk-seo-ai-search-tiles">
      <CountTile
        label="Named without being asked"
        tone={unpromptedTone}
        info="Answers that named Balkaris, among the answers to questions that do not name it themselves (a service and a place, a price, advice): the owner's “0% on that side”. Each assistant's newest recorded answer to each question. A fixed set of questions, not a sample of what people ask."
        reading={unprompted}
      />
      <CountTile
        label="Answers naming Balkaris"
        info="Each assistant's newest recorded answer to each question that named Balkaris, the questions that name it included. An answer that could not be read whole is not counted as “not named”."
        reading={all}
      />
      <Tile
        label="Visits from AI assistants"
        info={r.state === "ok" ? r.value.rule : "GA4 sessions whose source is an AI assistant, consenting visitors only."}
        reading={visits}
        chart={(s) => <SparkBars data={s.series} />}
      />
      <Tile
        label="AI crawler requests"
        info="Requests by named AI and search crawlers (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Googlebot, Bingbot …) in Vercel's request records, on the days the drain delivered. Nothing else sees them."
        reading={crawlers}
        delta="none"
        chart={(s) => <SparkBars data={s.series} />}
      />
      <Tile
        label="Pages ready for AI answers"
        info="Sitemap pages that pass every readiness check that applies to their kind (a direct answer, questions answered, FAQ data, names Balkaris and its place, a price, a duration, a German version, a date), by the desk's daily read."
        reading={ready}
        delta="none"
      />
    </Tiles>
  );
}
