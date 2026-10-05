import type { Reading } from "@/contract/common";
import type { AiCheckRow, AiChecks, AiEngine, AiRound } from "@/contract/seo/ai-search";
import { Bar } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { fullDate, num } from "@/lib/format";
import { RecordAnswers, type Known } from "./RecordAnswers";
import { RecordRound } from "./Round";
import "@/components/ui/table.css";
import "./ai-search.css";

/** "2 of 8": always the counts, a share of eight answers is not a percentage. */
const of = (n: number, d: number) => (
  <span className="dk-num">
    <b>{num(n)}</b> <span className="dk-seo-ai-search-quiet">of {num(d)}</span>
  </span>
);

const KIND_NAME: Record<string, string> = {
  category: "A service and a place",
  price: "A price",
  advice: "Advice",
  brand: "Names Balkaris",
  domain: "Names balkaris.ch",
};

/** "2 Oct 2026", or "28 Sep 2026 – 2 Oct 2026" when the answers counted were recorded on several days. */
const span = (since: string, day: string) => (since === day ? fullDate(day) : `${fullDate(since)} – ${fullDate(day)}`);

/** Answers grouped one way, each group's named of asked as counts and a bar; the order is the names' order. */
function Groups({ rows, of: by, names }: { rows: AiCheckRow[]; of: (r: AiCheckRow) => string; names: Record<string, string> }) {
  const groups = Object.keys(names)
    .map((k) => {
      const mine = rows.filter((r) => by(r) === k);
      return { key: k, asked: mine.length, named: mine.filter((r) => r.mentioned === true).length, unread: mine.filter((r) => r.mentioned === null).length };
    })
    .filter((g) => g.asked > 0);
  if (!groups.length) return <p className="dk-seo-ai-search-quiet">None recorded.</p>;
  return (
    <ul className="dk-seo-ai-search-kind-list">
      {groups.map((g) => (
        <li key={g.key}>
          <span className="dk-seo-ai-search-strong">{names[g.key]}</span>
          <span className={cx(g.named === 0 && "dk-seo-ai-search-zero")}>
            {of(g.named, g.asked)}
            {g.unread ? <span className="dk-seo-ai-search-quiet"> · {num(g.unread)} unread</span> : null}
          </span>
          <Bar value={g.named} max={g.asked} tone={g.named ? "good" : "bad"} label={`${g.named} of ${g.asked} answers named Balkaris`} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The rounds, newest first, compared by SHARE: each round's answers to
 * questions that do not name Balkaris, the bar the part of them that named it
 * (a full bar is every one), with the counts beside it. A round is a recorded
 * day, so rounds differ in size; a count of named answers would rise with
 * more questions and no change in share.
 */
function Rounds({ rounds }: { rounds: AiRound[] }) {
  return (
    <ol className="dk-seo-ai-search-round-list">
      {[...rounds].reverse().map((r) => (
        <li key={r.day}>
          <span className="dk-seo-ai-search-quiet dk-seo-ai-search-round-day">{fullDate(r.day)}</span>
          <span className="dk-seo-ai-search-round-share">
            <Bar
              value={r.unprompted.mentioned}
              max={r.unprompted.asked || 1}
              tone={!r.unprompted.asked ? "quiet" : r.unprompted.mentioned ? "good" : "bad"}
              label={`${r.unprompted.mentioned} of ${r.unprompted.asked} answers to questions without the name named Balkaris`}
            />
          </span>
          <span className={cx("dk-seo-ai-search-round-n", r.unprompted.mentioned === 0 && r.unprompted.asked > 0 && "dk-seo-ai-search-zero")}>
            {of(r.unprompted.mentioned, r.unprompted.asked)} <span className="dk-seo-ai-search-quiet">without the name</span>
          </span>
          <span className="dk-seo-ai-search-round-n">
            {of(r.mentioned, r.asked)} <span className="dk-seo-ai-search-quiet">in all</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Answers by assistant: for each assistant, its newest answer to each
 * question asked of it (asked, named, named without the name in the
 * question), so one new answer replaces one old one and never shrinks the
 * set; the rounds over time by share; and the assistants never asked.
 * "Record answers" is the owner's: one answer, as a person read it in a
 * browser.
 */
export function Engines({ reading, engines, owner, known }: { reading: Reading<AiChecks>; engines: { engine: AiEngine; label: string }[]; owner: boolean; known: Known[] }) {
  const v = reading.state === "ok" ? reading.value : null;
  const asked = new Set(v?.tally.map((t) => t.engine) ?? []);
  const never = engines.filter((e) => !asked.has(e.engine));

  return (
    <Card
      title="Answers by assistant"
      icon="robot"
      className="dk-seo-ai-search-panel"
      info="Per assistant, its newest recorded answer to each question asked of it: questions asked, answers that named Balkaris, and the same for questions that do not name Balkaris themselves. A newer answer to a question replaces the older one; a later record of the same question, assistant and day replaces the earlier one. Counts, never percentages: a round is a few questions. Answers are recorded by a person or an API; no job asks the assistants by itself."
      right={
        <span className="dk-seo-ai-search-head-acts">
          <RecordRound engines={engines} questions={known} owner={owner} />
          <RecordAnswers engines={engines} questions={known} owner={owner} />
        </span>
      }
    >
      {v ? (
        <>
          <div className="dk-table-wrap dk-seo-ai-search-wide">
            <table className="dk-table dk-table--dense dk-table--caps dk-seo-ai-search-engines">
              <caption className="dk-sr">Answers by assistant: its newest answer to each question</caption>
              <thead>
                <tr>
                  <th scope="col">Assistant</th>
                  <th scope="col">Answered</th>
                  <th scope="col" className="dk-table-right">
                    Named
                  </th>
                  <th scope="col" className="dk-table-right">
                    Without the name
                  </th>
                  <th scope="col" aria-label="Share named" />
                </tr>
              </thead>
              <tbody>
                {v.tally.map((t) => (
                  <tr key={t.engine}>
                    <td className="dk-seo-ai-search-strong">{t.label}</td>
                    <td className="dk-seo-ai-search-quiet">{span(t.since, t.day)}</td>
                    <td className="dk-table-right">{of(t.mentioned, t.asked)}</td>
                    <td className={cx("dk-table-right", t.unprompted.mentioned === 0 && "dk-seo-ai-search-zero")}>{of(t.unprompted.mentioned, t.unprompted.asked)}</td>
                    <td className="dk-seo-ai-search-engine-bar">
                      <Bar value={t.mentioned} max={t.asked} tone={t.mentioned ? "good" : "bad"} label={`${t.mentioned} of ${t.asked} answers named Balkaris`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* A phone: each assistant on two lines, the key figure in view. */}
          <ul className="dk-seo-ai-search-narrow dk-seo-ai-search-engine-list" aria-label="Answers by assistant: its newest answer to each question">
            {v.tally.map((t) => (
              <li key={t.engine}>
                <p className="dk-seo-ai-search-engine-list-head">
                  <span className="dk-seo-ai-search-strong">{t.label}</span>
                  <span className="dk-seo-ai-search-quiet">{span(t.since, t.day)}</span>
                </p>
                <p className="dk-seo-ai-search-engine-list-figures">
                  <span>Named {of(t.mentioned, t.asked)}</span>
                  <span className={cx(t.unprompted.mentioned === 0 && "dk-seo-ai-search-zero")}>Without the name {of(t.unprompted.mentioned, t.unprompted.asked)}</span>
                </p>
              </li>
            ))}
          </ul>

          <div className="dk-seo-ai-search-kinds">
            <div>
              <p className="dk-seo-ai-search-sublabel">By kind of question</p>
              <Groups rows={v.rows} of={(r) => r.kind} names={KIND_NAME} />
            </div>
            <div>
              <p className="dk-seo-ai-search-sublabel">By language</p>
              <Groups rows={v.rows} of={(r) => r.lang} names={{ de: "German questions", en: "English questions" }} />
            </div>
          </div>

          <p className="dk-seo-ai-search-sublabel">Over time</p>
          {v.rounds.length < 2 ? (
            <p className="dk-seo-ai-search-line">
              {v.rounds.length === 1 ? (
                <>
                  One round recorded, on {fullDate(v.rounds[0]!.day)}: {num(v.rounds[0]!.asked)} answers, Balkaris named in {num(v.rounds[0]!.mentioned)}; of the {num(v.rounds[0]!.unprompted.asked)} answers to questions without its name, {num(v.rounds[0]!.unprompted.mentioned)} named it.
                  Rounds are compared from the second on, by share.
                </>
              ) : null}
            </p>
          ) : (
            <Rounds rounds={v.rounds} />
          )}
          {v.replaced ? (
            <p className="dk-seo-ai-search-line dk-seo-ai-search-quiet">
              {num(v.replaced)} earlier record{v.replaced === 1 ? "" : "s"} of the same question, assistant and day {v.replaced === 1 ? "was" : "were"} replaced by a later one: kept, not counted.
            </p>
          ) : null}
          {never.length ? (
            <p className="dk-seo-ai-search-line dk-seo-ai-search-quiet">
              Never asked: {never.map((e) => e.label).join(", ")}. “Record a round” records one assistant&apos;s answers to every tracked question at once.
            </p>
          ) : null}
          <div className="dk-seo-ai-search-stampline">
            <Stamp reading={reading} />
          </div>
        </>
      ) : reading.state !== "ok" ? (
        <PanelAbsent reading={reading} />
      ) : null}
    </Card>
  );
}
