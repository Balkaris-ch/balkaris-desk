"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { buttonClass } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { proposeRedirect, type Proposed } from "./actions";

/**
 * "Propose redirect" for an address the website no longer has: where to send
 * it (the page the address already lands on, else the home page, until a
 * person writes another), then one press that puts the redirect in AI
 * Operator › Approvals. The desk server's sentence is shown in place, and the
 * screen is drawn again so the panel says the redirect is waiting.
 */
export function RedirectForm({ from, suggested }: { from: string; suggested: string }) {
  const [to, setTo] = useState(suggested);
  const [said, setSaid] = useState<Proposed | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const send = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    start(async () => {
      let answer: Proposed;
      try {
        answer = await proposeRedirect(from, to);
      } catch {
        answer = { ok: false, message: "The desk did not answer. Try again in a moment." };
      }
      setSaid(answer);
      if (answer.ok) router.refresh();
    });
  };
  return (
    <form onSubmit={send} className="dk-seo-pages-redirect">
      <Field label={`Send ${from} to`} hint="An address of the website that answers 200, such as /about.">
        <Input value={to} onChange={(e) => setTo(e.target.value)} maxLength={200} spellCheck={false} autoComplete="off" required />
      </Field>
      <button type="submit" className={buttonClass({ variant: "primary", size: "sm" })} disabled={busy || said?.ok === true}>
        <Icon name="redirect" size={14} />
        <span className="dk-btn-label">{busy ? "Proposing…" : said?.ok ? "Proposed" : "Propose redirect"}</span>
      </button>
      {said ? (
        <p className={cx("dk-seo-pages-queued", said.ok ? "dk-seo-pages-queued--ok" : "dk-seo-pages-queued--no")} role="status">
          <Icon name={said.ok ? "check-circle" : "alert"} size={13} />
          <span>{said.ok ? `${said.line} Nothing changes on the website until a person approves it.` : said.message}</span>
        </p>
      ) : null}
    </form>
  );
}
