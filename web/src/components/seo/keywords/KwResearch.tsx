import type { ResearchMode, ResearchResult, WebSuggestion } from "@/contract/seo/common";
import type { ResearchPanel } from "@/contract/seo/keywords";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { DASH, num, shortDate } from "@/lib/format";
import { closeHref, openHref, type Place } from "./href";
import { ResearchActions, ResearchBox, ResearchThis, ResearchTicks, WhoRanks } from "./KwWeb";
import { langLabel, STATUS_LABEL } from "./look";

/**
 * Research on the web: the first thing on SEO › Keywords. A person types any
 * phrase, its language and what to look for; the desk asks Google's and Bing's
 * suggestions through its web layer (one request a second, within today's
 * allowance, the last seven days' answers re-used) and lists what people type,
 * grouped, with the engines that offered each, Google's ordering strength
 * (named for what it is: an order, never a volume), whether the desk tracks it
 * and the topic it would file it under. The address holds the research
 * (?research=&rlang=&rmodes=), so it can be linked and survives a reload.
 */

/** Google's strength runs from about 550 to 1300: the bar starts at 500. */
const STRENGTH_FLOOR = 500;
const STRENGTH_TOP = 1300;

const GROUPS: { key: string; label: string; of: (s: WebSuggestion) => boolean }[] = [
  { key: "questions", label: "Questions", of: (s) => s.modes[0] === "questions" || s.question },
  { key: "modifiers", label: "With a word added", of: (s) => s.modes[0] === "modifiers" && !s.question },
  { key: "complete", label: "Completions", of: (s) => s.modes[0] !== "questions" && s.modes[0] !== "modifiers" && !s.question },
];

const MODE_LABEL: Record<ResearchMode, string> = { plain: "completion", front: "word in front", alphabet: "a to z", questions: "question", modifiers: "word added" };

function columns(place: Place, r: ResearchResult): Column<WebSuggestion>[] {
  return [
    {
      key: "phrase",
      head: "What people type",
      cell: (s) => (
        <span className="dk-seo-kw-phrase">
          <span className="dk-seo-kw-phrase-text" title={`Found by asking “${s.via}”`}>
            {s.phrase}
          </span>
          <span className="dk-seo-kw-phrase-sub">{s.modes.map((m) => MODE_LABEL[m]).join(", ")}</span>
        </span>
      ),
    },
    {
      key: "engines",
      head: "Offered by",
      cell: (s) => (
        <span className="dk-seo-kw-engines">
          {s.sources.map((e) => (
            <Chip key={e} tone={e === "google" ? "info" : "quiet"}>
              {e === "google" ? "Google" : "Bing"}
            </Chip>
          ))}
        </span>
      ),
    },
    {
      key: "strength",
      head: <span title="Google's own ordering strength for the suggestion (suggestrelevance, about 550 to 1300): the order Google offers it in. Not a search volume.">Google&apos;s order</span>,
      cell: (s) =>
        s.strength === null ? (
          <span className="dk-seo-kw-none" title="Only Bing offered it.">
            {DASH}
          </span>
        ) : (
          <span className="dk-seo-kw-strength" title={`Google's ordering strength ${s.strength}: how high Google places it among its suggestions. Not a search volume.`}>
            <ProgressBar value={s.strength - STRENGTH_FLOOR} max={STRENGTH_TOP - STRENGTH_FLOOR} label="Google's ordering strength" tone="info" />
            <span className="dk-num">{num(s.strength)}</span>
          </span>
        ),
    },
    {
      key: "tracked",
      head: "The desk",
      cell: (s) =>
        s.tracked ? (
          <Go href={openHref(place, s.tracked.id)} scroll={false} className="dk-seo-kw-topic" title="Tracked: open its own view">
            Tracked · {STATUS_LABEL[s.tracked.status].toLowerCase()}
          </Go>
        ) : (
          <span className="dk-seo-kw-none">Not tracked</span>
        ),
    },
    {
      key: "topic",
      head: "Topic",
      cell: (s) =>
        s.cluster ? (
          <span className="dk-seo-kw-topic" title={s.cluster.filed === "table" ? "The topic the table files it under" : "The topic the desk would file it under, by the words it shares with that topic's phrases"}>
            {s.cluster.name}
            {s.cluster.filed === "words" ? " (suggested)" : ""}
          </span>
        ) : (
          <span className="dk-seo-kw-none" title="No topic of its language shares enough of its words.">
            No topic
          </span>
        ),
    },
    {
      key: "act",
      head: "",
      align: "right",
      cell: (s) => (
        <span className="dk-seo-kw-actions">
          <ResearchThis place={place} phrase={s.phrase} lang={r.lang} label="Research" />
          <WhoRanks place={place} phrase={s.phrase} lang={r.lang} id={s.tracked?.id ?? null} cluster={s.tracked?.cluster ?? s.cluster?.key ?? null} label="Who ranks" />
        </span>
      ),
    },
  ];
}

function Answer({ place, r }: { place: Place; r: ResearchResult }) {
  const filed = Object.fromEntries(r.suggestions.map((s) => [s.phrase, s.tracked?.cluster ?? s.cluster?.key ?? null]));
  return (
    <>
      <p className="dk-seo-kw-basis">
        {r.line} {langLabel(r.lang)}, as searched from {r.country.toUpperCase()}.
      </p>
      <ul className="dk-seo-kw-rsources">
        {r.sources.map((s) => (
          <li key={s.source}>
            <strong>{s.label}</strong>: {s.line}
          </li>
        ))}
      </ul>
      {r.stopped ? <p className="dk-seo-kw-said dk-seo-kw-said--bad">{r.stopped}</p> : null}
      {r.suggestions.length ? (
        <>
          <ResearchTicks>
            {GROUPS.map((g) => {
              const rows = r.suggestions.filter(g.of);
              if (!rows.length) return null;
              return (
                <section key={g.key} className="dk-seo-kw-rgroup" aria-label={g.label}>
                  <h3 className="dk-seo-kw-rgroup-head">
                    {g.label} <span className="dk-num">{num(rows.length)}</span>
                  </h3>
                  <Table caption={g.label} className="dk-seo-kw-table" rows={rows} rowKey={(s) => s.phrase} select={{ name: "pick", label: (s) => s.phrase }} minWidth={760} columns={columns(place, r)} />
                </section>
              );
            })}
            <ResearchActions seed={r.seed} lang={r.lang} filed={filed} />
          </ResearchTicks>
        </>
      ) : (
        <p className="dk-seo-kw-basis">No engine offered anything for it in these ways.</p>
      )}
    </>
  );
}

export function KwResearch({ lookup, place }: { lookup: ResearchPanel; place: Place }) {
  const a = lookup.allowance;
  const res = lookup.result;
  return (
    <Card
      className="dk-seo-kw-rcard"
      title="Research on the web"
      icon="search"
      info="What people type into Google and Bing around a phrase, from their own suggestions: completions, questions, the phrase with a word added. Google's order is the strength Google gives a suggestion, not a search volume. Every answer is kept seven days, so looking again sends nothing."
      right={
        lookup.seed ? (
          <Go href={closeHref(place, "research")} scroll={false} className="dk-seo-kw-reset">
            Close the research
          </Go>
        ) : undefined
      }
    >
      <ResearchBox place={place} seed={lookup.seed} lang={lookup.lang} modes={lookup.modes} kept={res?.state === "ok"} />
      <p className="dk-seo-kw-basis">
        Today {num(a.left)} of {num(a.cap)} research requests are left; one research in the usual ways sends about 31.
        {lookup.paused.map((p) => ` ${p.source === "google" ? "Google" : "Bing"} is paused until ${shortDate(p.until)}: ${p.why}.`).join("")}
      </p>
      {res === null ? null : res.state === "ok" ? (
        <>
          <Answer place={place} r={res.value} />
          <Stamp reading={res} />
        </>
      ) : (
        <Absent reading={res} form="inline" />
      )}
    </Card>
  );
}
