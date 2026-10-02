"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { OpportunityAnswer, OwnerTaskAnswer } from "@/contract/seo/common";
import type { BriefsAnswer } from "@/contract/seo/content-gaps";
import { useSend } from "@/components/operator/send";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import type { IconName } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

/**
 * The page's buttons that change something. Each posts to the desk server
 * (POST /api/v1/seo/content-gaps/…, src/cc/routes/seo/content-gaps.ts) from
 * the browser, which carries the person's own cookie and origin; the server
 * decides, the page is drawn again, and a refusal comes back word for word
 * beside the button.
 *
 * None of them changes the website. A brief is an operator task on the
 * studio workstation's model: a person writes and publishes the page.
 */

const BRIEF = "/api/v1/seo/content-gaps/brief";
const BRIEFS = "/api/v1/seo/content-gaps/briefs";
const STEP = "/api/v1/seo/content-gaps/step";

/** One line for what a brief request did. */
function summary(v: BriefsAnswer): string {
  if (v.results.length === 1) return v.results[0]!.line;
  const good = v.results.filter((r) => r.ok).length;
  const bad = v.results.filter((r) => !r.ok);
  return `${good} of ${v.results.length} briefs queued${bad.length ? `; not ${bad.length}: ${bad[0]!.line}` : "."}`;
}

function Said({ message, under }: { message: { ok: boolean; text: string } | null; under?: boolean }) {
  if (!message) return null;
  return (
    <span className={cx("dk-seo-gaps-said", under && "dk-seo-gaps-said--under", !message.ok && "dk-seo-gaps-said--bad")} role={message.ok ? "status" : "alert"}>
      {message.text}
    </span>
  );
}

/**
 * "Create brief": for a cluster, its missing phrases, most important first;
 * for `phrases` (a table row's own phrase), a brief that names those phrases,
 * filed under their cluster.
 */
export function BriefButton({
  cluster,
  phrases,
  label = "Create brief",
  title,
  variant = "good",
  size = "xs",
  icon = "file-text",
  under,
}: {
  cluster: string;
  phrases?: number[];
  label?: string;
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  under?: boolean;
}) {
  const { go, busy, message } = useSend();
  return (
    <span className={cx("dk-seo-gaps-act", under && "dk-seo-gaps-act--under")}>
      <Button size={size} variant={variant} icon={busy ? "refresh" : icon} disabled={busy} aria-busy={busy} title={title} onClick={() => void go<BriefsAnswer>(BRIEF, phrases?.length ? { phrases } : { cluster }, summary)}>
        {label}
      </Button>
      <Said message={message} under={under} />
    </span>
  );
}

/** "Generate all briefs": the open group's gap clusters whose brief can be asked now. */
export function BriefsButton({ clusters, most, title }: { clusters: string[]; most: number; title: string }) {
  const { go, busy, message } = useSend();
  const list = clusters.slice(0, most);
  return (
    <span className="dk-seo-gaps-act dk-seo-gaps-act--under dk-seo-gaps-act--end">
      <Button size="sm" variant="primary" icon={busy ? "refresh" : "sparkles"} disabled={busy || !list.length} aria-busy={busy} title={title} onClick={() => void go<BriefsAnswer>(BRIEFS, { clusters: list }, summary)}>
        {list.length > 1 ? `Generate ${list.length} briefs` : list.length ? "Generate the brief" : "Generate all briefs"}
      </Button>
      <Said message={message} under />
    </span>
  );
}

/** One of the audit's German or price steps: a brief, or a change handed to the website's code. */
export function StepButton({ id, label, title }: { id: string; label: string; title: string }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-gaps-act">
      <Button
        size="xs"
        variant="quiet"
        icon={busy ? "refresh" : undefined}
        disabled={busy}
        aria-busy={busy}
        title={title}
        onClick={() =>
          void go<OpportunityAnswer>(STEP, { id }, (v) => {
            const t = v.opportunity.state.task;
            return t ? `Queued as operator task #${t.id}.` : (v.opportunity.state.note ?? "Done.");
          })
        }
      >
        {label}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** "Needs you": the owner marks the task done (POST /api/v1/seo/owner-tasks/:id). */
export function OwnerDone({ task, done }: { task: string; done: boolean }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-gaps-act dk-seo-gaps-act--under">
      <Button
        size="xs"
        variant={done ? "quiet" : "good"}
        icon={busy ? "refresh" : done ? "refresh" : "check-circle"}
        disabled={busy}
        aria-busy={busy}
        onClick={() => void go<OwnerTaskAnswer>(`/api/v1/seo/owner-tasks/${encodeURIComponent(task)}`, { done: !done }, (v) => (v.task.done ? `Marked done by ${v.task.doneBy ?? "you"}.` : "Open again."))}
      >
        {done ? "Open again" : "I have done it"}
      </Button>
      <Said message={message} under />
    </span>
  );
}

/**
 * A table of phrases as a form: the table's checkboxes (named `phrases`, the
 * phrase's id) are its fields, and the button in its head asks one brief per
 * cluster for the ticked phrases.
 */
export function BriefForm({ children, head, className, most = 60 }: { children: ReactNode; head?: ReactNode; className?: string; most?: number }) {
  const form = useRef<HTMLFormElement>(null);
  const { go, busy, message, setMessage } = useSend();
  const [picked, setPicked] = useState(0);
  const count = () => setTimeout(() => setPicked(form.current?.querySelectorAll('input[name="phrases"]:checked').length ?? 0), 0);
  useEffect(() => {
    count();
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const phrases = new FormData(e.currentTarget).getAll("phrases").map(Number);
    if (!phrases.length) return setMessage({ ok: false, text: "Tick the phrases first." });
    if (phrases.length > most) return setMessage({ ok: false, text: `At most ${most} phrases at once; ${phrases.length} are ticked.` });
    void go<BriefsAnswer>(BRIEF, { phrases }, summary);
  };
  return (
    <form ref={form} className={cx("dk-seo-gaps-form", className)} onChange={count} onSubmit={submit}>
      <div className="dk-seo-gaps-formbar">
        {head}
        <span className="dk-seo-gaps-formbar-end">
          {message ? <Said message={message} /> : picked ? <span className="dk-seo-gaps-said">{picked} ticked</span> : null}
          <Button type="submit" size="xs" variant="quiet" icon={busy ? "refresh" : "file-text"} disabled={busy || !picked} aria-busy={busy} title="One brief per cluster, for the ticked phrases. The operator writes it on the studio workstation; a person writes and publishes the page.">
            Brief the ticked
          </Button>
        </span>
      </div>
      {children}
    </form>
  );
}
