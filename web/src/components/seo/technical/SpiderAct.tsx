"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { ExtractKind, ExtractRule } from "@/contract/spider";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogActions, DialogClose } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { useSend, type Sent } from "@/components/operator/send";
import { cx } from "@/lib/cx";
import { ago } from "@/lib/format";

/**
 * Custom extraction's buttons, the owner's only (the desk server refuses them
 * to anybody else). They go the way the page's other buttons go (Act.tsx):
 * from the browser to /api/v1 on its own origin, so the server sees the
 * visitor's cookie and Origin and answers in its own words, which are printed
 * beside the button. Nothing here starts a crawl; a rule runs from the next.
 *
 *   AddRule     POST   /api/v1/spider/extract              the server tries the
 *                                                          rule on its test page
 *                                                          (up to ~3 s), then keeps it
 *   ToggleRule  POST   /api/v1/spider/extract/:id/toggle   { enabled }
 *   DeleteRule  DELETE /api/v1/spider/extract/:id          the rule and what it found,
 *                                                          after a confirmation
 */

/** What the desk said after a press, in one line under the button. */
function Said({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p className={cx("dk-seo-technical-said", !message.ok && "dk-seo-technical-said--bad")} role={message.ok ? "status" : "alert"}>
      {message.text}
    </p>
  );
}

/* `send` (operator/send.ts) posts only; a rule is removed with DELETE, the same way otherwise. */
async function drop<T>(path: string): Promise<Sent<T>> {
  try {
    const res = await fetch(path, { method: "DELETE", credentials: "same-origin", headers: { accept: "application/json" } });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) return { ok: true, value: json as T };
    const said = json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string" ? (json as { error: string }).error : "";
    return { ok: false, status: res.status, message: said || (res.status === 401 ? "Signed out: sign in again." : `The desk server answered ${res.status}.`) };
  } catch {
    return { ok: false, status: 0, message: "The desk server is not answering." };
  }
}

const KINDS = [
  { value: "css", label: "CSS selector" },
  { value: "regex", label: "Regular expression" },
  { value: "xpath", label: "XPath" },
] as const;

/** What each kind's expression is, as the contract defines it (contract/spider.ts). */
const EXPRESSION: Record<ExtractKind, string> = {
  css: "A CSS selector, at most 300 characters.",
  regex: "A pattern on the page’s HTML, bare or as /pattern/flags (flags i, m, s, u), at most 300 characters.",
  xpath: "The subset the desk reads: absolute paths, name or * steps, simple predicates, a last step of @attribute or text(). At most 300 characters.",
};

/** The field after it: an attribute for css and xpath, a capture group for regex. */
const SECOND: Record<ExtractKind, { label: string; hint: string }> = {
  css: { label: "Attribute (optional)", hint: "Read this attribute instead of the text. Empty: the text." },
  xpath: { label: "Attribute (optional)", hint: "Read this attribute instead of the text. Empty: the text." },
  regex: { label: "Capture group (optional)", hint: "The group to keep: its number or its name. Empty: the whole match." },
};

/**
 * "Add a rule". The server checks the rule's form, then times it on the desk's
 * test page and refuses one that is too slow, in its own sentence. A rule kept
 * runs from the next crawl (once a day); this does not start one.
 */
export function AddRule({ nextCrawl }: { nextCrawl: string | null }) {
  const form = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<ExtractKind>("css");
  const { go, busy, message } = useSend();

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    const name = text("name");
    const r = await go<ExtractRule>(
      "/api/v1/spider/extract",
      { name, kind: text("kind"), expression: String(f.get("expression") ?? ""), attribute: text("attribute") || null, scope: text("scope") || null },
      (rule) => `Added “${rule.name}”. It runs from the next crawl${nextCrawl ? `, ${ago(nextCrawl)}` : ""}; the crawl reads the site once a day.`,
    );
    if (r.ok) {
      form.current?.reset();
      setKind("css");
    }
  };

  return (
    <form
      ref={form}
      className="dk-seo-technical-rule-form"
      onSubmit={add}
      onChange={(e) => {
        const t = e.target;
        if (t instanceof HTMLSelectElement && t.name === "kind") setKind(t.value as ExtractKind);
      }}
    >
      <div className="dk-seo-technical-rule-form-row">
        <Field label="Name">
          <Input name="name" required maxLength={80} autoComplete="off" />
        </Field>
        <Field label="Kind">
          <Select name="kind" label="Kind" size="md" options={KINDS} defaultValue="css" />
        </Field>
      </div>
      <Field label="Expression" hint={EXPRESSION[kind]}>
        <Input name="expression" required maxLength={300} autoComplete="off" spellCheck={false} className="dk-seo-technical-rule-mono" />
      </Field>
      <div className="dk-seo-technical-rule-form-row">
        <Field label={SECOND[kind].label} hint={SECOND[kind].hint}>
          <Input name="attribute" maxLength={80} autoComplete="off" spellCheck={false} className="dk-seo-technical-rule-mono" />
        </Field>
        <Field label="Scope (optional)" hint="The beginning of the addresses it runs on, starting with /. Empty: every page.">
          <Input name="scope" maxLength={200} autoComplete="off" spellCheck={false} className="dk-seo-technical-rule-mono" />
        </Field>
      </div>
      <div className="dk-seo-technical-rule-form-foot">
        <Button type="submit" variant="good" size="sm" icon="plus" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Trying it on the test page…" : "Add rule"}
        </Button>
        {busy ? (
          <p className="dk-seo-technical-quiet" role="status">
            The desk times the rule on its test page before it keeps it; that takes up to a few seconds.
          </p>
        ) : (
          <Said message={message} />
        )}
      </div>
    </form>
  );
}

/** Switch a rule on or off. Switching one on is refused while the most a crawl runs are on. */
export function ToggleRule({ id, name, enabled }: { id: number; name: string; enabled: boolean }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-technical-act">
      <Button
        variant="quiet"
        size="xs"
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={enabled ? `Switch “${name}” off` : `Switch “${name}” on`}
        onClick={() =>
          void go<ExtractRule>(`/api/v1/spider/extract/${id}/toggle`, { enabled: !enabled }, (r) => (r.enabled ? "Switched on: it runs from the next crawl." : "Switched off: the next crawl leaves it out."))
        }
      >
        {busy ? "Saving…" : enabled ? "Switch off" : "Switch on"}
      </Button>
      <Said message={message} />
    </span>
  );
}

/**
 * Delete a rule, after a confirmation, with everything it found. When its
 * results are open (`back`), the address drops them, so the page does not ask
 * for a rule that is gone.
 */
export function DeleteRule({ id, name, back }: { id: number; name: string; back: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const remove = async (button: HTMLButtonElement) => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    const r = await drop<{ ok: true }>(`/api/v1/spider/extract/${id}`);
    setBusy(false);
    if (!r.ok) {
      setFailed(r.message);
      return;
    }
    button.closest("dialog")?.close();
    if (back) router.replace(back, { scroll: false });
    else router.refresh();
  };

  return (
    <Dialog title={`Delete “${name}”?`} size="sm" trigger={{ label: "Delete", variant: "danger", size: "xs", icon: "trash" }}>
      <p className="dk-seo-technical-rule-ask">The rule and everything it found are removed from the desk, and the crawl stops running it. This cannot be undone; the rule can be added again.</p>
      {failed ? (
        <p className="dk-seo-technical-said dk-seo-technical-said--bad dk-seo-technical-rule-ask-said" role="alert">
          {failed}
        </p>
      ) : null}
      <DialogActions>
        <DialogClose variant="quiet" size="sm">
          Keep it
        </DialogClose>
        <Button variant="danger" size="sm" icon="trash" disabled={busy} aria-busy={busy || undefined} onClick={(e) => void remove(e.currentTarget)}>
          {busy ? "Deleting…" : "Delete the rule"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
