import type { Reading } from "@/contract/common";
import type { AiAnswerNow, AiAnswers, AiCell, AiCheckRow, AiEngine, AiQuestionDetail, AiSearchAsked } from "@/contract/seo/ai-search";
import { Badge, Chip, type ChipTone } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { PanelAbsent } from "@/components/seo/bits";
import { LangMark } from "@/components/seo/overview/bits";
import { cx } from "@/lib/cx";
import { fullDate, num } from "@/lib/format";
import { AiTaskButton, PostButton } from "./Act";
import { BASE, competitorHref, exportHref, hrefWith, paramsOf } from "./look";
import { EditAnswer, RecordAnswers, type Known } from "./RecordAnswers";
import { RecordRound, TrackQuestion } from "./Round";
import "@/components/ui/table.css";
import "./ai-search.css";

const KIND_WORD: Record<AiCheckRow["kind"], string> = { brand: "By name", domain: "By address", category: "Service and place", price: "Price", advice: "Advice" };
const KIND_TONE: Record<AiCheckRow["kind"], ChipTone> = { brand: "quiet", domain: "quiet", category: "info", price: "warn", advice: "violet" };
const RECORDED_BY: Record<string, string> = { audit: "Recorded by the SEO audit", "lead-chrome": "Recorded by hand from a browser", api: "Recorded through the API" };
const FIND = "dk-seo-ai-search-find-answers";

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

function Mark({ cell }: { cell: AiCell | null }) {
  if (!cell)
    return (
      <span className="dk-seo-ai-search-cell dk-seo-ai-search-cell--none" title="Never asked this">
        —<span className="dk-sr">Never asked</span>
      </span>
    );
  if (cell.mentioned === null)
    return (
      <span className="dk-seo-ai-search-cell dk-tone-warn" title={`The answer of ${fullDate(cell.day)} could not be read whole`}>
        <Icon name="help" size={15} />
        <span className="dk-sr">Could not be read</span>
      </span>
    );
  return cell.mentioned ? (
    <span className="dk-seo-ai-search-cell dk-tone-good" title={`Named${cell.position ? `, place ${cell.position}` : ""}, ${fullDate(cell.day)}`}>
      <Icon name="check-circle" size={15} />
      {cell.position ? <span className="dk-num">#{cell.position}</span> : null}
      <span className="dk-sr">Named</span>
    </span>
  ) : (
    <span className="dk-seo-ai-search-cell dk-tone-bad" title={`Not named, ${fullDate(cell.day)}`}>
      <Icon name="x-circle" size={15} />
      <span className="dk-sr">Not named</span>
    </span>
  );
}

const saidBadge = (r: AiCheckRow) =>
  r.mentioned === null ? (
    <Badge tone="warn">Could not be read whole</Badge>
  ) : r.mentioned ? (
    <Badge tone="good" dot>
      Named{r.position ? `, place ${r.position}` : ""}
    </Badge>
  ) : (
    <Badge tone="bad" dot>
      Not named
    </Badge>
  );

/** One assistant's newest answer: who it named, what it cited (and whether Balkaris is listed there), what changed since its answer before, the earlier ones. */
function Said({ a, listedBy, owner, engines, known }: { a: AiAnswerNow; listedBy: Map<string, ListedAt>; owner: boolean; engines: { engine: AiEngine; label: string }[]; known: Known[] }) {
  const r = a.now;
  return (
    <li className="dk-seo-ai-search-said-item">
      <p className="dk-seo-ai-search-said-head">
        <span className="dk-seo-ai-search-strong">{r.engineLabel}</span>
        {saidBadge(r)}
      </p>
      {a.change ? (
        <p className="dk-seo-ai-search-change">
          <Icon name="refresh" size={12} />
          <span>{a.change}</span>
        </p>
      ) : null}
      {r.competitors.length ? (
        <div className="dk-seo-ai-search-said-line">
          <span className="dk-seo-ai-search-said-label">Named</span>
          <span className="dk-seo-ai-search-chips">
            {r.competitors.map((n, i) =>
              /balkaris/i.test(n) ? (
                <span key={`${n}-${i}`} className="dk-seo-ai-search-name dk-seo-ai-search-name--us">
                  <span className="dk-num dk-seo-ai-search-quiet">{i + 1}</span> {n}
                </span>
              ) : (
                <Go key={`${n}-${i}`} href={competitorHref(n)} className="dk-seo-ai-search-name" title={`${n} on Competitors`}>
                  <span className="dk-num dk-seo-ai-search-quiet">{i + 1}</span> {n}
                </Go>
              ),
            )}
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
      <div className="dk-seo-ai-search-said-foot">
        <span className="dk-seo-ai-search-quiet dk-seo-ai-search-said-by">
          {RECORDED_BY[r.by] ?? `Recorded by ${r.by}`}, {fullDate(r.day)}
        </span>
        {owner ? (
          <span className="dk-seo-ai-search-said-acts">
            <EditAnswer row={r} engines={engines} questions={known} />
            <PostButton
              path={`/record/${r.id}/remove`}
              label="Remove"
              busyLabel="Removing…"
              variant="ghost"
              icon="trash"
              confirm={`Remove ${r.engineLabel}'s answer of ${r.day}? It stops counting, and importing the audit again will not bring it back.`}
            />
          </span>
        ) : null}
      </div>
      {a.earlier.length ? (
        <details className="dk-seo-ai-search-earlier">
          <summary>
            {num(a.earlier.length)} earlier answer{a.earlier.length === 1 ? "" : "s"}
            <Icon name="chevron-down" size={12} />
          </summary>
          <ol>
            {a.earlier.map((e) => (
              <li key={e.id}>
                <span className="dk-seo-ai-search-quiet">{fullDate(e.day)}</span>
                {saidBadge(e)}
                {e.competitors.length ? <span className="dk-seo-ai-search-quiet">Named: {e.competitors.join(", ")}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </li>
  );
}

/** One question in detail: each assistant's newest answer, the assistants never asked it, and what to do about it. */
function Detail({ open, listedBy, owner, engines, known, back }: { open: AiQuestionDetail; listedBy: Map<string, ListedAt>; owner: boolean; engines: { engine: AiEngine; label: string }[]; known: Known[]; back?: string }) {
  const asked = new Set(open.answers.map((a) => a.now.engine));
  const never = engines.filter((e) => !asked.has(e.engine));
  const preset: Known = { question: open.question, lang: open.lang, kind: open.kind };
  return (
    <>
      <p className="dk-seo-ai-search-qa-title">“{open.question}”</p>
      <p className="dk-seo-ai-search-qa-meta">
        <LangMark lang={open.lang} />
        <Chip tone={KIND_TONE[open.kind]}>{KIND_WORD[open.kind]}</Chip>
        {!open.active ? <Chip tone="quiet">Retired</Chip> : null}
        <span className="dk-seo-ai-search-quiet">{open.day ? `Last answered ${fullDate(open.day)} · named in ${num(open.answers.filter((a) => a.now.mentioned === true).length)} of ${num(open.answers.length)}` : "No assistant asked yet"}</span>
      </p>
      {owner ? (
        <div className="dk-seo-ai-search-detail-acts">
          {never.length ? <RecordAnswers engines={engines} questions={known} owner preset={{ engine: never[0]!.engine, question: preset }} trigger={{ label: "Record an answer", size: "xs", variant: "quiet", icon: "plus" }} /> : null}
          <PostButton
            path="/questions"
            body={{ question: open.question, lang: open.lang, kind: open.kind, active: !open.active }}
            label={open.active ? "Retire" : "Track again"}
            busyLabel={open.active ? "Retiring…" : "Adding…"}
            variant="ghost"
            icon={open.active ? "minus" : "plus"}
            title={open.active ? "Leave it out of the rounds ahead; its answers are kept and leave the counts" : "Put it back on the list"}
          />
        </div>
      ) : null}
      {open.answers.length ? (
        <ol className="dk-seo-ai-search-said">
          {open.answers.map((a) => (
            <Said key={a.now.id} a={a} listedBy={listedBy} owner={owner} engines={engines} known={known} />
          ))}
        </ol>
      ) : null}
      {never.length ? <p className="dk-seo-ai-search-quiet">Never asked this: {never.map((e) => e.label).join(", ")}.</p> : null}
      {open.tasks.length ? (
        <div className="dk-seo-ai-search-detail-tasks">
          <p className="dk-seo-ai-search-sublabel">For the operator</p>
          {open.tasks.map((t) => (
            <AiTaskButton key={t.label} task={t.task} label={t.label} icon={t.task.kind === "brief" ? "file-text" : "message"} />
          ))}
          <p className="dk-seo-ai-search-quiet">The studio workstation’s own model writes it; nothing reaches the website without approval.</p>
        </div>
      ) : null}
      <p className="dk-seo-ai-search-legend dk-seo-ai-search-quiet">
        <span className="dk-seo-ai-search-source-dot dk-tone-good" aria-hidden /> listed
        <span className="dk-seo-ai-search-source-dot dk-tone-bad" aria-hidden /> not listed
        <span className="dk-seo-ai-search-source-dot dk-tone-warn" aria-hidden /> not confirmed
        <span className="dk-seo-ai-search-source-dot dk-tone-quiet" aria-hidden /> a platform, no profile known · no dot: a company's own site
      </p>
      {back ? (
        <Go href={back} scroll={false} replace className="dk-seo-ai-search-link">
          Close
        </Go>
      ) : null}
    </>
  );
}

/**
 * The questions and what each assistant said: one row per tracked question
 * (put on the list by a person, or recorded), one column per assistant
 * (named, at which place, not named, could not be read, never asked). An
 * empty cell is what a round still has to record. Every filter, the search
 * and the opened question are in the address, so the server draws them and a
 * view can be shared. The opened question shows each assistant's answer, what
 * changed since its answer before, its earlier answers, and the owner's
 * corrections; on a phone each question is a card that opens in place.
 */
export function Answers({
  reading,
  asked,
  range,
  engines,
  listed,
  owner,
}: {
  reading: Reading<AiAnswers>;
  asked: AiSearchAsked;
  range: string;
  engines: { engine: AiEngine; label: string }[];
  listed: ListedAt[];
  owner: boolean;
}) {
  const v = reading.state === "ok" ? reading.value : null;
  const base = paramsOf(range, asked);
  const listedBy = new Map(listed.map((l) => [l.source.toLowerCase(), l]));
  const known: Known[] = v ? v.all.map((q) => ({ question: q.question, lang: q.lang, kind: q.kind })) : [];
  const openKey = v?.open?.key ?? null;
  const filtered = !!asked.q || asked.engine !== "all";

  return (
    <>
      <form id={FIND} method="get" action={BASE} hidden>
        {Object.entries(base)
          .filter(([k]) => k !== "q" && k !== "open")
          .map(([k, val]) => (
            <input key={k} type="hidden" name={k} value={val} />
          ))}
      </form>
      <Card
        id="answers"
        title="Questions and what each assistant said"
        icon="message"
        className="dk-seo-ai-search-panel"
        info="Every tracked question with each assistant's newest answer to it: the questions a person put on the list, and every question ever recorded until a person retires it. Open a question to see who each answer named instead, which sources it cited and whether Balkaris is listed there, what changed since the answer before, and the earlier answers. What an answer said is in the recorder's words, not the assistant's."
        sub={v ? `${num(v.tracked)} questions tracked · ${num(v.counted)} of ${num(v.pairs)} question and assistant pairs answered, ${num(v.neverAsked)} never asked` : undefined}
        right={
          <span className="dk-seo-ai-search-head-acts">
            <TrackQuestion owner={owner} />
            <LinkButton href={exportHref("answers")} size="sm" icon="download" title="Every answer kept, as CSV">
              CSV
            </LinkButton>
          </span>
        }
      >
        {v ? (
          <>
            <div className="dk-seo-ai-search-toolbar">
              <label className="dk-seo-ai-search-find">
                <Icon name="search" size={14} />
                <input form={FIND} type="search" name="q" defaultValue={asked.q} placeholder="Search questions, names, sources…" aria-label="Search the questions, the companies named, the sources cited and what the answers said" maxLength={80} />
              </label>
              <Select param="engine" label="Which assistant" fallback="all" resets={["open"]} options={[{ value: "all", label: "Every assistant" }, ...engines.map((e) => ({ value: e.engine, label: e.label }))]} />
            </div>
            <div className="dk-seo-ai-search-filters" role="group" aria-label="Which questions">
              {v.chips.map((x) => (
                <Go
                  key={x.key}
                  href={hrefWith(base, { show: x.key === (asked.q ? "all" : "unprompted") ? undefined : x.key, open: undefined }, "answers")}
                  scroll={false}
                  replace
                  className={cx("dk-seo-ai-search-filter", asked.show === x.key && "dk-seo-ai-search-filter--on")}
                  aria-current={asked.show === x.key ? "true" : undefined}
                >
                  {x.label}
                  <span className="dk-num dk-seo-ai-search-filter-n">{num(x.count)}</span>
                </Go>
              ))}
              {filtered ? (
                <Go href={hrefWith(base, { q: undefined, engine: undefined, open: undefined, show: undefined }, "answers")} scroll={false} replace className="dk-seo-ai-search-link dk-seo-ai-search-clear">
                  Clear search
                </Go>
              ) : null}
            </div>
            <div className="dk-seo-ai-search-qa">
              <div className="dk-table-wrap dk-seo-ai-search-qa-table dk-seo-ai-search-wide">
                <table className="dk-table dk-table--dense dk-table--caps">
                  <caption className="dk-sr">Questions and whether each assistant's answer named Balkaris</caption>
                  <thead>
                    <tr>
                      <th scope="col">Question</th>
                      {v.cols.map((c) => (
                        <th key={c.engine} scope="col" className="dk-table-center" title={`${num(c.answers)} of these questions answered`}>
                          {c.label}
                        </th>
                      ))}
                      <th scope="col" className="dk-table-right">
                        Named
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.questions.map((q) => (
                      <tr key={q.key} className={cx("dk-seo-ai-search-qa-row", openKey === q.key && "dk-table-picked")}>
                        <td className="dk-seo-ai-search-qa-q">
                          <Go href={hrefWith(base, { open: q.key }, "answers")} scroll={false} replace className="dk-seo-ai-search-qa-open" aria-current={openKey === q.key ? "true" : undefined}>
                            <span className="dk-seo-ai-search-qa-text">{q.question}</span>
                            <span className="dk-seo-ai-search-qa-meta">
                              <LangMark lang={q.lang} />
                              <Chip tone={KIND_TONE[q.kind]}>{KIND_WORD[q.kind]}</Chip>
                              {q.listed ? <span className="dk-seo-ai-search-quiet">on the list</span> : null}
                            </span>
                          </Go>
                        </td>
                        {q.cells.map((cell, i) => (
                          <td key={v.cols[i]!.engine} className="dk-table-center">
                            <Mark cell={cell} />
                          </td>
                        ))}
                        <td className={cx("dk-table-right", "dk-num", q.asked > 0 && q.named === 0 && "dk-seo-ai-search-zero")}>
                          {q.asked ? (
                            <>
                              {num(q.named)} <span className="dk-seo-ai-search-quiet">of {num(q.asked)}</span>
                            </>
                          ) : (
                            <span className="dk-seo-ai-search-quiet">not asked</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!v.questions.length ? (
                      <tr className="dk-table-none">
                        <td colSpan={v.cols.length + 2}>{asked.q ? `No tracked question, name, source or answer matches “${asked.q}”.` : "No tracked question of this kind."}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <aside className="dk-seo-ai-search-qa-detail dk-seo-ai-search-wide" aria-live="polite">
                {v.open ? <Detail open={v.open} listedBy={listedBy} owner={owner} engines={engines} known={known} /> : <p className="dk-seo-ai-search-quiet">Pick a question to see what each assistant said.</p>}
              </aside>

              {/* A phone: each question a card with every assistant's mark in view; the one the address opens shows in place. */}
              <ul className="dk-seo-ai-search-narrow dk-seo-ai-search-qa-cards" aria-label="Questions and whether each assistant's answer named Balkaris">
                {v.questions.map((q) => {
                  const isOpen = asked.open === q.key && v.open?.key === q.key;
                  return (
                    <li key={q.key} className={cx("dk-seo-ai-search-qa-card", isOpen && "dk-seo-ai-search-qa-card--open")}>
                      <Go href={hrefWith(base, { open: isOpen ? undefined : q.key }, "answers")} scroll={false} replace className="dk-seo-ai-search-qa-open" aria-expanded={isOpen}>
                        <span className="dk-seo-ai-search-qa-card-text">{q.question}</span>
                        <span className="dk-seo-ai-search-qa-meta">
                          <LangMark lang={q.lang} />
                          <Chip tone={KIND_TONE[q.kind]}>{KIND_WORD[q.kind]}</Chip>
                          <span className={cx("dk-num", "dk-seo-ai-search-quiet", q.asked > 0 && q.named === 0 && "dk-seo-ai-search-zero")}>{q.asked ? `named in ${num(q.named)} of ${num(q.asked)}` : "not asked yet"}</span>
                        </span>
                        <span className="dk-seo-ai-search-qa-card-marks">
                          {v.cols.map((c, i) => (
                            <span key={c.engine} className="dk-seo-ai-search-qa-card-mark">
                              <Mark cell={q.cells[i] ?? null} />
                              <span className="dk-seo-ai-search-quiet">{c.label}</span>
                            </span>
                          ))}
                        </span>
                      </Go>
                      {isOpen && v.open ? (
                        <div className="dk-seo-ai-search-qa-detail dk-seo-ai-search-qa-card-detail" aria-live="polite">
                          <Detail open={v.open} listedBy={listedBy} owner={owner} engines={engines} known={known} back={hrefWith(base, { open: undefined }, "answers")} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
                {!v.questions.length ? <li className="dk-seo-ai-search-quiet">No tracked question of this kind.</li> : null}
              </ul>
            </div>
            {v.retired.length ? (
              <details className="dk-seo-ai-search-retired">
                <summary>
                  {num(v.retired.length)} retired question{v.retired.length === 1 ? "" : "s"}: kept with their answers, left out of every count
                  <Icon name="chevron-down" size={12} />
                </summary>
                <ul>
                  {v.retired.map((r) => (
                    <li key={r.key}>
                      <Go href={hrefWith(base, { open: r.key }, "answers")} scroll={false} replace className="dk-seo-ai-search-link">
                        {r.question}
                      </Go>
                      <span className="dk-seo-ai-search-quiet">
                        {num(r.answers)} answer{r.answers === 1 ? "" : "s"}
                      </span>
                      {owner ? <PostButton path="/questions" body={{ question: r.question, lang: r.lang, kind: r.kind, active: true }} label="Track again" busyLabel="Adding…" icon="plus" /> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {owner ? (
              <p className="dk-seo-ai-search-line dk-seo-ai-search-quiet">
                {v.neverAsked ? `${num(v.neverAsked)} question and assistant pairs were never asked: ` : "Every pair has an answer. A new round: "}
                <RecordRound engines={engines} questions={known} owner={owner} /> records one assistant&apos;s answers to every question at once.
              </p>
            ) : null}
          </>
        ) : reading.state !== "ok" ? (
          <>
            <PanelAbsent reading={reading} />
            {owner ? (
              <p className="dk-seo-ai-search-line">
                <TrackQuestion owner={owner} />
              </p>
            ) : null}
          </>
        ) : null}
      </Card>
    </>
  );
}
