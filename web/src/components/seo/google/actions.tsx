"use client";

import { useState, type FormEvent } from "react";
import type { GoogleAnswer, IndexNowAnswer, InspectAnswer as InspectAnswerT, InspectNow } from "@/contract/seo/google";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { useSend } from "@/components/operator/send";
import { cx } from "@/lib/cx";
import { InspectAnswer } from "./InspectAnswer";
import "./google.css";

/**
 * What the desk does at Google and the other search engines, one button each
 * (POST /api/v1/seo/google/…, contract/seo/google.ts). Each answer or refusal
 * is the server's own sentence, printed under the button; the server decides
 * who may (edit on Technical, Search Console or Pages) and refuses, in one
 * sentence, while the website does not answer 200.
 *
 * Exported for every tab that draws Google's state: Technical draws them all
 * in its Google panel; Search Console and Pages can put "Inspect now" and
 * "Submit sitemap" beside their own rows.
 *
 *   InspectNowButton       Google's URL Inspection of one address, now
 *   InspectAddress         the same for any address typed in
 *   SubmitSitemapButton    submit one of the site's sitemaps to Google, or again
 *   RefreshSitemapsButton  ask Search Console for its list of sitemaps again
 *   MarkRequestedButton    "I pressed Request indexing in Search Console" (Google has no API for it)
 *   AnnounceChangedButton  tell Bing, Yandex, Seznam, Naver and Yep what changed (IndexNow)
 *   AnnounceAddress        the same for one address typed in
 */

const API = "/api/v1/seo/google";

/** What the desk said after a press, in one line, under the button. */
export function Said({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p className={cx("dk-seo-google-said", !message.ok && "dk-seo-google-said--bad")} role={message.ok ? "status" : "alert"}>
      {message.text}
    </p>
  );
}

/** Ask Google about one address now, and show its answer under the button. */
export function InspectNowButton({ path, label = "Inspect now", size = "xs", variant = "quiet", compact }: { path: string; label?: string; size?: ButtonSize; variant?: ButtonVariant; compact?: boolean }) {
  const { go, busy, message } = useSend();
  const [answer, setAnswer] = useState<InspectNow | null>(null);
  return (
    <span className="dk-seo-google-act">
      <Button
        variant={variant}
        size={size}
        icon="search"
        disabled={busy}
        aria-busy={busy || undefined}
        title={`Google's URL Inspection of ${path}, now. One of the day's 2,000.`}
        onClick={async () => {
          setAnswer(null);
          const r = await go<InspectAnswerT>(`${API}/inspect`, { path }, (v) => v.line);
          if (r.ok) setAnswer(r.value.inspection);
        }}
      >
        {busy ? "Asking Google…" : label}
      </Button>
      {answer ? <InspectAnswer inspection={answer} compact={compact} /> : <Said message={message} />}
    </span>
  );
}

/** Any address of the site, typed in, inspected now. */
export function InspectAddress() {
  const { go, busy, message } = useSend();
  const [answer, setAnswer] = useState<InspectNow | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const path = String(new FormData(e.currentTarget).get("path") ?? "").trim();
    if (!path) return;
    setAnswer(null);
    const r = await go<InspectAnswerT>(`${API}/inspect`, { path }, (v) => v.line);
    if (r.ok) setAnswer(r.value.inspection);
  };
  return (
    <div className="dk-seo-google-form-wrap">
      <form className="dk-seo-google-form" onSubmit={submit} aria-label="Inspect an address now">
        <Input name="path" placeholder="/a-page or https://www.balkaris.ch/a-page" aria-label="An address of the website" maxLength={500} required />
        <Button type="submit" size="sm" icon="search" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Asking Google…" : "Inspect"}
        </Button>
      </form>
      {answer ? <InspectAnswer inspection={answer} /> : <Said message={message} />}
    </div>
  );
}

/**
 * Submit one of the website's own sitemaps to Google ("Submit again" for one
 * Search Console already has). `blocked` disables it with the reason on hover:
 * the website not answering, or the desk's account not allowed to.
 */
export function SubmitSitemapButton({ path, known, blocked, size = "xs" }: { path: string; known: boolean; blocked?: string | null; size?: ButtonSize }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-google-act">
      <Button
        variant={known ? "quiet" : "good"}
        size={size}
        icon="send"
        disabled={busy || !!blocked}
        aria-busy={busy || undefined}
        title={blocked ?? `Tell Google to fetch ${path} again. It fetches it on its own schedule.`}
        onClick={() => void go<GoogleAnswer>(`${API}/sitemaps/submit`, { path }, (v) => v.line)}
      >
        {busy ? "Submitting…" : known ? "Submit again" : "Submit to Google"}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** Ask Search Console for its list of sitemaps again: a read, nothing changes at Google. */
export function RefreshSitemapsButton({ size = "xs" }: { size?: ButtonSize }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-google-act">
      <Button variant="ghost" size={size} icon="refresh" disabled={busy} aria-busy={busy || undefined} onClick={() => void go<GoogleAnswer>(`${API}/sitemaps/refresh`, {}, (v) => v.line)}>
        {busy ? "Asking…" : "Ask Google again"}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** "I pressed Request indexing in Search Console" for a page, or the mark taken back. */
export function MarkRequestedButton({ path, requested }: { path: string; requested: boolean }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-google-act">
      <Button
        variant={requested ? "ghost" : "good"}
        size="xs"
        icon={requested ? "refresh" : "check"}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={requested ? `Take back the requested mark for ${path}` : `Mark ${path} as requested in Search Console`}
        onClick={() => void go<GoogleAnswer>(`${API}/requested`, { path, requested: !requested }, (v) => v.line)}
      >
        {busy ? "Saving…" : requested ? "Undo" : "Mark requested"}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** Tell the IndexNow engines about every sitemap address that changed since the desk last did. */
export function AnnounceChangedButton({ count, blocked }: { count: number; blocked?: string | null }) {
  const { go, busy, message } = useSend();
  const none = count === 0;
  return (
    <span className="dk-seo-google-act">
      <Button
        variant="good"
        size="sm"
        icon="send"
        disabled={busy || none || !!blocked}
        aria-busy={busy || undefined}
        title={blocked ?? (none ? "Nothing has changed since the last announcement." : undefined)}
        onClick={() => void go<IndexNowAnswer>(`${API}/indexnow`, { changed: true }, (v) => v.line)}
      >
        {busy ? "Announcing…" : none ? "Nothing to announce" : `Announce ${count} changed`}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** One address of the site, typed in, announced to the IndexNow engines. */
export function AnnounceAddress({ blocked }: { blocked?: string | null }) {
  const { go, busy, message } = useSend();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const path = String(new FormData(e.currentTarget).get("path") ?? "").trim();
    if (path) void go<IndexNowAnswer>(`${API}/indexnow`, { paths: [path] }, (v) => v.line);
  };
  return (
    <div className="dk-seo-google-form-wrap">
      <form className="dk-seo-google-form" onSubmit={submit} aria-label="Announce one address">
        <Input name="path" placeholder="/a-page" aria-label="An address of the website to announce" maxLength={500} required disabled={!!blocked} />
        <Button type="submit" size="sm" variant="quiet" icon="send" disabled={busy || !!blocked} aria-busy={busy || undefined} title={blocked ?? undefined}>
          {busy ? "Announcing…" : "Announce"}
        </Button>
      </form>
      <Said message={message} />
    </div>
  );
}
