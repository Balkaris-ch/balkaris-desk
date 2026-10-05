"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type { AiCheckRow, AiDone, AiEngine, NewAiCheck, RecordAnswer } from "@/contract/seo/ai-search";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { Dialog, DialogActions, DialogClose } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import type { IconName } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { useSend } from "@/components/operator/send";
import { Said } from "@/components/seo/overview/Act";
import { API } from "./look";
import "./ai-search.css";

export const KINDS: { value: AiCheckRow["kind"]; label: string }[] = [
  { value: "category", label: "A service and a place (does not name Balkaris)" },
  { value: "price", label: "A price question (does not name Balkaris)" },
  { value: "advice", label: "Advice, a how-to (does not name Balkaris)" },
  { value: "brand", label: "Names Balkaris" },
  { value: "domain", label: "Names balkaris.ch" },
];

const NAMED = [
  { value: "yes", label: "Yes, the answer named Balkaris" },
  { value: "no", label: "No" },
  { value: "unread", label: "Could not be read whole" },
];

const RECORDER: Record<string, string> = { audit: "the SEO audit", api: "the API", "lead-chrome": "a person in a browser" };

/** Today in Zurich, as the desk counts days. */
export const zurichToday = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

const lines = (v: FormDataEntryValue | null): string[] =>
  String(v ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);

export type Known = { question: string; lang: "de" | "en"; kind: AiCheckRow["kind"] };

/** What recording did, in the server's own result. */
function said(a: RecordAnswer): string {
  const instead = a.replaces ? ` It takes the place of ${RECORDER[a.replaces.by] ?? a.replaces.by}'s record of this question, assistant and day in every count; that record is kept.` : "";
  const still = a.counted ? "" : " A later record of this question, assistant and day by another recorder still counts in its place.";
  if (a.result === "added") return `Recorded. The page now counts it.${instead}${still}`;
  if (a.result === "changed") return `Changed: your earlier record of this question, assistant and day now says this.${instead}${still}`;
  return `Unchanged: this answer was already recorded exactly so.${still}`;
}

type Trigger = { label: string; size?: ButtonSize; variant?: ButtonVariant; icon?: IconName };

/**
 * "Record answers": one answer an assistant gave, as a person read it in a
 * browser (POST /api/v1/seo/ai-search/record, the owner's). Recording the
 * same question, assistant and day again changes your record; a record of
 * yours takes the place of the audit's for that day in every count, and the
 * audit's is kept. Only what the person saw is asked for; picking a question
 * asked before fills in its language and kind, nothing else is filled in.
 * `preset` opens it on one question and assistant (an empty cell's "Record").
 */
export function RecordAnswers({
  engines,
  questions,
  owner,
  preset,
  trigger = { label: "Record answers", size: "sm", variant: "quiet", icon: "plus" },
}: {
  engines: { engine: AiEngine; label: string }[];
  questions: Known[];
  owner: boolean;
  preset?: { engine?: AiEngine; question?: Known };
  trigger?: Trigger;
}) {
  if (!owner) return <span className="dk-seo-ai-search-quiet dk-seo-ai-search-headnote">Answers are recorded by the owner</span>;
  return (
    <Dialog
      title="Record an answer"
      description="What one assistant answered to one question, as you read it in a browser. Recording the same question, assistant and day again corrects your record; yours counts in place of the audit's for that day, which is kept."
      trigger={trigger}
    >
      <AnswerForm engines={engines} questions={questions} preset={preset} />
    </Dialog>
  );
}

/**
 * Correct one record kept (POST /api/v1/seo/ai-search/record/:id): a wrong
 * assistant, day, question, or what it said. A record of the audit's that is
 * corrected becomes a person's, and importing the audit again does not undo it.
 */
export function EditAnswer({ row, engines, questions }: { row: AiCheckRow; engines: { engine: AiEngine; label: string }[]; questions: Known[] }) {
  return (
    <Dialog
      title="Correct a recorded answer"
      description={`${row.engineLabel}, ${row.day}, recorded by ${RECORDER[row.by] ?? row.by}. Change what is wrong; a record of the audit's becomes yours when corrected.`}
      trigger={{ label: "Correct", size: "xs", variant: "ghost", icon: "edit" }}
    >
      <AnswerForm engines={engines} questions={questions} edit={row} />
    </Dialog>
  );
}

function AnswerForm({ engines, questions, preset, edit }: { engines: { engine: AiEngine; label: string }[]; questions: Known[]; preset?: { engine?: AiEngine; question?: Known }; edit?: AiCheckRow }) {
  const send = useSend();
  const list = useId();
  const form = useRef<HTMLFormElement>(null);
  const start: Known | null = edit ? { question: edit.question, lang: edit.lang, kind: edit.kind } : (preset?.question ?? null);
  const [from, setFrom] = useState<Known | null>(start);
  const known = new Map(questions.map((q) => [q.question.trim().replace(/\s+/g, " ").toLowerCase(), q]));

  /* A question asked before brings its language and kind, so the answer is compared with the same question's earlier ones. */
  const picked = (text: string) => {
    const q = known.get(text.trim().replace(/\s+/g, " ").toLowerCase()) ?? null;
    setFrom(q);
    const f = form.current;
    if (!q || !f) return;
    const lang = f.elements.namedItem("lang");
    const kind = f.elements.namedItem("kind");
    if (lang instanceof HTMLSelectElement) lang.value = q.lang;
    if (kind instanceof HTMLSelectElement) kind.value = q.kind;
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const question = String(f.get("question") ?? "").trim();
    if (question.length < 3) {
      send.setMessage({ ok: false, text: "Write the question as it was asked." });
      return;
    }
    const named = String(f.get("named"));
    const position = String(f.get("position") ?? "").trim();
    const check: NewAiCheck = {
      engine: String(f.get("engine")) as AiEngine,
      question,
      lang: String(f.get("lang")) === "de" ? "de" : "en",
      day: String(f.get("day") ?? zurichToday()),
      kind: String(f.get("kind")) as AiCheckRow["kind"],
      mentioned: named === "yes" ? true : named === "no" ? false : null,
      position: position ? Number(position) : null,
      competitors: lines(f.get("competitors")),
      sources: lines(f.get("sources")),
      excerpt: String(f.get("excerpt") ?? "").trim() || null,
      by: "lead-chrome",
      note: String(f.get("note") ?? "").trim() || null,
    };
    if (edit) await send.go<AiDone>(`${API}/record/${edit.id}`, { check }, (v) => v.line);
    else await send.go<RecordAnswer>(`${API}/record`, { check }, said);
  };

  return (
    <form ref={form} className="dk-seo-ai-search-form" onSubmit={(e) => void submit(e)}>
      <div className="dk-seo-ai-search-form-row">
        <Field label="Assistant">
          <Select name="engine" label="Assistant" size="md" options={engines.map((e) => ({ value: e.engine, label: e.label }))} defaultValue={edit?.engine ?? preset?.engine ?? engines[0]?.engine} />
        </Field>
        <Field label="Day asked">
          <Input type="date" name="day" defaultValue={edit?.day ?? zurichToday()} max={zurichToday()} required />
        </Field>
      </div>
      <Field
        label="Question, as asked"
        hint={from ? "Asked before: its language and kind are filled in from the earlier record." : questions.length ? "Pick one asked before to compare rounds, or write a new one." : undefined}
      >
        <Input name="question" list={list} maxLength={300} required autoComplete="off" defaultValue={start?.question} onChange={(e) => picked(e.currentTarget.value)} />
      </Field>
      <datalist id={list}>
        {questions.map((q) => (
          <option key={q.question} value={q.question} />
        ))}
      </datalist>
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
            defaultValue={start?.lang ?? "de"}
          />
        </Field>
        <Field label="Kind of question">
          <Select name="kind" label="Kind of question" size="md" options={KINDS} defaultValue={start?.kind ?? "category"} />
        </Field>
      </div>
      <div className="dk-seo-ai-search-form-row">
        <Field label="Did the answer name Balkaris?">
          <Select name="named" label="Did the answer name Balkaris?" size="md" options={NAMED} defaultValue={edit ? (edit.mentioned === null ? "unread" : edit.mentioned ? "yes" : "no") : "no"} />
        </Field>
        <Field label="Its place in the answer's list" hint="1 for first; empty when not named or not a list.">
          <Input type="number" name="position" min={1} max={50} step={1} defaultValue={edit?.position ?? undefined} />
        </Field>
      </div>
      <Field label="Companies the answer named, in its order" hint="One per line.">
        <Textarea name="competitors" rows={3} defaultValue={edit?.competitors.join("\n")} />
      </Field>
      <Field label="Sources it cited" hint="One per line: a host (example.ch) or the name on the source card.">
        <Textarea name="sources" rows={3} defaultValue={edit?.sources.join("\n")} />
      </Field>
      <Field label="What it said, in your words" hint="Optional, up to 600 characters.">
        <Textarea name="excerpt" rows={2} maxLength={600} defaultValue={edit?.excerpt ?? undefined} />
      </Field>
      <Field label="Note" hint="Optional: signed in or not, the country the browser was in.">
        <Input name="note" maxLength={300} defaultValue={edit?.note ?? undefined} />
      </Field>
      <Said message={send.message} />
      <DialogActions>
        <DialogClose variant="ghost">Close</DialogClose>
        <Button type="submit" variant="primary" disabled={send.busy} aria-busy={send.busy || undefined}>
          {send.busy ? (edit ? "Correcting…" : "Recording…") : edit ? "Correct" : "Record"}
        </Button>
      </DialogActions>
    </form>
  );
}
