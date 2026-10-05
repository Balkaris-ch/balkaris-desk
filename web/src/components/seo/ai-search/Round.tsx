"use client";

import { useState, type FormEvent } from "react";
import type { AiCheckRow, AiDone, AiEngine, NewAiCheck, RoundAnswer } from "@/contract/seo/ai-search";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogActions, DialogClose } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { useSend } from "@/components/operator/send";
import { Said } from "@/components/seo/overview/Act";
import { cx } from "@/lib/cx";
import { API } from "./look";
import { KINDS, zurichToday, type Known } from "./RecordAnswers";
import "./ai-search.css";

const NAMED_LINE = [
  { value: "", label: "Not asked" },
  { value: "yes", label: "Named" },
  { value: "no", label: "Not named" },
  { value: "unread", label: "Could not be read" },
];

const list = (v: FormDataEntryValue | null): string[] =>
  String(v ?? "")
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);

/**
 * "Record a round": one assistant's answers to every tracked question in one
 * go, instead of one dialog per answer (POST /api/v1/seo/ai-search/round, the
 * owner's). Typed: pick the assistant and the day, then one line per question
 * (a line left "Not asked" is not recorded). Pasted: a sheet's CSV with a
 * header row, or JSON, as a person kept it while asking. Each answer is your
 * record and follows the same rule as one answer; a line that is not right is
 * skipped and said, the rest are recorded.
 */
export function RecordRound({ engines, questions, owner }: { engines: { engine: AiEngine; label: string }[]; questions: Known[]; owner: boolean }) {
  if (!owner) return null;
  return (
    <Dialog
      title="Record a round"
      description="One assistant's answers to the tracked questions, or a whole round pasted from a sheet. Each answer is recorded as yours, as one “Record answers” would."
      trigger={{ label: "Record a round", size: "sm", variant: "quiet", icon: "list" }}
    >
      <RoundForm engines={engines} questions={questions} />
    </Dialog>
  );
}

function RoundForm({ engines, questions }: { engines: { engine: AiEngine; label: string }[]; questions: Known[] }) {
  const [mode, setMode] = useState<"type" | "paste">(questions.length ? "type" : "paste");
  const send = useSend();

  const typed = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const engine = String(f.get("engine")) as AiEngine;
    const day = String(f.get("day") ?? zurichToday());
    const checks: NewAiCheck[] = [];
    questions.forEach((q, i) => {
      const named = String(f.get(`named-${i}`) ?? "");
      if (!named) return;
      const place = String(f.get(`place-${i}`) ?? "").trim();
      checks.push({
        engine,
        question: q.question,
        lang: q.lang,
        kind: q.kind,
        day,
        mentioned: named === "yes" ? true : named === "no" ? false : null,
        position: place ? Number(place) : null,
        competitors: list(f.get(`companies-${i}`)),
        sources: list(f.get(`sources-${i}`)),
        excerpt: null,
        by: "lead-chrome",
        note: null,
      });
    });
    if (!checks.length) {
      send.setMessage({ ok: false, text: "Mark at least one question as named, not named or could not be read." });
      return;
    }
    await send.go<RoundAnswer>(`${API}/round`, { checks }, (v) => v.line);
  };

  const pasted = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = String(f.get("text") ?? "");
    if (!text.trim()) {
      send.setMessage({ ok: false, text: "Paste the round first." });
      return;
    }
    const engine = String(f.get("engine") ?? "");
    await send.go<RoundAnswer>(`${API}/round`, { text, engine: engine || undefined, day: String(f.get("day") ?? "") || undefined }, (v) => v.line);
  };

  return (
    <div className="dk-seo-ai-search-form">
      <div className="dk-seo-ai-search-filters" role="group" aria-label="How to record the round">
        <button type="button" className={cx("dk-seo-ai-search-filter", mode === "type" && "dk-seo-ai-search-filter--on")} aria-pressed={mode === "type"} onClick={() => setMode("type")} disabled={!questions.length}>
          Type it
        </button>
        <button type="button" className={cx("dk-seo-ai-search-filter", mode === "paste" && "dk-seo-ai-search-filter--on")} aria-pressed={mode === "paste"} onClick={() => setMode("paste")}>
          Paste a sheet
        </button>
      </div>
      {mode === "type" ? (
        <form className="dk-seo-ai-search-form" onSubmit={(e) => void typed(e)}>
          <div className="dk-seo-ai-search-form-row">
            <Field label="Assistant">
              <Select name="engine" label="Assistant" size="md" options={engines.map((e) => ({ value: e.engine, label: e.label }))} defaultValue={engines[0]?.engine} />
            </Field>
            <Field label="Day asked">
              <Input type="date" name="day" defaultValue={zurichToday()} max={zurichToday()} required />
            </Field>
          </div>
          <ol className="dk-seo-ai-search-round-form">
            {questions.map((q, i) => (
              <li key={q.question} className="dk-seo-ai-search-round-line">
                <p className="dk-seo-ai-search-strong">{q.question}</p>
                <div className="dk-seo-ai-search-round-fields">
                  <Select name={`named-${i}`} label={`What the answer to “${q.question}” did`} size="md" options={NAMED_LINE} defaultValue="" />
                  <Input type="number" name={`place-${i}`} min={1} max={50} step={1} placeholder="Place" aria-label={`Balkaris's place in the answer to “${q.question}”`} />
                  <Input name={`companies-${i}`} placeholder="Companies named; separated by ;" aria-label={`Companies the answer to “${q.question}” named, separated by semicolons`} maxLength={2000} />
                  <Input name={`sources-${i}`} placeholder="Sources cited; separated by ;" aria-label={`Sources the answer to “${q.question}” cited, separated by semicolons`} maxLength={2000} />
                </div>
              </li>
            ))}
          </ol>
          <Said message={send.message} />
          <DialogActions>
            <DialogClose variant="ghost">Close</DialogClose>
            <Button type="submit" variant="primary" disabled={send.busy} aria-busy={send.busy || undefined}>
              {send.busy ? "Recording…" : "Record the round"}
            </Button>
          </DialogActions>
        </form>
      ) : (
        <form className="dk-seo-ai-search-form" onSubmit={(e) => void pasted(e)}>
          <Field
            label="The round, as CSV or JSON"
            hint="CSV: a first line naming the columns, one of them “question”; others: assistant, day, lang, kind, named (yes, no, unread), place, companies, sources (separated by ;), said, note. JSON: a list of answers."
          >
            <Textarea name="text" rows={8} maxLength={200_000} placeholder={"assistant,question,named,place,companies\nChatGPT,Best web design agency in Zurich?,no,,Studio A;Studio B"} />
          </Field>
          <div className="dk-seo-ai-search-form-row">
            <Field label="Assistant, where a line does not say">
              <Select name="engine" label="Assistant, where a line does not say" size="md" options={[{ value: "", label: "Each line says" }, ...engines.map((e) => ({ value: e.engine, label: e.label }))]} defaultValue="" />
            </Field>
            <Field label="Day, where a line does not say">
              <Input type="date" name="day" defaultValue={zurichToday()} max={zurichToday()} />
            </Field>
          </div>
          <Said message={send.message} />
          <DialogActions>
            <DialogClose variant="ghost">Close</DialogClose>
            <Button type="submit" variant="primary" disabled={send.busy} aria-busy={send.busy || undefined}>
              {send.busy ? "Recording…" : "Record what is pasted"}
            </Button>
          </DialogActions>
        </form>
      )}
    </div>
  );
}

/**
 * "Track a question": put a question on the list asked of every assistant
 * each round (POST /api/v1/seo/ai-search/questions, the owner's). It shows as
 * a row of empty cells until answers are recorded for it.
 */
export function TrackQuestion({ owner }: { owner: boolean }) {
  if (!owner) return null;
  return (
    <Dialog title="Track a question" description="A question asked of every assistant each round. It shows as a row of empty cells until its answers are recorded." trigger={{ label: "Track a question", size: "sm", variant: "quiet", icon: "plus" }} size="sm">
      <TrackForm />
    </Dialog>
  );
}

function TrackForm() {
  const send = useSend();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const question = String(f.get("question") ?? "").trim();
    if (question.length < 3) {
      send.setMessage({ ok: false, text: "Write the question as a client would ask it." });
      return;
    }
    await send.go<AiDone>(`${API}/questions`, { question, lang: String(f.get("lang")), kind: String(f.get("kind")) as AiCheckRow["kind"], active: true }, (v) => v.line);
  };
  return (
    <form className="dk-seo-ai-search-form" onSubmit={(e) => void submit(e)}>
      <Field label="Question" hint="As a client would ask an assistant: “Was kostet ein Imagefilm in Zürich?”">
        <Input name="question" maxLength={300} required autoComplete="off" />
      </Field>
      <div className="dk-seo-ai-search-form-row">
        <Field label="Language">
          <Select
            name="lang"
            label="Language"
            size="md"
            options={[
              { value: "de", label: "German" },
              { value: "en", label: "English" },
            ]}
            defaultValue="de"
          />
        </Field>
        <Field label="Kind of question">
          <Select name="kind" label="Kind of question" size="md" options={KINDS} defaultValue="category" />
        </Field>
      </div>
      <Said message={send.message} />
      <DialogActions>
        <DialogClose variant="ghost">Close</DialogClose>
        <Button type="submit" variant="primary" disabled={send.busy} aria-busy={send.busy || undefined}>
          {send.busy ? "Adding…" : "Track it"}
        </Button>
      </DialogActions>
    </form>
  );
}
