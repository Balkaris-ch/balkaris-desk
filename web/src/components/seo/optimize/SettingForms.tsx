"use client";

import { useState, type ReactNode } from "react";
import type { PictureAnswer, ProposalAnswer, ProposalRow, TaskAnswer } from "@/contract/operator";
import type { AiDraft } from "@/contract/seo/page-view";
import { send, useSend } from "@/components/operator/send";
import { buttonClass } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import "@/components/ui/field.css";

/**
 * The page's settings, the parts a person presses (Optimize tab). Every
 * change goes through the operator's one door: POST /api/v1/operator/proposals
 * (rules, then a person who can publish approves), /pictures for a share
 * picture, /tasks for the local model's draft, /proposals/:id/… to approve,
 * reject, withdraw or read back. The server's sentence is shown beside the
 * button, word for word; the screen is drawn again when it answers.
 *
 * Each part is keyed by the page's address where it is used, so what is typed
 * for one page never stays on the next.
 */

const chars = (s: string): number => [...s].length;

/** The line under a group of buttons: the server's refusal, or what happened. */
function Said({ message, children }: { message: { ok: boolean; text: string } | null; children?: ReactNode }) {
  if (message) return <p className={cx("dk-seo-optimize-said", !message.ok && "dk-seo-optimize-said--bad")} aria-live="polite">{message.text}</p>;
  return children ? <p className="dk-seo-optimize-said">{children}</p> : null;
}

/** "Ask the AI": the local model's draft, as an operator task. A draft already asked waits for its task. */
export function AiButtons({ drafts }: { drafts: AiDraft[] }) {
  const { go, busy, message } = useSend();
  const [asked, setAsked] = useState<{ id: number; gives: AiDraft["gives"] } | null>(null);
  const pending = drafts.find((d) => d.pending);
  return (
    <div className="dk-seo-optimize-set-ai">
      <div className="dk-seo-optimize-set-row">
        {drafts.map((d) => (
          <button
            key={d.label}
            type="button"
            className={buttonClass({ variant: "quiet", size: "sm" })}
            disabled={busy || !d.available || asked !== null}
            title={d.available ? d.step : (d.unavailable ?? undefined)}
            onClick={() =>
              void go<TaskAnswer>("/api/v1/operator/tasks", d.task, (v) => {
                setAsked({ id: v.task.id, gives: d.gives });
                return null;
              })
            }
          >
            <Icon name="sparkles" size={14} />
            <span>{d.label}</span>
          </button>
        ))}
      </div>
      <Said message={message && !message.ok ? message : null}>
        {asked ? (
          <>
            Asked as operator task #{asked.id}: the studio workstation’s model answers when it is on
            {asked.gives === "proposal" ? ", and its draft waits for approval below." : ", in words; nothing changes by it."}{" "}
            <Go href={`/operator?result=${asked.id}#response`} className="dk-seo-optimize-link">
              Follow it
            </Go>
          </>
        ) : pending?.pending ? (
          <>
            {pending.unavailable}{" "}
            <Go href={pending.pending.href} className="dk-seo-optimize-link">
              Task #{pending.pending.id}
            </Go>
          </>
        ) : (
          drafts.find((d) => !d.available)?.unavailable ?? null
        )}
      </Said>
    </div>
  );
}

const VERB: Record<"approve" | "reject" | "withdraw" | "check", { label: string; done: string }> = {
  approve: { label: "Approve", done: "Approved and committed to the website." },
  reject: { label: "Reject", done: "Rejected: nothing changes on the site." },
  withdraw: { label: "Withdraw", done: "Withdrawn: the website goes back to its own value with the next deploy." },
  check: { label: "Check the live page", done: "" },
};

/**
 * A proposal's own buttons: approve or reject what waits, withdraw or read
 * back what is live. Approving and withdrawing take the right to publish, and
 * a development copy of the desk refuses them: the refusal is said here.
 */
export function ProposalActions({ p }: { p: ProposalRow }) {
  const { go, busy, message } = useSend();
  const open = p.state === "waiting" || (p.state === "approved" && !!p.error);
  const verbs: (keyof typeof VERB)[] = open ? ["approve", "reject"] : p.state === "applied" ? ["check", "withdraw"] : [];
  if (!verbs.length) return null;
  return (
    <div className="dk-seo-optimize-set-acts">
      <div className="dk-seo-optimize-set-row">
        {verbs.map((v) => (
          <button
            key={v}
            type="button"
            className={buttonClass({ variant: v === "approve" ? "primary" : v === "reject" || v === "withdraw" ? "ghost" : "quiet", size: "xs" })}
            disabled={busy || (v === "approve" && !!p.drift)}
            title={v === "approve" && p.drift ? "The page has changed since it was proposed: ask again." : p.consequence}
            onClick={() => void go<ProposalAnswer>(`/api/v1/operator/proposals/${p.id}/${v}`, {}, (a) => a.line ?? (VERB[v].done || null))}
          >
            {VERB[v].label}
          </button>
        ))}
      </div>
      <Said message={message} />
    </div>
  );
}

/** A form behind its "Edit" button, so the three columns stay readable until a person writes. */
export function Editable({ label = "Edit", children, locked }: { label?: string; children: ReactNode; locked: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="dk-seo-optimize-set-edit">
      <button type="button" className={buttonClass({ variant: open ? "ghost" : "quiet", size: "sm" })} aria-expanded={open} disabled={!!locked} title={locked ?? undefined} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? "x" : "edit"} size={14} />
        <span>{open ? "Close" : label}</span>
      </button>
      {open ? <div className="dk-seo-optimize-set-form">{children}</div> : null}
    </div>
  );
}

/** "Propose for approval" and the line under it, shared by the forms below. */
function useProposal() {
  const s = useSend();
  const [made, setMade] = useState<number | null>(null);
  const propose = (body: unknown) =>
    void s.go<ProposalAnswer>("/api/v1/operator/proposals", body, (v) => {
      setMade(v.proposal.id);
      return null;
    });
  const line = (
    <Said message={s.message && !s.message.ok ? s.message : null}>
      {made ? (
        <>
          Proposal #{made} waits for approval; the live page is unchanged until someone who can publish approves it.{" "}
          <Go href="/operator?ap=waiting#approvals" className="dk-seo-optimize-link">
            Approvals
          </Go>
        </>
      ) : (
        "Nothing changes on the live site until someone who can publish approves it."
      )}
    </Said>
  );
  return { propose, busy: s.busy, line };
}

function SubmitButton({ busy, disabled }: { busy: boolean; disabled: boolean }) {
  return (
    <button type="submit" className={buttonClass({ variant: "primary", size: "sm" })} disabled={busy || disabled}>
      <Icon name="check" size={14} />
      <span>{busy ? "Proposing…" : "Propose for approval"}</span>
    </button>
  );
}

function Count({ n, limit }: { n: number; limit: number }) {
  return (
    <span className={cx("dk-field-hint dk-num", n > limit && "dk-tone-warn")}>
      {num(n)} of {num(limit)} characters{n > limit ? ": cut on most cards" : ""}
    </span>
  );
}

/** Reads a picture file as base64, without the "data:…," head. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new Error("The file could not be read."));
    r.readAsDataURL(file);
  });
}

/**
 * The share card: title, text and picture, with the card a shared link would
 * show. A picture is uploaded first (POST /api/v1/operator/pictures: PNG, JPEG
 * or WebP, at most 600 KB, at least 600 by 315) or picked from the ones the
 * site has; the proposal names it by its site path. Only the fields that
 * differ from the live page are proposed.
 */
export function ShareEditor({
  path,
  host,
  live,
  pictures,
  fallbackTitle,
  fallbackDescription,
}: {
  path: string;
  host: string;
  live: { title: string | null; description: string | null; picture: string | null; pictureUrl: string | null };
  pictures: { label: string; sitePath: string; url: string }[];
  fallbackTitle: string | null;
  fallbackDescription: string | null;
}) {
  const { propose, busy, line } = useProposal();
  const [title, setTitle] = useState(live.title ?? "");
  const [text, setText] = useState(live.description ?? "");
  const [why, setWhy] = useState("");
  const [pic, setPic] = useState<{ sitePath: string; url: string } | null>(null);
  const [upload, setUpload] = useState<{ busy: boolean; said: { ok: boolean; text: string } | null }>({ busy: false, said: null });
  const changed = {
    ogTitle: title.trim() && title.trim() !== (live.title ?? "") ? title.trim() : undefined,
    ogDescription: text.trim() && text.trim() !== (live.description ?? "") ? text.trim() : undefined,
    ogImage: pic ? pic.sitePath : undefined,
  };
  const any = changed.ogTitle !== undefined || changed.ogDescription !== undefined || changed.ogImage !== undefined;
  const shownPicture = pic?.url ?? live.pictureUrl;

  return (
    <div className="dk-seo-optimize-editor">
      <form
        className="dk-seo-optimize-editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (any) propose({ kind: "og", address: path, ...changed, why: why.trim() || undefined });
        }}
      >
        <label className="dk-field">
          <span className="dk-field-label">Share title</span>
          <input className="dk-input" value={title} maxLength={110} onChange={(e) => setTitle(e.target.value)} />
          <Count n={chars(title.trim())} limit={70} />
        </label>
        <label className="dk-field">
          <span className="dk-field-label">Share text</span>
          <textarea className="dk-input" rows={3} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
          <Count n={chars(text.trim())} limit={200} />
        </label>
        <div className="dk-field">
          <span className="dk-field-label">Share picture</span>
          <select
            className="dk-input"
            value={pic?.sitePath ?? ""}
            onChange={(e) => {
              const p = pictures.find((x) => x.sitePath === e.target.value);
              setPic(p ? { sitePath: p.sitePath, url: p.url } : null);
            }}
          >
            <option value="">Keep the picture the page has</option>
            {pictures.map((p) => (
              <option key={p.sitePath} value={p.sitePath}>
                {p.label}: {p.sitePath}
              </option>
            ))}
            {pic && !pictures.some((p) => p.sitePath === pic.sitePath) ? <option value={pic.sitePath}>Uploaded: {pic.sitePath}</option> : null}
          </select>
          <label className={buttonClass({ variant: "quiet", size: "sm" }, "dk-seo-optimize-set-upload")}>
            <Icon name="upload" size={14} />
            <span>{upload.busy ? "Uploading…" : "Upload a picture"}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="dk-sr"
              disabled={upload.busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (file.size > 600 * 1024) {
                  setUpload({ busy: false, said: { ok: false, text: `That file is ${Math.round(file.size / 1024)} KB; the desk takes at most 600 KB.` } });
                  return;
                }
                setUpload({ busy: true, said: null });
                let data: string;
                try {
                  data = await base64Of(file);
                } catch (err) {
                  setUpload({ busy: false, said: { ok: false, text: err instanceof Error ? err.message : "The file could not be read." } });
                  return;
                }
                const r = await send<PictureAnswer>("/api/v1/operator/pictures", { address: path, data, filename: file.name });
                if (r.ok) {
                  setPic({ sitePath: r.value.picture.sitePath, url: r.value.picture.url });
                  setUpload({ busy: false, said: { ok: true, text: r.value.line } });
                } else setUpload({ busy: false, said: { ok: false, text: r.message } });
              }}
            />
          </label>
          <span className="dk-field-hint">PNG, JPEG or WebP, at most 600 KB, at least 600 by 315 pixels; 1200 by 630 shows best.</span>
          <Said message={upload.said} />
        </div>
        <label className="dk-field">
          <span className="dk-field-label">Why (optional, for whoever approves)</span>
          <input className="dk-input" value={why} maxLength={400} onChange={(e) => setWhy(e.target.value)} />
        </label>
        <div className="dk-seo-optimize-editor-actions">
          <SubmitButton busy={busy} disabled={!any} />
        </div>
        {line}
      </form>
      <div className="dk-seo-optimize-editor-preview" aria-label="How a shared link will look">
        <p className="dk-seo-optimize-editor-label">As a shared link</p>
        <article className="dk-seo-optimize-share">
          {shownPicture ? (
            // The picture as a chat app or LinkedIn would show it: the upload's copy on the desk, or the live site's.
            <img src={shownPicture} alt="" className="dk-seo-optimize-share-pic" loading="lazy" />
          ) : (
            <span className="dk-seo-optimize-share-pic dk-seo-optimize-share-pic--none">No share picture</span>
          )}
          <span className="dk-seo-optimize-share-host">{host}</span>
          <span className="dk-seo-optimize-share-title">{title.trim() || fallbackTitle || "(no share title)"}</span>
          <span className="dk-seo-optimize-share-desc">{text.trim() || fallbackDescription || ""}</span>
        </article>
        <p className="dk-seo-optimize-note">{any ? "Changed from what the crawl read on the live page." : "What the crawl read on the live page."}</p>
      </div>
    </div>
  );
}

/** The canonical as the overrides file names it: a site-relative address. */
const relative = (v: string | null, host: string): string => {
  if (!v) return "";
  try {
    const u = new URL(v);
    return u.host.replace(/^www\./, "") === host.replace(/^www\./, "") ? u.pathname.replace(/\/+$/, "") || "/" : v;
  } catch {
    return v;
  }
};

/** In search or not, and the canonical: two proposals of their own, each checked by the operator's rules. */
export function IndexEditor({ path, host, noindexLive, canonicalLive, noindexRefused }: { path: string; host: string; noindexLive: boolean; canonicalLive: string | null; noindexRefused: string | null }) {
  const index = useProposal();
  const canon = useProposal();
  const [out, setOut] = useState(noindexLive);
  const [canonical, setCanonical] = useState(relative(canonicalLive, host) || path);
  const [why, setWhy] = useState("");
  return (
    <div className="dk-seo-optimize-set-forms">
      <form
        className="dk-seo-optimize-editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          index.propose({ kind: "index", address: path, noindex: out, why: why.trim() || undefined });
        }}
      >
        <label className="dk-field">
          <span className="dk-field-label">In Google’s index</span>
          <select className="dk-input" value={out ? "out" : "in"} onChange={(e) => setOut(e.target.value === "out")} disabled={!!noindexRefused && !noindexLive}>
            <option value="in">In search</option>
            <option value="out">Out of search (noindex: it also leaves the sitemap, the feed and llms.txt)</option>
          </select>
          {noindexRefused ? <span className="dk-field-hint">{noindexRefused}</span> : null}
        </label>
        <label className="dk-field">
          <span className="dk-field-label">Why (optional, for whoever approves)</span>
          <input className="dk-input" value={why} maxLength={400} onChange={(e) => setWhy(e.target.value)} />
        </label>
        <div className="dk-seo-optimize-editor-actions">
          <SubmitButton busy={index.busy} disabled={out === noindexLive} />
        </div>
        {index.line}
      </form>
      <form
        className="dk-seo-optimize-editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          canon.propose({ kind: "canonical", address: path, canonical: canonical.trim(), why: why.trim() || undefined });
        }}
      >
        <label className="dk-field">
          <span className="dk-field-label">Canonical (the address search engines should credit)</span>
          <input className="dk-input dk-seo-optimize-mono" value={canonical} maxLength={200} onChange={(e) => setCanonical(e.target.value)} placeholder="/services" />
          <span className="dk-field-hint">Another page of the site that is in the sitemap, answers and is in search itself. The page’s own address needs no change.</span>
        </label>
        <div className="dk-seo-optimize-editor-actions">
          <SubmitButton busy={canon.busy} disabled={!canonical.trim() || canonical.trim() === (relative(canonicalLive, host) || path)} />
        </div>
        {canon.line}
      </form>
    </div>
  );
}

/** The types the website prints from the desk's file, less the company's own (one Organization, kept in the site's code). */
const SCHEMA_TYPES = ["FAQPage", "Service", "BreadcrumbList", "Article", "HowTo", "Product", "VideoObject", "WebPage"] as const;

/** A start for each type: the shape, not the words; every name and figure must come from the page. */
function skeleton(type: string, url: string): string {
  const base: Record<string, unknown> = { "@context": "https://schema.org", "@type": type };
  if (type === "FAQPage") base.mainEntity = [{ "@type": "Question", name: "", acceptedAnswer: { "@type": "Answer", text: "" } }];
  else if (type === "Service") Object.assign(base, { name: "", description: "", provider: { "@id": "https://www.balkaris.ch/#organization" }, url });
  else Object.assign(base, { name: "", url });
  return JSON.stringify(base, null, 2);
}

/** A structured-data block written by hand: JSON, read here first so a typo is said before it is sent. */
export function SchemaEditor({ path, url, printed }: { path: string; url: string; printed: string[] }) {
  const { propose, busy, line } = useProposal();
  const first = SCHEMA_TYPES.find((t) => !printed.includes(t)) ?? "WebPage";
  const [type, setType] = useState<string>(first);
  const [text, setText] = useState(() => skeleton(first, url));
  const [why, setWhy] = useState("");
  const parsed = (() => {
    try {
      const v = JSON.parse(text) as unknown;
      if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false as const, why: "One block: a JSON object, not a list." };
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, why: `Not valid JSON yet: ${e instanceof Error ? e.message : String(e)}` };
    }
  })();
  return (
    <form
      className="dk-seo-optimize-editor-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.ok) propose({ kind: "schema", address: path, jsonLd: text, why: why.trim() || undefined });
      }}
    >
      <label className="dk-field">
        <span className="dk-field-label">Type</span>
        <select
          className="dk-input"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setText(skeleton(e.target.value, url));
          }}
        >
          {SCHEMA_TYPES.map((t) => (
            <option key={t} value={t} disabled={printed.includes(t)}>
              {t}
              {printed.includes(t) ? " (the page prints one already)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="dk-field">
        <span className="dk-field-label">The block (JSON-LD)</span>
        <textarea className="dk-input dk-seo-optimize-mono" rows={12} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
        <span className={cx("dk-field-hint", !parsed.ok && "dk-tone-warn")}>
          {parsed.ok ? `${num(new TextEncoder().encode(text).length)} of 8,192 bytes. Every name and figure must be in the page’s own text; no links to other sites.` : parsed.why}
        </span>
      </label>
      <label className="dk-field">
        <span className="dk-field-label">Why (optional, for whoever approves)</span>
        <input className="dk-input" value={why} maxLength={400} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <div className="dk-seo-optimize-editor-actions">
        <SubmitButton busy={busy} disabled={!parsed.ok} />
      </div>
      {line}
    </form>
  );
}
