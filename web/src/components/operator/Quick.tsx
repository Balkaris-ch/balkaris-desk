"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { Range } from "@/contract/common";
import type { NewTask, ProposalAnswer, TaskAnswer, TodoAnswer } from "@/contract/operator";
import { Button } from "@/components/ui/Button";
import { DialogActions } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { Sheet } from "./Sheet";
import { useSend } from "./send";

type Opened = "content" | "todo" | "redirect" | null;

interface CardSpec {
  key: string;
  icon: IconName;
  title: string;
  sub: string;
  /** Starts this task at once. */
  task?: NewTask;
  /** Opens this dialog. */
  open?: Exclude<Opened, null>;
  /** Goes here. */
  href?: string;
}

function Tile({ spec, onClick, busy }: { spec: CardSpec; onClick?: () => void; busy?: boolean }) {
  const inner = (
    <>
      <span className="dk-operator-do-icon" aria-hidden>
        <Icon name={spec.icon} size={20} />
      </span>
      <span className="dk-operator-do-text">
        <span className="dk-operator-do-title">{spec.title}</span>
        <span className="dk-operator-do-sub">{spec.sub}</span>
      </span>
      <Icon name="chevron-right" size={16} className="dk-operator-do-go" />
    </>
  );
  if (spec.href) {
    /* The address ends in the panel's anchor, and the link scrolls to it: on a phone the
       findings are far below, and a tap that changed them off-screen would look like nothing. */
    return (
      <Go href={spec.href} className="dk-operator-do">
        {inner}
      </Go>
    );
  }
  return (
    <button type="button" className={cx("dk-operator-do", busy && "dk-operator-do--busy")} onClick={onClick} aria-busy={busy || undefined}>
      {inner}
    </button>
  );
}

function Said({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p className={cx("dk-operator-said", !message.ok && "dk-operator-said--bad")} role={message.ok ? "status" : "alert"}>
      {message.text}
    </p>
  );
}

/**
 * "What would you like to do?" Eight cards, each doing its real job: four
 * start the matching task for the workstation at once, two open a small
 * form (a brief's topic, a redirect or a line on the to-do list), one goes to
 * the findings with their "Propose fixes", and one adds to the to-do list.
 */
export function Quick({ range, specimen, issuesHref, extra }: { range: Range; specimen: boolean; issuesHref: string; extra?: ReactNode }) {
  const [opened, setOpened] = useState<Opened>(null);
  const [which, setWhich] = useState<string | null>(null);
  const start = useSend();
  const form = useSend();

  const queued = (v: TaskAnswer) =>
    v.task.stage === "crawl"
      ? `Queued: ${v.task.title}. The crawl runs first; the workstation summarises it when it is on.`
      : `Queued: ${v.task.title}${v.task.ahead ? `, behind ${v.task.ahead} other${v.task.ahead === 1 ? "" : "s"}` : ""}. The workstation answers when it is on.`;

  const run = async (spec: CardSpec) => {
    if (!spec.task) return;
    if (specimen) {
      start.setMessage({ ok: false, text: "Specimen data is showing: nothing is queued from this view." });
      return;
    }
    setWhich(spec.key);
    await start.go<TaskAnswer>("/api/v1/operator/tasks", { ...spec.task, range }, queued);
    setWhich(null);
  };

  const cards: CardSpec[] = [
    { key: "traffic", icon: "bar-chart", title: "Analyze traffic", sub: "Get insights and trends from your data", task: { kind: "traffic" } },
    { key: "opportunities", icon: "lightbulb", title: "Find opportunities", sub: "Discover content and SEO opportunities", task: { kind: "opportunities" } },
    { key: "content", icon: "file-text", title: "Generate content", sub: "Create blog posts, pages or copy", open: "content" },
    { key: "issues", icon: "wrench", title: "Fix issues", sub: "Identify and fix technical problems", href: issuesHref },
    { key: "todo", icon: "check-circle", title: "Create task", sub: "Add to your task list", open: "todo" },
    /* The website's redirects are permanent (next.config.ts, permanent: true), which Next serves as 308, not 301. */
    { key: "redirect", icon: "link", title: "Create redirect", sub: "Set up permanent redirects", open: "redirect" },
    { key: "metadata", icon: "tag", title: "Generate metadata", sub: "Create SEO titles descriptions", task: { kind: "metadata" } },
    { key: "audit", icon: "search", title: "Run SEO audit", sub: "Analyze and get improvement ideas", task: { kind: "audit" } },
  ];

  const close = () => {
    setOpened(null);
    form.setMessage(null);
  };

  const submit = (path: string, body: (fd: FormData) => unknown, done: (v: never) => string) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (specimen) {
      form.setMessage({ ok: false, text: "Specimen data is showing: nothing is saved from this view." });
      return;
    }
    const r = await form.go(path, body(new FormData(e.currentTarget)), done as (v: unknown) => string);
    if (r.ok) {
      setOpened(null);
      start.setMessage({ ok: true, text: done(r.value as never) });
    }
  };

  return (
    <section className="dk-operator-quick" aria-labelledby="dk-operator-quick-title">
      <h2 id="dk-operator-quick-title" className="dk-operator-quick-title">
        What would you like to do?
      </h2>
      <div className="dk-operator-dos">
        {cards.map((c) => (
          <Tile key={c.key} spec={c} busy={which === c.key && start.busy} onClick={c.open ? () => setOpened(c.open!) : () => void run(c)} />
        ))}
      </div>
      <Said message={start.message} />
      {extra}

      <Sheet open={opened === "content"} onClose={close} title="Generate content" description="The workstation writes a brief for the studio's writers: who it is for, the question it answers, an outline, and links to pages that exist.">
        <form onSubmit={submit("/api/v1/operator/tasks", (fd) => ({ kind: "brief", prompt: String(fd.get("topic") ?? ""), range }), (v: TaskAnswer) => queued(v))}>
          <Field label="Topic or search query" hint="For example a service, a question a client asks, or a query from Search Console.">
            <Input name="topic" required minLength={3} maxLength={300} autoFocus placeholder="What should the brief be about?" />
          </Field>
          <p className="dk-operator-aside">
            To write an article from a link instead, use{" "}
            <Go href="/insights?create=1" className="dk-operator-link">
              Create insight on the Insights screen
            </Go>
            .
          </p>
          <Said message={form.message} />
          <DialogActions>
            <Button variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon="file-text" disabled={form.busy}>
              Write a brief
            </Button>
          </DialogActions>
        </form>
      </Sheet>

      <Sheet open={opened === "todo"} onClose={close} title="Create task" description="A line on the studio's own to-do list, shown under Current tasks. The model is never given it.">
        <form onSubmit={submit("/api/v1/operator/todos", (fd) => ({ title: String(fd.get("title") ?? ""), note: String(fd.get("note") ?? "") || null }), (v: TodoAnswer) => `Added to the to-do list: ${v.todo?.title ?? ""}.`)}>
          <Field label="Title">
            <Input name="title" required minLength={2} maxLength={160} autoFocus placeholder="What needs doing?" />
          </Field>
          <Field label="Note" hint="Optional.">
            <Textarea name="note" rows={3} maxLength={1000} />
          </Field>
          <Said message={form.message} />
          <DialogActions>
            <Button variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon="plus" disabled={form.busy}>
              Add task
            </Button>
          </DialogActions>
        </form>
      </Sheet>

      <Sheet
        open={opened === "redirect"}
        onClose={close}
        title="Create redirect"
        description="A permanent redirect between two addresses on balkaris.ch. It waits under Actions & approvals until a person who can publish approves it."
      >
        <form
          onSubmit={submit(
            "/api/v1/operator/proposals",
            (fd) => ({ from: String(fd.get("from") ?? ""), to: String(fd.get("to") ?? "") }),
            (v: ProposalAnswer) => `Proposed: ${v.proposal.address} → ${v.proposal.after.to}. It waits for approval.`,
          )}
        >
          <Field label="From" hint="An address that no longer answers. Never one in the sitemap: that would hide a live page.">
            <Input name="from" required pattern="/[A-Za-z0-9][A-Za-z0-9/_\-]*" maxLength={200} autoFocus placeholder="/old-address" />
          </Field>
          <Field label="To" hint="A page that answers today.">
            <Input name="to" required pattern="/([A-Za-z0-9][A-Za-z0-9/_\-]*)?" maxLength={200} placeholder="/new-address" />
          </Field>
          <Said message={form.message} />
          <DialogActions>
            <Button
              variant="quiet"
              icon="sparkles"
              disabled={form.busy}
              onClick={async () => {
                if (specimen) return form.setMessage({ ok: false, text: "Specimen data is showing: nothing is queued from this view." });
                const r = await form.go<TaskAnswer>("/api/v1/operator/tasks", { kind: "redirect", range }, queued);
                if (r.ok) {
                  setOpened(null);
                  start.setMessage({ ok: true, text: queued(r.value) });
                }
              }}
            >
              Propose for broken links
            </Button>
            <Button type="submit" variant="primary" icon="redirect" disabled={form.busy}>
              Propose redirect
            </Button>
          </DialogActions>
        </form>
      </Sheet>
    </section>
  );
}
