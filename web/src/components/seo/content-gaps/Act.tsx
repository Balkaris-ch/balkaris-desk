"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { OpportunityAnswer, OwnerTaskAnswer } from "@/contract/seo/common";
import type { BriefsAnswer, GapChanged } from "@/contract/seo/content-gaps";
import { useSend } from "@/components/operator/send";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import type { IconName } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { PAGES_LIST } from "./look";

/**
 * The page's buttons that change something. Each posts to the desk server
 * (POST /api/v1/seo/content-gaps/…, src/cc/routes/seo/content-gaps.ts) from
 * the browser, which carries the person's own cookie and origin; the server
 * decides, the page is drawn again, and a refusal comes back word for word
 * beside the button.
 *
 * None of them changes the website. A brief is an operator task on the
 * studio workstation's model: a person writes and publishes the page. A
 * judgement and a mapping are the desk's own records of what a person said.
 */

const BRIEF = "/api/v1/seo/content-gaps/brief";
const BRIEFS = "/api/v1/seo/content-gaps/briefs";
const STEP = "/api/v1/seo/content-gaps/step";
const JUDGE = "/api/v1/seo/content-gaps/judge";
const MAP = "/api/v1/seo/content-gaps/map";

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
 * for `phrases` (a table row's own phrase), the same cluster's brief with
 * those phrases named first.
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

/** "Generate all briefs": the open group's gap clusters whose brief can be asked now and is not written yet. */
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

/** A person's judgement of one phrase, from its row: "Relevant" takes a search Google reports into the gaps, "Not relevant" throws it out. */
export function JudgeButton({ id, status, label, title, variant = "quiet" }: { id: number; status: "relevant" | "weak" | "irrelevant"; label: string; title: string; variant?: ButtonVariant }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-gaps-act">
      <Button size="xs" variant={variant} icon={busy ? "refresh" : undefined} disabled={busy} aria-busy={busy} title={title} onClick={() => void go<GapChanged>(JUDGE, { ids: [id], status }, (v) => v.line)}>
        {label}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** The field a person names one of the site's pages in: its addresses are offered as they type. */
function PageField({ value, onChange, onEnter, disabled }: { value: string; onChange: (v: string) => void; onEnter: () => void; disabled?: boolean }) {
  /* Enter in a field inside the phrase form would submit the form, which asks for briefs: it saves the page instead. */
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    onEnter();
  };
  return (
    <Input
      className="dk-seo-gaps-pagefield"
      list={PAGES_LIST}
      value={value}
      placeholder="/address-of-the-page"
      aria-label="The page's address on the site, starting with /"
      maxLength={300}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={key}
    />
  );
}

/**
 * The cluster's page, said by a person: "A page answers this now" once the
 * page a brief led to is published and crawled, which is how a gap is closed;
 * or "No page answers it" to take a wrong mapping away. The server refuses an
 * address the crawl does not read answering 200.
 */
export function MapCluster({ cluster, page }: { cluster: string; page: string | null }) {
  const { go, busy, message } = useSend();
  const [path, setPath] = useState("");
  const save = () => {
    if (path.trim()) void go<GapChanged>(MAP, { cluster, path: path.trim() }, (v) => v.line).then((r) => (r.ok ? setPath("") : undefined));
  };
  return (
    <div className="dk-seo-gaps-map">
      <span className="dk-seo-gaps-map-label">{page ? "Another page answers it" : "A page answers it now"}</span>
      <span className="dk-seo-gaps-map-row">
        <PageField value={path} onChange={setPath} onEnter={save} disabled={busy} />
        <Button size="xs" variant="good" icon={busy ? "refresh" : "check"} disabled={busy || !path.trim()} aria-busy={busy} title="Your word, kept by every run and import. The cluster counts as answered when the page is in its language." onClick={save}>
          Save
        </Button>
        {page ? (
          <Button size="xs" variant="quiet" disabled={busy} title={`Take ${page} away: the cluster counts as a gap again.`} onClick={() => void go<GapChanged>(MAP, { cluster, path: null }, (v) => v.line)}>
            No page answers it
          </Button>
        ) : null}
      </span>
      <Said message={message} />
    </div>
  );
}

/**
 * A table of phrases as a form: the table's checkboxes (named `phrases`, the
 * phrase's id) are its fields, and the buttons in its head act on the ticked
 * rows: one brief per cluster, a judgement (a phrase that is not a real gap
 * leaves the list), or the page that answers them.
 */
export function BriefForm({ children, head, className, most = 200 }: { children: ReactNode; head?: ReactNode; className?: string; most?: number }) {
  const form = useRef<HTMLFormElement>(null);
  const { go, busy, message, setMessage } = useSend();
  const [picked, setPicked] = useState(0);
  const [mapping, setMapping] = useState(false);
  const [path, setPath] = useState("");
  const count = () => setTimeout(() => setPicked(form.current?.querySelectorAll('input[name="phrases"]:checked').length ?? 0), 0);
  useEffect(() => {
    count();
  });
  /** The ticked phrases, or null with the reason said. */
  const ticked = (): number[] | null => {
    const phrases = form.current ? new FormData(form.current).getAll("phrases").map(Number) : [];
    if (!phrases.length) {
      setMessage({ ok: false, text: "Tick the phrases first." });
      return null;
    }
    if (phrases.length > most) {
      setMessage({ ok: false, text: `At most ${most} phrases at once; ${phrases.length} are ticked.` });
      return null;
    }
    return phrases;
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const phrases = ticked();
    if (phrases) void go<BriefsAnswer>(BRIEF, { phrases }, summary);
  };
  const judge = (status: "weak" | "irrelevant") => {
    const ids = ticked();
    if (ids) void go<GapChanged>(JUDGE, { ids, status }, (v) => v.line);
  };
  const map = (to: string | null) => {
    const phrases = ticked();
    if (!phrases) return;
    void go<GapChanged>(MAP, { phrases, path: to }, (v) => v.line).then((r) => {
      if (!r.ok) return;
      setMapping(false);
      setPath("");
    });
  };
  const none = busy || !picked;
  return (
    <form ref={form} className={cx("dk-seo-gaps-form", className)} onChange={count} onSubmit={submit}>
      <div className="dk-seo-gaps-formbar">
        {head}
        <span className="dk-seo-gaps-formbar-end">
          {message ? <Said message={message} /> : picked ? <span className="dk-seo-gaps-said">{picked} ticked</span> : null}
          <Button type="submit" size="xs" variant="quiet" icon={busy ? "refresh" : "file-text"} disabled={none} aria-busy={busy} title="One brief per cluster, the ticked phrases named first. The operator writes it on the studio workstation; a person writes and publishes the page.">
            Brief the ticked
          </Button>
          <Button size="xs" variant="quiet" disabled={none} title="Your judgement: the ticked phrases are not searches the studio wants to answer. They leave this list; Keywords still holds them, and no run changes your word." onClick={() => judge("irrelevant")}>
            Not relevant
          </Button>
          <Button size="xs" variant="quiet" disabled={none} title="Your judgement: the ticked phrases are only loosely the studio's. They leave this list; Keywords still holds them." onClick={() => judge("weak")}>
            Weak
          </Button>
          <Button size="xs" variant="quiet" icon="link" disabled={none} aria-expanded={mapping} title="Say which page of the site answers the ticked phrases. Your word, kept by every run and import." onClick={() => setMapping((m) => !m)}>
            A page answers them
          </Button>
        </span>
        {mapping ? (
          <span className="dk-seo-gaps-formbar-map">
            <span className="dk-seo-gaps-map-label">The page that answers the ticked phrases</span>
            <PageField value={path} onChange={setPath} onEnter={() => (path.trim() ? map(path.trim()) : undefined)} disabled={busy} />
            <Button size="xs" variant="good" icon="check" disabled={none || !path.trim()} onClick={() => map(path.trim())}>
              Save
            </Button>
            <Button size="xs" variant="quiet" disabled={none} title="Your word that no page answers them: a mapping made by the audit or the desk's rule is taken away." onClick={() => map(null)}>
              No page answers them
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setMapping(false)}>
              Close
            </Button>
          </span>
        ) : null}
      </div>
      {children}
    </form>
  );
}
