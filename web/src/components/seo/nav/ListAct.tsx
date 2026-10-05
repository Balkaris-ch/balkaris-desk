"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AuditAnswer, AuditRun, ImportAnswer, OwnerTaskAnswer, Priority, TaskDoer } from "@/contract/seo/common";
import { cx } from "@/lib/cx";
import { useLive } from "@/lib/live";
import { useSend } from "@/components/operator/send";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";

/**
 * The buttons of the section's own lists (every SEO task, the audits), each
 * through the desk server, which decides who may and answers in a sentence
 * shown beside the button; the list is then drawn again from the server.
 * Nothing here changes the live website: a task is a note of work, an audit
 * only reads the site and Google.
 */

const TASKS = "/api/v1/seo/owner-tasks";
const AUDIT = "/api/v1/seo/audit";

/** The desk's answer, or its refusal, under a button. */
function Said({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p className={cx("dk-seo-lists-said", !message.ok && "dk-seo-lists-said--bad")} role={message.ok ? "status" : "alert"}>
      {message.text}
    </p>
  );
}

/** Mark a task done, or open again. A person's mark, by name: the desk never sets it. */
export function TaskMark({ id, done }: { id: string; done: boolean }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-lists-act">
      <Button
        variant={done ? "ghost" : "good"}
        size="xs"
        icon={done ? "refresh" : "check"}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void go<OwnerTaskAnswer>(`${TASKS}/${encodeURIComponent(id)}`, { done: !done }, (v) => (v.task.done ? `Marked done by ${v.task.doneBy ?? "you"}.` : "Open again."))}
      >
        {busy ? "Asking…" : done ? "Open again" : "Mark done"}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** Write, change or clear a task's note (500 characters at most). The done mark is not touched. */
export function TaskNote({ id, note }: { id: string; note: string | null }) {
  const { go, busy, message } = useSend();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note ?? "");
  if (!open) {
    return (
      <span className="dk-seo-lists-act">
        <Button variant="ghost" size="xs" icon="edit" onClick={() => setOpen(true)}>
          {note ? "Edit note" : "Add a note"}
        </Button>
        <Said message={message} />
      </span>
    );
  }
  const save = async (value: string) => {
    const r = await go<OwnerTaskAnswer>(`${TASKS}/${encodeURIComponent(id)}`, { note: value }, (v) => (v.task.note ? "Note kept." : "Note cleared."));
    if (r.ok) setOpen(false);
  };
  return (
    <form
      className="dk-seo-lists-note"
      onSubmit={(e) => {
        e.preventDefault();
        void save(text);
      }}
    >
      <Field label="Note" hint={`${text.length} of 500 characters. Everyone who opens this list reads it.`}>
        <Textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
      <div className="dk-seo-lists-buttons">
        <Button type="submit" variant="primary" size="xs" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Saving…" : "Save note"}
        </Button>
        {note ? (
          <Button variant="ghost" size="xs" disabled={busy} onClick={() => void save("")}>
            Clear it
          </Button>
        ) : null}
        <Button variant="ghost" size="xs" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <Said message={message} />
    </form>
  );
}

const IMPACTS: { value: Priority; label: string }[] = [
  { value: "high", label: "High impact" },
  { value: "medium", label: "Medium impact" },
  { value: "low", label: "Low impact" },
];

const DOERS: { value: TaskDoer; label: string }[] = [
  { value: "owner", label: "The owner’s own step" },
  { value: "lead-chrome", label: "A step in the owner’s browser" },
  { value: "code", label: "A change to the website’s code" },
  { value: "content", label: "Content to write" },
];

/**
 * A task written by hand: the step in plain words, why, its impact and who
 * does it. The same words twice are one task (the desk answers the first).
 * The audit's import never removes a task written here.
 */
export function AddTask() {
  const { go, busy, message } = useSend();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="dk-seo-lists-add"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const why = String(f.get("why") ?? "").trim();
        void go<OwnerTaskAnswer & { added: boolean }>(
          TASKS,
          { step: String(f.get("step") ?? "").trim(), ...(why ? { why } : {}), impact: String(f.get("impact") ?? "medium"), who: String(f.get("who") ?? "owner") },
          (v) => (v.added ? `Added: ${v.task.title}` : `Already on the list: ${v.task.title}`),
        ).then((r) => {
          if (r.ok) form.current?.reset();
        });
      }}
    >
      <Field label="What to do" hint="The exact step, in plain words: where, and what. 8 to 1,000 characters.">
        <Textarea name="step" rows={3} minLength={8} maxLength={1000} required placeholder="In Search Console › Sitemaps, submit https://www.balkaris.ch/sitemap.xml again." />
      </Field>
      <Field label="Why (optional)" hint="What it changes, so whoever does it knows what it is for.">
        <Input name="why" maxLength={1000} />
      </Field>
      <div className="dk-seo-lists-add-row">
        <Field label="Impact">
          <Select name="impact" label="Impact" size="md" options={IMPACTS} defaultValue="medium" />
        </Field>
        <Field label="Who does it">
          <Select name="who" label="Who does it" size="md" options={DOERS} defaultValue="owner" />
        </Field>
        <Button type="submit" variant="primary" icon="plus" disabled={busy} aria-busy={busy || undefined} className="dk-seo-lists-add-go">
          {busy ? "Adding…" : "Add the task"}
        </Button>
      </div>
      <Said message={message} />
    </form>
  );
}

/**
 * The owner brings the SEO audit's files in again (POST /api/v1/seo/imports/audit:
 * keywords, clusters, these tasks, AI checks, captured results, profiles, read
 * from work/seo-audit on the desk's machine). The desk answers one line per
 * table, or that a file is not there; a task somebody marked or wrote by hand
 * is never overwritten by it.
 */
export function ImportAudit() {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-lists-act">
      <Button
        variant="ghost"
        size="sm"
        icon="refresh"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void go<ImportAnswer>("/api/v1/seo/imports/audit", {}, (v) => v.lines.join(" · ") || "Nothing to import.")}
      >
        {busy ? "Importing…" : "Import the audit’s files"}
      </Button>
      <Said message={message} />
    </span>
  );
}

/**
 * Start an audit from the list of audits: the full one, or the deep one that
 * also researches phrases in Google Autocomplete (from its weekly budget) and
 * reads competitors' pages. One already running is answered instead of a
 * second.
 */
export function AuditStart({ deep }: { deep: boolean }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-lists-act">
      <Button
        variant={deep ? "quiet" : "primary"}
        size="sm"
        icon="play"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() =>
          void go<AuditAnswer>(AUDIT, { deep }, (v) =>
            v.audit.state === "running" ? `Running: ${v.audit.steps.length} steps${v.audit.deep ? ", a deep audit" : ""}, one after the other.` : "The audit has nothing left to run.",
          )
        }
      >
        {busy ? "Asking…" : deep ? "Run a deep audit" : "Run full SEO audit"}
      </Button>
      <Said message={message} />
    </span>
  );
}

/**
 * The audit running now, step by step, followed every two seconds (GET
 * /api/v1/seo/audit); when it ends the list is drawn again from the server
 * with what it found.
 */
export function AuditLive({ initial }: { initial: AuditRun }) {
  const router = useRouter();
  const live = useLive<{ audit: AuditRun | null }>(AUDIT, 2_000, { audit: initial });
  const run = live.data?.audit && live.data.audit.id === initial.id ? live.data.audit : initial;
  const ended = run.state !== "running";
  const told = useRef(false);
  useEffect(() => {
    if (ended && !told.current) {
      told.current = true;
      router.refresh();
    }
  }, [ended, router]);
  const over = run.steps.filter((s) => s.state === "done" || s.state === "skipped" || s.state === "failed").length;
  return (
    <div className="dk-seo-lists-live" role="status" aria-live="polite">
      <p className="dk-seo-lists-live-line">
        {ended ? "Finished: drawing what it found…" : `Step ${Math.min(over + 1, run.steps.length)} of ${run.steps.length}`}
      </p>
      <ol className="dk-seo-lists-steps">
        {run.steps.map((s) => (
          <li key={s.job} className={cx("dk-seo-lists-step", `dk-seo-lists-step--${s.state}`)}>
            <span className="dk-seo-lists-step-title">{s.title}</span>
            <span className="dk-seo-lists-step-state">
              {s.state === "running" && s.progress && s.progress.of > 0 ? `${s.progress.done} of ${s.progress.of}${s.progress.what ? ` · ${s.progress.what}` : ""}` : STEP_SAYS[s.state]}
            </span>
            {s.note && s.state !== "running" ? <span className="dk-seo-lists-step-note">{s.note}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A step's state in words. */
export const STEP_SAYS: Record<AuditRun["steps"][number]["state"], string> = {
  queued: "Waiting its turn",
  running: "Running…",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};
