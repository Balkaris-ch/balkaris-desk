"use client";

import { useMemo, useState } from "react";
import type { Reading } from "@/contract/common";
import type { AiCheckRow, AiChecks, AiEngine } from "@/contract/seo/ai-search";
import { Badge, Chip, type ChipTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { PanelAbsent } from "@/components/seo/bits";
import { LangMark } from "@/components/seo/overview/bits";
import { cx } from "@/lib/cx";
import { fullDate, num } from "@/lib/format";
import "@/components/ui/table.css";
import "./ai-search.css";

const KIND_WORD: Record<AiCheckRow["kind"], string> = { brand: "By name", domain: "By address", category: "Service and place", price: "Price", advice: "Advice" };
const KIND_TONE: Record<AiCheckRow["kind"], ChipTone> = { brand: "quiet", domain: "quiet", category: "info", price: "warn", advice: "violet" };

type Filter = "all" | "unprompted" | "prompted" | "de" | "price";
const FILTERS: { key: Filter; label: string; test: (q: Question) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "unprompted", label: "Without the name", test: (q) => q.kind !== "brand" && q.kind !== "domain" },
  { key: "prompted", label: "By name", test: (q) => q.kind === "brand" || q.kind === "domain" },
  { key: "de", label: "German", test: (q) => q.lang === "de" },
  { key: "price", label: "Price", test: (q) => q.kind === "price" },
];

interface Question {
  key: string;
  question: string;
  lang: "de" | "en";
  kind: AiCheckRow["kind"];
  day: string;
  /** The newest answer of each assistant to it. */
  by: Map<AiEngine, AiCheckRow>;
  named: number;
  asked: number;
}

/** Whether Balkaris is listed at a cited directory, by the source as the answers showed it. */
export interface ListedAt {
  source: string;
  state: "exists" | "not-found" | "unknown" | "not-checked" | null;
  /** An owner task would put Balkaris there: a directory it belongs in. Without one, a missing profile is only noted. */
  wanted: boolean;
}

const LISTED_WORD: Record<NonNullable<ListedAt["state"]> | "none", { word: string; tone: ChipTone }> = {
  exists: { word: "Balkaris is listed", tone: "good" },
  "not-found": { word: "Balkaris not listed", tone: "bad" },
  unknown: { word: "Balkaris there: not confirmed", tone: "warn" },
  "not-checked": { word: "Not checked yet", tone: "quiet" },
  none: { word: "No profile of Balkaris known", tone: "bad" },
};

function Mark({ row }: { row: AiCheckRow | undefined }) {
  if (!row) return <span className="dk-seo-ai-search-cell dk-seo-ai-search-cell--none" title="Not asked">—</span>;
  if (row.mentioned === null)
    return (
      <span className="dk-seo-ai-search-cell dk-tone-warn" title="The answer could not be read whole">
        <Icon name="help" size={15} />
        <span className="dk-sr">Could not be read</span>
      </span>
    );
  return row.mentioned ? (
    <span className="dk-seo-ai-search-cell dk-tone-good" title={row.position ? `Named, place ${row.position}` : "Named"}>
      <Icon name="check-circle" size={15} />
      {row.position ? <span className="dk-num">#{row.position}</span> : null}
      <span className="dk-sr">Named</span>
    </span>
  ) : (
    <span className="dk-seo-ai-search-cell dk-tone-bad" title="Not named">
      <Icon name="x-circle" size={15} />
      <span className="dk-sr">Not named</span>
    </span>
  );
}

/** What each assistant said to one question: who it named, what it cited (and whether Balkaris is listed there), in the recorder's words. */
function Detail({ open, cols, listedBy }: { open: Question; cols: { engine: AiEngine; label: string }[]; listedBy: Map<string, ListedAt> }) {
  return (
    <>
      <p className="dk-seo-ai-search-qa-title">“{open.question}”</p>
      <p className="dk-seo-ai-search-qa-meta">
        <LangMark lang={open.lang} />
        <Chip tone={KIND_TONE[open.kind]}>{KIND_WORD[open.kind]}</Chip>
        <span className="dk-seo-ai-search-quiet">
          Asked {fullDate(open.day)} · named in {num(open.named)} of {num(open.asked)}
        </span>
      </p>
      <ol className="dk-seo-ai-search-said">
        {cols
          .filter((c) => open.by.has(c.engine))
          .map((c) => {
            const r = open.by.get(c.engine)!;
            return (
              <li key={c.engine} className="dk-seo-ai-search-said-item">
                <p className="dk-seo-ai-search-said-head">
                  <span className="dk-seo-ai-search-strong">{c.label}</span>
                  {r.mentioned === null ? (
                    <Badge tone="warn">Could not be read whole</Badge>
                  ) : r.mentioned ? (
                    <Badge tone="good" dot>
                      Named{r.position ? `, place ${r.position}` : ""}
                    </Badge>
                  ) : (
                    <Badge tone="bad" dot>
                      Not named
                    </Badge>
                  )}
                </p>
                {r.competitors.length ? (
                  <div className="dk-seo-ai-search-said-line">
                    <span className="dk-seo-ai-search-said-label">Named</span>
                    <span className="dk-seo-ai-search-chips">
                      {r.competitors.map((n, i) => (
                        <span key={`${n}-${i}`} className={cx("dk-seo-ai-search-name", /balkaris/i.test(n) && "dk-seo-ai-search-name--us")}>
                          <span className="dk-num dk-seo-ai-search-quiet">{i + 1}</span> {n}
                        </span>
                      ))}
                    </span>
                  </div>
                ) : null}
                {r.sources.length ? (
                  <div className="dk-seo-ai-search-said-line">
                    <span className="dk-seo-ai-search-said-label">Cited</span>
                    <span className="dk-seo-ai-search-chips">
                      {r.sources.map((s, i) => {
                        const own = /balkaris/i.test(s);
                        const l = listedBy.get(s.toLowerCase());
                        const at = !l ? null : l.state ? LISTED_WORD[l.state] : l.wanted ? LISTED_WORD.none : { word: "A platform; no profile of Balkaris known", tone: "quiet" as ChipTone };
                        return (
                          <span key={`${s}-${i}`} className={cx("dk-seo-ai-search-source", own && "dk-seo-ai-search-source--us", at && `dk-seo-ai-search-source--${at.tone}`)} title={own ? "The site itself" : (at?.word ?? "A company's own site")}>
                            {at ? <span className={cx("dk-seo-ai-search-source-dot", `dk-tone-${at.tone}`)} aria-hidden /> : null}
                            {s}
                            {at ? <span className="dk-sr"> ({at.word})</span> : null}
                          </span>
                        );
                      })}
                    </span>
                  </div>
                ) : null}
                {r.excerpt ? <p className="dk-seo-ai-search-said-text">{r.excerpt}</p> : null}
                {r.note ? <p className="dk-seo-ai-search-quiet dk-seo-ai-search-said-note">Note: {r.note}</p> : null}
                <p className="dk-seo-ai-search-quiet dk-seo-ai-search-said-by">
                  {r.by === "audit" ? "Recorded by the SEO audit" : r.by === "lead-chrome" ? "Recorded by hand from a browser" : "Recorded through the API"}, {fullDate(r.day)}
                </p>
              </li>
            );
          })}
      </ol>
      <p className="dk-seo-ai-search-legend dk-seo-ai-search-quiet">
        <span className="dk-seo-ai-search-source-dot dk-tone-good" aria-hidden /> listed
        <span className="dk-seo-ai-search-source-dot dk-tone-bad" aria-hidden /> not listed
        <span className="dk-seo-ai-search-source-dot dk-tone-warn" aria-hidden /> not confirmed
        <span className="dk-seo-ai-search-source-dot dk-tone-quiet" aria-hidden /> a platform, no profile known · no dot: a company's own site
      </p>
    </>
  );
}

/**
 * The questions and what each assistant said: one row per question, one
 * column per assistant (named, at which place, not named, could not be read,
 * not asked), each assistant's newest answer. A row opens beside the table:
 * each answer's named companies, the sources it cited (with whether Balkaris
 * is listed there: the place to be), and what it said in the recorder's
 * words. On a phone each question is a card with its assistants' marks, and
 * opens in place.
 */
export function Answers({ reading, engines, listed }: { reading: Reading<AiChecks>; engines: { engine: AiEngine; label: string }[]; listed: ListedAt[] }) {
  const [filter, setFilter] = useState<Filter>("unprompted");
  const [picked, setPicked] = useState<string | null>(null);
  const v = reading.state === "ok" ? reading.value : null;

  const questions = useMemo<Question[]>(() => {
    if (!v) return [];
    const by = new Map<string, Question>();
    /* One question, whatever its spacing or capitals; rows come newest day first, so the first answer of an assistant is its newest, and the first row gives the question's language and kind. */
    for (const r of v.rows) {
      const key = r.question.trim().replace(/\s+/g, " ").toLowerCase();
      const q = by.get(key) ?? { key, question: r.question, lang: r.lang, kind: r.kind, day: r.day, by: new Map(), named: 0, asked: 0 };
      if (!q.by.has(r.engine)) {
        q.by.set(r.engine, r);
        q.asked++;
        if (r.mentioned === true) q.named++;
      }
      if (r.day > q.day) q.day = r.day;
      by.set(key, q);
    }
    const order: AiCheckRow["kind"][] = ["category", "price", "advice", "brand", "domain"];
    return [...by.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.lang === b.lang ? 0 : a.lang === "de" ? -1 : 1) || a.question.localeCompare(b.question));
  }, [v]);

  const cols = useMemo(() => engines.filter((e) => questions.some((q) => q.by.has(e.engine))), [engines, questions]);
  const f = FILTERS.find((x) => x.key === filter)!;
  const shown = questions.filter(f.test);
  const open = shown.find((q) => q.key === picked) ?? shown[0] ?? null;
  const listedBy = useMemo(() => new Map(listed.map((l) => [l.source.toLowerCase(), l])), [listed]);

  return (
    <Card
      title="Questions and what each assistant said"
      icon="message"
      className="dk-seo-ai-search-panel"
      info="Every recorded question with each assistant's newest answer to it. Open a question to see who each answer named instead, which sources it cited and whether Balkaris is listed there: the places an assistant looks when it names studios. What an answer said is in the recorder's words, not the assistant's."
      sub={v ? `${num(questions.length)} questions · ${num(v.rows.length)} answers counted` : undefined}
    >
      {v ? (
        <>
          <div className="dk-seo-ai-search-filters" role="group" aria-label="Which questions">
            {FILTERS.map((x) => {
              const n = questions.filter(x.test).length;
              return (
                <button key={x.key} type="button" className={cx("dk-seo-ai-search-filter", filter === x.key && "dk-seo-ai-search-filter--on")} aria-pressed={filter === x.key} onClick={() => setFilter(x.key)}>
                  {x.label}
                  <span className="dk-num dk-seo-ai-search-filter-n">{num(n)}</span>
                </button>
              );
            })}
          </div>
          <div className="dk-seo-ai-search-qa">
            <div className="dk-table-wrap dk-seo-ai-search-qa-table dk-seo-ai-search-wide">
              <table className="dk-table dk-table--dense dk-table--caps">
                <caption className="dk-sr">Questions and whether each assistant's answer named Balkaris</caption>
                <thead>
                  <tr>
                    <th scope="col">Question</th>
                    {cols.map((c) => (
                      <th key={c.engine} scope="col" className="dk-table-center">
                        {c.label}
                      </th>
                    ))}
                    <th scope="col" className="dk-table-right">
                      Named
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((q) => (
                    <tr key={q.key} className={cx("dk-seo-ai-search-qa-row", open?.key === q.key && "dk-table-picked")} onClick={() => setPicked(q.key)}>
                      <td className="dk-seo-ai-search-qa-q">
                        <button type="button" className="dk-seo-ai-search-qa-open" aria-pressed={open?.key === q.key} onClick={() => setPicked(q.key)}>
                          <span className="dk-seo-ai-search-qa-text">{q.question}</span>
                          <span className="dk-seo-ai-search-qa-meta">
                            <LangMark lang={q.lang} />
                            <Chip tone={KIND_TONE[q.kind]}>{KIND_WORD[q.kind]}</Chip>
                          </span>
                        </button>
                      </td>
                      {cols.map((c) => (
                        <td key={c.engine} className="dk-table-center">
                          <Mark row={q.by.get(c.engine)} />
                        </td>
                      ))}
                      <td className={cx("dk-table-right", "dk-num", q.named === 0 && "dk-seo-ai-search-zero")}>
                        {num(q.named)} <span className="dk-seo-ai-search-quiet">of {num(q.asked)}</span>
                      </td>
                    </tr>
                  ))}
                  {!shown.length ? (
                    <tr className="dk-table-none">
                      <td colSpan={cols.length + 2}>No recorded question of this kind.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <aside className="dk-seo-ai-search-qa-detail dk-seo-ai-search-wide" aria-live="polite">
              {open ? <Detail open={open} cols={cols} listedBy={listedBy} /> : <p className="dk-seo-ai-search-quiet">Pick a question to see what each assistant said.</p>}
            </aside>

            {/* A phone: each question a card with every assistant's mark in view; the picked one opens in place. */}
            <ul className="dk-seo-ai-search-narrow dk-seo-ai-search-qa-cards" aria-label="Questions and whether each assistant's answer named Balkaris">
              {shown.map((q) => {
                /* On a phone nothing opens until a question is picked, and picking it again closes it. */
                const isOpen = !!picked && picked === q.key;
                return (
                  <li key={q.key} className={cx("dk-seo-ai-search-qa-card", isOpen && "dk-seo-ai-search-qa-card--open")}>
                    <button type="button" className="dk-seo-ai-search-qa-open" aria-expanded={isOpen} onClick={() => setPicked(isOpen ? "" : q.key)}>
                      <span className="dk-seo-ai-search-qa-card-text">{q.question}</span>
                      <span className="dk-seo-ai-search-qa-meta">
                        <LangMark lang={q.lang} />
                        <Chip tone={KIND_TONE[q.kind]}>{KIND_WORD[q.kind]}</Chip>
                        <span className={cx("dk-num", "dk-seo-ai-search-quiet", q.named === 0 && "dk-seo-ai-search-zero")}>
                          named in {num(q.named)} of {num(q.asked)}
                        </span>
                      </span>
                      <span className="dk-seo-ai-search-qa-card-marks">
                        {cols.map((c) => (
                          <span key={c.engine} className="dk-seo-ai-search-qa-card-mark">
                            <Mark row={q.by.get(c.engine)} />
                            <span className="dk-seo-ai-search-quiet">{c.label}</span>
                          </span>
                        ))}
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="dk-seo-ai-search-qa-detail dk-seo-ai-search-qa-card-detail" aria-live="polite">
                        <Detail open={q} cols={cols} listedBy={listedBy} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {!shown.length ? <li className="dk-seo-ai-search-quiet">No recorded question of this kind.</li> : null}
            </ul>
          </div>
        </>
      ) : reading.state !== "ok" ? (
        <PanelAbsent reading={reading} />
      ) : null}
    </Card>
  );
}
