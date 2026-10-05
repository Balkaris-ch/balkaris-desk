"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { Dialog, DialogActions, DialogClose } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import type { IconName } from "@/components/ui/icons";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { send, useSend } from "@/components/operator/send";
import { cx } from "@/lib/cx";
import { API } from "./look";

/**
 * SEO › Competitors' actions on the open web. Each posts to the desk server
 * (POST /api/v1/seo/competitors/…), prints the server's own sentence under
 * the button, and draws the page again from the server. Nothing here changes
 * the website: a lookup reads public facts, a check asks who ranks, a
 * decision is the desk's own record.
 */

type Answer = { ok: boolean; line: string; href?: string };

/** The server's sentence, in place. */
function Said({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <span className={cx("dk-seo-competitors-said", !message.ok && "dk-seo-competitors-said--bad")} role={message.ok ? "status" : "alert"}>
      <Icon name={message.ok ? "check-circle" : "alert"} size={12} />
      <span>{message.text}</span>
    </span>
  );
}

/** A form that posts, then goes where the answer points (the card or the check it opened). */
function useGoTo() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async (path: string, body: unknown) => {
    setBusy(true);
    setMessage(null);
    const r = await send<Answer>(path, body);
    setBusy(false);
    if (!r.ok) return setMessage({ ok: false, text: r.message });
    setMessage({ ok: true, text: r.value.line });
    if (r.value.href) router.push(r.value.href, { scroll: false });
    else router.refresh();
  };
  return { go, busy, message, setMessage };
}

/** "Look up any site": a domain or a whole address, as typed or pasted. */
export function LookupForm({ initial }: { initial?: string }) {
  const { go, busy, message, setMessage } = useGoTo();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = String(new FormData(e.currentTarget).get("input") ?? "").trim();
    if (input.length < 3) return setMessage({ ok: false, text: "Type a site's address or its domain, like example.ch." });
    void go(`${API}/lookup`, { input });
  };
  return (
    <form className="dk-seo-competitors-ask" onSubmit={submit}>
      <label className="dk-seo-competitors-ask-field">
        <Icon name="globe" size={14} />
        <input name="input" type="text" inputMode="url" defaultValue={initial} placeholder="Any site: example.ch or a pasted address" aria-label="A site to look up" autoComplete="off" spellCheck={false} />
      </label>
      <Button type="submit" variant="quiet" size="sm" icon="search" disabled={busy} aria-busy={busy || undefined} title="Reads what the open web says about it: registration, sitemap, languages, what it is built with, structured data, rank lists, archive. One of today's domain lookups; kept seven days.">
        {busy ? "Looking up…" : "Look up"}
      </Button>
      <Said message={message} />
    </form>
  );
}

/** "Who ranks for…": a phrase and its language, checked through the web layer. */
export function SerpForm({ initial, lang, langs }: { initial?: string | null; lang?: string | null; langs: readonly string[] }) {
  const { go, busy, message, setMessage } = useGoTo();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const phrase = String(f.get("phrase") ?? "").trim();
    if (phrase.length < 2) return setMessage({ ok: false, text: "Type the search to check: 2 to 120 characters." });
    void go(`${API}/serp`, { phrase, lang: String(f.get("lang") ?? "") || undefined });
  };
  return (
    <form className="dk-seo-competitors-ask" onSubmit={submit}>
      <label className="dk-seo-competitors-ask-field">
        <Icon name="search" size={14} />
        <input name="phrase" type="text" defaultValue={initial ?? ""} placeholder="Who ranks for… webdesign zürich" aria-label="A search to check" autoComplete="off" maxLength={120} />
      </label>
      <Select name="lang" label="Language" options={langs.map((l) => ({ value: l, label: l.toUpperCase() }))} defaultValue={lang ?? "de"} />
      <Button type="submit" variant="quiet" size="sm" icon="refresh" disabled={busy} aria-busy={busy || undefined} title="Google's result page through the studio workstation (or DataForSEO when it is connected), and DuckDuckGo's as a second opinion. Every result is kept as an observation.">
        {busy ? "Asking…" : "Check now"}
      </Button>
      <Said message={message} />
    </form>
  );
}

/** One action as a button: posts `body` to `path`, says the server's sentence, draws the page again. */
export function ActButton({ path, body, label, busyLabel = "Asking…", icon, variant = "quiet", size = "xs", title }: { path: string; body: unknown; label: string; busyLabel?: string; icon?: IconName; variant?: ButtonVariant; size?: ButtonSize; title?: string }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-competitors-act">
      <Button variant={variant} size={size} icon={icon} disabled={busy} aria-busy={busy || undefined} title={title} onClick={() => void go<Answer>(`${API}${path}`, body, (v) => v.line)}>
        {busy ? busyLabel : label}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** "The same company as…": count this row as another one. */
export function MergeForm({ domain, options }: { domain: string; options: { key: string; name: string }[] }) {
  const { go, busy, message } = useSend();
  if (!options.length) return null;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const into = String(new FormData(e.currentTarget).get("into") ?? "");
    if (into) void go<Answer>(`${API}/decide`, { domain, mergeInto: into }, (v) => v.line);
  };
  return (
    <form className="dk-seo-competitors-inline" onSubmit={submit}>
      <Select name="into" label="The same company as" options={options.map((o) => ({ value: o.key, label: `Same as ${o.name}` }))} />
      <Button type="submit" variant="ghost" size="xs" disabled={busy} title="Count this row as the one chosen: its observations join it. Undo from the merged row's detail.">
        Merge
      </Button>
      <Said message={message} />
    </form>
  );
}

/** File a captured search under one of our clusters by hand, or under none. */
export function FileSearch({ query, current, clusters }: { query: string; current: string | null; clusters: { key: string; name: string; lang: string }[] }) {
  const { go, busy, message } = useSend();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cluster = String(new FormData(e.currentTarget).get("cluster") ?? "");
    void go<Answer>(`${API}/file`, { query, cluster: cluster || null }, (v) => v.line);
  };
  return (
    <form className="dk-seo-competitors-inline" onSubmit={submit}>
      <Select name="cluster" label={`Cluster for “${query}”`} options={[{ value: "", label: "Under no cluster" }, ...clusters.map((c) => ({ value: c.key, label: c.name }))]} defaultValue={current ?? ""} />
      <Button type="submit" variant="ghost" size="xs" disabled={busy} title="Files the search by hand: its observations and pages follow, here and on Content Gaps.">
        File
      </Button>
      <Said message={message} />
    </form>
  );
}

const today = (): string => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });

/**
 * "Record a Google result by hand": a result page the owner looked at in his
 * own browser, kept under his name (POST /api/v1/seo/competitors/record).
 * Recording the same search and day again corrects his record.
 */
export function RecordGoogle({ owner, phrase }: { owner: boolean; phrase?: string | null }) {
  if (!owner) return <span className="dk-seo-competitors-quiet">Results are recorded by hand by the owner</span>;
  return (
    <Dialog
      title="Record a Google result"
      description="A Google result page you looked at in your own browser: the search, the day, and the results in order. Recording the same search and day again corrects your record; the audit's and the checks' are kept."
      trigger={{ label: "Record by hand", size: "sm", variant: "ghost", icon: "plus" }}
    >
      <RecordForm phrase={phrase} />
    </Dialog>
  );
}

function RecordForm({ phrase }: { phrase?: string | null }) {
  const send = useSend();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await send.go<Answer>(
      `${API}/record`,
      { phrase: String(f.get("phrase") ?? ""), lang: String(f.get("lang") ?? "de"), day: String(f.get("day") ?? today()), results: String(f.get("results") ?? ""), mapPack: String(f.get("mapPack") ?? ""), ours: String(f.get("ours") ?? "").trim() || null },
      (v) => v.line,
    );
  };
  return (
    <form className="dk-seo-competitors-form" onSubmit={(e) => void submit(e)}>
      <Field label="The search, as typed">
        <Input name="phrase" defaultValue={phrase ?? ""} required minLength={2} maxLength={120} />
      </Field>
      <div className="dk-seo-competitors-form-row">
        <Field label="Language">
          <Select name="lang" label="Language" size="md" options={["de", "en", "fr", "it"].map((l) => ({ value: l, label: l.toUpperCase() }))} defaultValue="de" />
        </Field>
        <Field label="Day you looked">
          <Input type="date" name="day" defaultValue={today()} max={today()} required />
        </Field>
        <Field label="Balkaris's place" hint="Empty when it was not there.">
          <Input type="number" name="ours" min={1} max={100} />
        </Field>
      </div>
      <Field label="The results, in Google's order" hint="One per line: the address (example.ch/page), optionally after its place (“3 example.ch”). Ads left out.">
        <Textarea name="results" rows={6} required />
      </Field>
      <Field label="The map pack, in order" hint="Optional: one company name per line.">
        <Textarea name="mapPack" rows={3} />
      </Field>
      <Said message={send.message} />
      <DialogActions>
        <DialogClose />
        <Button type="submit" variant="primary" disabled={send.busy} aria-busy={send.busy || undefined}>
          {send.busy ? "Keeping…" : "Keep the result"}
        </Button>
      </DialogActions>
    </form>
  );
}

/** The owner's import of the SEO audit's files (POST /api/v1/seo/imports/audit): idempotent, it adds what is new. */
export function ImportAudit({ owner }: { owner: boolean }) {
  const { go, busy, message } = useSend();
  if (!owner) return null;
  return (
    <span className="dk-seo-competitors-act">
      <Button variant="ghost" size="sm" icon="upload" disabled={busy} aria-busy={busy || undefined} title="Imports the SEO audit's captured results and AI answers again from the box's audit folder. What is already kept stays; only what is new is added." onClick={() => void go<{ ok: boolean; lines: string[] }>("/api/v1/seo/imports/audit", {}, (v) => v.lines.slice(0, 3).join(" "))}>
        {busy ? "Importing…" : "Import the audit"}
      </Button>
      <Said message={message} />
    </span>
  );
}
