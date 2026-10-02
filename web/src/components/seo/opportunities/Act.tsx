"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { OpportunitiesActed, OpportunityAnswer, OpportunityState } from "@/contract/seo/common";
import type { OwnerStepAnswer } from "@/contract/seo/opportunities";
import { useSend } from "@/components/operator/send";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { DONE_IT } from "./look";

/**
 * The page's buttons that change something. Each posts to the desk server
 * (POST /api/v1/seo/opportunities/…, contract/seo/opportunities.ts) from the
 * browser, which carries the person's own cookie and origin, and the server
 * decides as it always does. Then the page is drawn again from the server. A
 * refusal comes back word for word beside the button.
 *
 * None of them changes the website. An action queues an operator task on the
 * studio workstation (a proposal then waits in AI Operator › Approvals for a
 * person), puts a change to the website's code on the to-do list in AI
 * Operator, or records a step the person pressing it took; a state is a
 * person's decision.
 */

const ACT = "/api/v1/seo/opportunities/act";
const STATE = "/api/v1/seo/opportunities/state";
const OWNER_STEP = "/api/v1/seo/opportunities/owner-task";

/** The opportunity's action, or one of its alternatives (`as`). */
export function ActButton({
  id,
  as,
  label,
  title,
  variant = "good",
  size = "xs",
  icon,
  block,
  said = "inline",
}: {
  id: string;
  as?: "metadata" | "brief";
  label: string;
  /** What pressing it does, for the pointer and a screen reader. */
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  block?: boolean;
  /** Where the server's sentence goes: beside the button, or under it. */
  said?: "inline" | "under";
}) {
  const { go, busy, message } = useSend();
  return (
    <span className={cx("dk-seo-opps-act", said === "under" && "dk-seo-opps-act--under", block && "dk-seo-opps-act--block")}>
      <Button
        size={size}
        variant={variant}
        icon={busy ? "refresh" : icon}
        block={block}
        disabled={busy}
        aria-busy={busy}
        title={title}
        onClick={() =>
          void go<OpportunityAnswer>(ACT, as ? { id, as } : { id }, (v) => {
            const t = v.opportunity.state.task;
            return t ? `Queued as operator task #${t.id}.` : (v.opportunity.state.note ?? "Done.");
          })
        }
      >
        {label}
      </Button>
      {message ? (
        <span className={cx("dk-seo-opps-said", !message.ok && "dk-seo-opps-said--bad")} role={message.ok ? "status" : "alert"}>
          {message.text}
        </span>
      ) : null}
    </span>
  );
}

/** A person's decision on one opportunity: done, dismissed, open again. */
export function StateButton({ id, state, label, icon, variant = "quiet", size = "sm" }: { id: string; state: OpportunityState; label: string; icon?: IconName; variant?: ButtonVariant; size?: ButtonSize }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-opps-act dk-seo-opps-act--under">
      <Button size={size} variant={variant} icon={icon} disabled={busy} aria-busy={busy} onClick={() => void go<OpportunityAnswer>(STATE, { id, state })}>
        {label}
      </Button>
      {message && !message.ok ? (
        <span className="dk-seo-opps-said dk-seo-opps-said--bad" role="alert">
          {message.text}
        </span>
      ) : null}
    </span>
  );
}

/**
 * "I have done it": a step from the audit (in the owner's browser, or the
 * owner's own login) marked done by the person who took it, with every
 * opportunity waiting on it (POST /api/v1/seo/opportunities/owner-task). The
 * server refuses the owner's own steps to anybody else; the page shows the
 * button for them to the owner only.
 */
export function OwnerDone({
  task,
  size = "sm",
  variant = "good",
  block,
  said = "under",
}: {
  task: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  block?: boolean;
  said?: "inline" | "under";
}) {
  const { go, busy, message } = useSend();
  return (
    <span className={cx("dk-seo-opps-act", said === "under" && "dk-seo-opps-act--under", block && "dk-seo-opps-act--block")}>
      <Button
        size={size}
        variant={variant}
        icon={busy ? "refresh" : "check-circle"}
        block={block}
        disabled={busy}
        aria-busy={busy}
        title="Records that the step is done: its task is marked done, and the opportunities waiting on it with it."
        onClick={() =>
          void go<OwnerStepAnswer>(OWNER_STEP, { task }, (v) => `Marked done${v.opportunities.length ? `, with ${v.opportunities.length} opportunit${v.opportunities.length === 1 ? "y" : "ies"} waiting on it` : ""}.`)
        }
      >
        {DONE_IT}
      </Button>
      {message ? (
        <span className={cx("dk-seo-opps-said", !message.ok && "dk-seo-opps-said--bad")} role={message.ok ? "status" : "alert"}>
          {message.text}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The row's "⋯": the person's decisions on it, "Request indexing" marked for
 * an address waiting for it, and "I have done it" for a step from the audit
 * (`ownerTask`). A native disclosure, so it opens with the keyboard and closes
 * when a choice is made.
 */
export function RowMenu({ id, state, byHand, ownerTask, title }: { id: string; state: OpportunityState; byHand: string | null; ownerTask: string | null; title: string }) {
  const { go, busy, message } = useSend();
  const box = useRef<HTMLDetailsElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /* Where the menu floats: under the button, or over it when the window ends first. Fixed, so the table's scroller cannot cut it. */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const closed = state === "done" || state === "dismissed";
  const pick = (path: string, body: unknown) => {
    box.current?.removeAttribute("open");
    void go(path, body);
  };
  const place = () => {
    const b = box.current?.querySelector("summary")?.getBoundingClientRect();
    const m = list.current?.getBoundingClientRect();
    if (!b || !m) return;
    const gap = 4;
    const below = b.bottom + gap + m.height <= window.innerHeight - 8;
    setAt({ left: Math.max(8, b.right - m.width), top: below ? b.bottom + gap : Math.max(8, b.top - gap - m.height) });
  };
  /* Closes when the pointer goes elsewhere or the page moves under it, as a menu does. */
  useEffect(() => {
    const shut = (e: Event) => {
      if (!box.current?.open) return;
      if (e.type === "pointerdown" && box.current.contains(e.target as Node)) return;
      box.current.removeAttribute("open");
    };
    document.addEventListener("pointerdown", shut);
    window.addEventListener("scroll", shut, true);
    window.addEventListener("resize", shut);
    return () => {
      document.removeEventListener("pointerdown", shut);
      window.removeEventListener("scroll", shut, true);
      window.removeEventListener("resize", shut);
    };
  }, []);
  return (
    <details ref={box} className="dk-seo-opps-menu" onToggle={(e) => (e.currentTarget.open ? place() : setAt(null))}>
      <summary className="dk-seo-opps-menu-button" aria-label={`More for: ${title}`} title={message && !message.ok ? message.text : undefined}>
        <Icon name={busy ? "refresh" : message && !message.ok ? "alert" : "more"} size={16} />
      </summary>
      <div
        ref={list}
        className="dk-seo-opps-menu-list dk-seo-opps-menu-list--fixed"
        role="menu"
        style={at ? { left: at.left, top: at.top } : { visibility: "hidden" }}
      >
        {byHand && !closed ? (
          <button type="button" role="menuitem" onClick={() => pick(ACT, { id })}>
            <Icon name="check" size={14} />
            {byHand}
          </button>
        ) : null}
        {ownerTask && !closed ? (
          <button type="button" role="menuitem" onClick={() => pick(OWNER_STEP, { task: ownerTask })}>
            <Icon name="check" size={14} />
            {DONE_IT}
          </button>
        ) : null}
        {closed ? (
          <button type="button" role="menuitem" onClick={() => pick(STATE, { id, state: "open" })}>
            <Icon name="refresh" size={14} />
            Open again
          </button>
        ) : (
          <>
            <button type="button" role="menuitem" onClick={() => pick(STATE, { id, state: "done" })}>
              <Icon name="check-circle" size={14} />
              Mark done
            </button>
            <button type="button" role="menuitem" onClick={() => pick(STATE, { id, state: "dismissed" })}>
              <Icon name="x-circle" size={14} />
              Dismiss
            </button>
          </>
        )}
      </div>
    </details>
  );
}

/* ---------- the list's bulk actions ------------------------------------------------------------ */

interface Bulk {
  picked: number;
  busy: boolean;
  said: { ok: boolean; text: string } | null;
}

const BulkContext = createContext<Bulk>({ picked: 0, busy: false, said: null });

/** At most this many actions are queued at once (the server's own limit). */
const ACT_MOST = 10;

/**
 * The list as a form: the table's checkboxes (named `ids`) are its fields and
 * the bulk menu's buttons submit it, each with what it does. One request for
 * all the ticked rows; the server answers one line per opportunity.
 */
export function BulkForm({ children, className }: { children: ReactNode; className?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const { go, busy, message, setMessage } = useSend();
  const [picked, setPicked] = useState(0);

  /* After the table has drawn the change: "select every row" ticks the boxes on its next render. */
  const count = useCallback(() => {
    setTimeout(() => setPicked(form.current?.querySelectorAll('input[name="ids"]:checked').length ?? 0), 0);
  }, []);
  useEffect(() => {
    count();
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const op = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? "";
    const ids = new FormData(e.currentTarget).getAll("ids").map(String);
    if (!ids.length) return setMessage({ ok: false, text: "Tick the opportunities first." });
    if (op === "act" && ids.length > ACT_MOST) return setMessage({ ok: false, text: `At most ${ACT_MOST} actions are queued at once; ${ids.length} are ticked.` });
    const summary = (v: OpportunitiesActed): string => {
      const good = v.results.filter((r) => r.ok).length;
      const bad = v.results.filter((r) => !r.ok);
      return `${good} of ${v.results.length} ${op === "act" ? "queued" : "marked"}${bad.length ? `; not ${bad.length}: ${bad[0]!.line}` : "."}`;
    };
    if (op === "act") void go<OpportunitiesActed>(ACT, { ids }, summary);
    else if (op === "done" || op === "dismissed") void go<OpportunitiesActed>(STATE, { ids, state: op }, summary);
  };

  return (
    <BulkContext.Provider value={{ picked, busy, said: message }}>
      <form ref={form} className={className} onChange={count} onSubmit={submit}>
        {children}
      </form>
    </BulkContext.Provider>
  );
}

/** "Bulk actions" in the list's head: what happens to the ticked rows. */
export function BulkMenu() {
  const { picked, busy, said } = useContext(BulkContext);
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (busy) box.current?.removeAttribute("open");
  }, [busy]);
  /* Closes when the pointer goes elsewhere, as a menu does. */
  useEffect(() => {
    const shut = (e: PointerEvent) => {
      if (box.current?.open && !box.current.contains(e.target as Node)) box.current.removeAttribute("open");
    };
    document.addEventListener("pointerdown", shut);
    return () => document.removeEventListener("pointerdown", shut);
  }, []);
  return (
    <div className="dk-seo-opps-bulk">
      {said ? (
        <span className={cx("dk-seo-opps-said", !said.ok && "dk-seo-opps-said--bad")} role={said.ok ? "status" : "alert"}>
          {said.text}
        </span>
      ) : picked ? (
        <span className="dk-seo-opps-said">{picked} ticked</span>
      ) : null}
      <details ref={box} className="dk-seo-opps-menu dk-seo-opps-menu--wide">
        <summary className="dk-btn dk-btn--quiet dk-btn--sm" aria-busy={busy}>
          <Icon name={busy ? "refresh" : "list"} size={14} />
          <span className="dk-btn-label">Bulk actions</span>
          <Icon name="chevron-down" size={14} />
        </summary>
        <div className="dk-seo-opps-menu-list" role="menu">
          <button
            type="submit"
            name="op"
            value="act"
            role="menuitem"
            disabled={!picked || busy}
            title="Queues the operator task of each ticked opportunity whose action is a proposal or a brief; proposals still wait for approval. A person's step (Search Console, the website's code, the owner's logins) is not taken in bulk: mark it on its own row."
          >
            <Icon name="sparkles" size={14} />
            Queue operator tasks (up to {ACT_MOST})
          </button>
          <button type="submit" name="op" value="done" role="menuitem" disabled={!picked || busy}>
            <Icon name="check-circle" size={14} />
            Mark done
          </button>
          <button type="submit" name="op" value="dismissed" role="menuitem" disabled={!picked || busy}>
            <Icon name="x-circle" size={14} />
            Dismiss
          </button>
        </div>
      </details>
    </div>
  );
}
