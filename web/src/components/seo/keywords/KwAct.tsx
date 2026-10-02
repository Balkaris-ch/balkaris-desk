"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import type { BriefQueued, KeywordChanged, KeywordsActed, KeywordStatus, SitePageOption } from "@/contract/seo/keywords";
import { useSend } from "@/components/operator/send";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { Dialog, DialogActions, DialogClose } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Icon, type IconName } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { cx } from "@/lib/cx";
import { API } from "./href";
import "@/components/ui/select.css";

/**
 * SEO › Keywords' buttons that change something. Each posts from the browser
 * to the desk server (POST /api/v1/seo/keywords/…, contract/seo/keywords.ts),
 * which carries the person's own cookie and origin; the server decides as it
 * always does, and its sentence comes back beside the button. Then the page is
 * drawn again from the server.
 *
 * None of them changes the website. A mapping, a judgement and a target are
 * the desk's own records; a brief is an operator task answered on the studio
 * workstation, and a person writes and publishes the page.
 */

/* ---------- what every menu on the page needs once ------------------------------------------ */

interface KitValue {
  /** The pages a phrase or a cluster can be mapped to (the crawl's, answering 200), or null with the reason. */
  pages: SitePageOption[] | null;
  pagesWhy: string | null;
  /** The clusters a tracked phrase may be filed under. */
  clusters: { key: string; name: string; lang: string }[];
}

const Kit = createContext<KitValue>({ pages: null, pagesWhy: null, clusters: [] });

/** Hands the page's lists to every menu once, instead of to every row. */
export function KwKit({ pages, pagesWhy, clusters, children }: KitValue & { children: ReactNode }) {
  return <Kit.Provider value={{ pages, pagesWhy, clusters }}>{children}</Kit.Provider>;
}

/* ---------- a button that queues a brief ------------------------------------------------------ */

/** "Create brief": queues an operator brief for a phrase or a cluster, then says the task's number. */
export function BriefButton({
  url,
  label,
  title,
  variant = "quiet",
  size = "xs",
  icon = "sparkles",
  className,
}: {
  url: string;
  label: string;
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  className?: string;
}) {
  const { go, busy, message, setMessage } = useSend();
  const [queued, setQueued] = useState<{ id: number; line: string } | null>(null);
  useFade(message, setMessage);
  return (
    <span className="dk-seo-kw-act">
      <Button
        size={size}
        variant={variant}
        icon={busy ? "refresh" : queued ? "check" : icon}
        disabled={busy || !!queued}
        aria-busy={busy}
        title={queued ? queued.line : title}
        className={className}
        onClick={() =>
          void go<BriefQueued>(url, {}, (v) => {
            setQueued({ id: v.task.id, line: v.line });
            return v.line;
          })
        }
      >
        {queued ? `Queued #${queued.id}` : label}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** A sentence from the server, floating under the button that asked, gone after a while. */
function Said({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <span className={cx("dk-seo-kw-said dk-seo-kw-said--float", !message.ok && "dk-seo-kw-said--bad")} role={message.ok ? "status" : "alert"}>
      {message.text}
    </span>
  );
}

/** Clears the server's sentence after a few seconds (a refusal stays longer). */
function useFade(message: { ok: boolean; text: string } | null, setMessage: (m: null) => void) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), message.ok ? 6_000 : 12_000);
    return () => clearTimeout(t);
  }, [message, setMessage]);
}

/* ---------- a row's "⋯" ------------------------------------------------------------------------ */

/** A floating menu that stays inside the window: under its button, or over it when the window ends first. */
function useFloating() {
  const box = useRef<HTMLDetailsElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const place = useCallback(() => {
    const b = box.current?.querySelector("summary")?.getBoundingClientRect();
    const m = list.current?.getBoundingClientRect();
    if (!b || !m) return;
    const gap = 4;
    const below = b.bottom + gap + m.height <= window.innerHeight - 8;
    setAt({ left: Math.min(window.innerWidth - m.width - 8, Math.max(8, b.right - m.width)), top: below ? b.bottom + gap : Math.max(8, b.top - gap - m.height) });
  }, []);
  const close = useCallback(() => box.current?.removeAttribute("open"), []);
  useEffect(() => {
    const shut = (e: Event) => {
      if (!box.current?.open) return;
      if (e.type === "pointerdown" && box.current.contains(e.target as Node)) return;
      /* A select's own list scrolls the page under it on some systems: only a scroll outside the menu closes it. */
      if (e.type === "scroll" && list.current?.contains(e.target as Node)) return;
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
  return { box, list, at, setAt, place, close };
}

type Item =
  | { kind: "post"; label: string; icon: IconName; url: string; body: unknown; off?: boolean; title?: string }
  | { kind: "link"; label: string; icon: IconName; href: string; external?: boolean }
  | { kind: "map"; label: string; icon: IconName }
  | { kind: "head"; label: string };

/**
 * The menu itself: a native disclosure (opens with the keyboard, closes when a
 * choice is made), with one inline step for mapping to a page.
 */
function Menu({ title, items, mapUrl, mapCurrent, mapLang, said }: { title: string; items: Item[]; mapUrl: string; mapCurrent: string | null; mapLang: string | null; said?: (v: unknown) => string | null }) {
  const { box, list, at, setAt, place, close } = useFloating();
  const { go, busy, message, setMessage } = useSend();
  useFade(message, setMessage);
  const { pages, pagesWhy } = useContext(Kit);
  const [mapping, setMapping] = useState(false);
  const [choice, setChoice] = useState<string>(mapCurrent ?? "");

  /* The list changes height when the mapping step opens: place it again. */
  useEffect(() => {
    if (box.current?.open) place();
  }, [mapping, place, box]);

  const post = (url: string, body: unknown) => {
    close();
    void go<unknown>(url, body, said ?? ((v) => (v && typeof v === "object" && typeof (v as { line?: unknown }).line === "string" ? (v as { line: string }).line : null)));
  };

  /* Pages of the phrase's language first: a German search wants a German page. */
  const sorted = pages ? [...pages].sort((a, b) => Number(b.lang === mapLang) - Number(a.lang === mapLang) || a.path.localeCompare(b.path)) : [];

  return (
    <span className="dk-seo-kw-menuwrap">
      <details
        ref={box}
        className="dk-seo-kw-menu"
        onToggle={(e) => {
          if (e.currentTarget.open) place();
          else {
            setAt(null);
            setMapping(false);
          }
        }}
      >
        <summary className="dk-seo-kw-menu-button" aria-label={`More for ${title}`} title={message ? message.text : undefined}>
          <Icon name={busy ? "refresh" : message && !message.ok ? "alert" : message?.ok ? "check" : "more"} size={16} />
        </summary>
        <div ref={list} className="dk-seo-kw-menu-list" role="menu" style={at ? { left: at.left, top: at.top } : { visibility: "hidden" }}>
          {mapping ? (
            <div className="dk-seo-kw-map">
              <p className="dk-seo-kw-map-head">Which page answers {title}?</p>
              {pages ? (
                <>
                  <span className="dk-select dk-select--sm dk-seo-kw-map-select">
                    <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="The page that answers it">
                      <option value="">Choose a page…</option>
                      <option value="-">No page answers it (a gap)</option>
                      {sorted.map((p) => (
                        <option key={p.path} value={p.path}>
                          {p.path}
                          {p.title ? ` · ${p.title}` : ""}
                          {p.lang && mapLang && p.lang !== mapLang ? ` (${p.lang})` : ""}
                        </option>
                      ))}
                    </select>
                    <Icon name="chevron-down" size={14} />
                  </span>
                  <p className="dk-seo-kw-map-note">Your mapping is kept: no run or import changes it again.</p>
                  <div className="dk-seo-kw-map-actions">
                    <Button size="xs" variant="ghost" onClick={() => setMapping(false)}>
                      Back
                    </Button>
                    <Button size="xs" variant="good" icon="check" disabled={!choice || choice === (mapCurrent ?? "")} onClick={() => post(mapUrl, { path: choice === "-" ? null : choice })}>
                      Save
                    </Button>
                  </div>
                </>
              ) : (
                <p className="dk-seo-kw-map-note">{pagesWhy ?? "The crawl's pages could not be read."}</p>
              )}
            </div>
          ) : (
            items.map((it, i) => {
              if (it.kind === "head") {
                return (
                  <p key={`h${i}`} className="dk-seo-kw-menu-head">
                    {it.label}
                  </p>
                );
              }
              if (it.kind === "link") {
                return (
                  <a key={it.label} role="menuitem" href={it.href} {...(it.external ? { target: "_blank", rel: "noreferrer" } : {})} onClick={close}>
                    <Icon name={it.icon} size={14} />
                    {it.label}
                    {it.external ? <Icon name="external" size={12} className="dk-seo-kw-menu-out" /> : null}
                  </a>
                );
              }
              if (it.kind === "map") {
                return (
                  <button key={it.label} type="button" role="menuitem" onClick={() => setMapping(true)}>
                    <Icon name={it.icon} size={14} />
                    {it.label}
                  </button>
                );
              }
              return (
                <button key={it.label} type="button" role="menuitem" disabled={it.off || busy} title={it.title} onClick={() => post(it.url, it.body)}>
                  <Icon name={it.icon} size={14} />
                  {it.label}
                </button>
              );
            })
          )}
        </div>
      </details>
      <Said message={message} />
    </span>
  );
}

const googleHref = (phrase: string, lang: string | null): string => `https://www.google.ch/search?q=${encodeURIComponent(phrase)}&hl=${lang === "de" ? "de" : "en"}&gl=ch`;

/** A phrase's "⋯": a brief, a page, a target, a judgement; its opportunities; Google itself. */
export function KeywordMenu({
  id,
  phrase,
  lang,
  target,
  status,
  page,
  opportunities,
  oppsHref,
}: {
  id: number;
  phrase: string;
  lang: string | null;
  target: boolean;
  status: KeywordStatus;
  page: string | null;
  opportunities: number;
  oppsHref: string;
}) {
  const judge = (s: KeywordStatus, label: string, icon: IconName): Item => ({ kind: "post", label, icon, url: `${API}/${id}/status`, body: { status: s }, off: status === s, title: status === s ? "Judged so already." : undefined });
  const items: Item[] = [
    {
      kind: "post",
      label: "Write a brief",
      icon: "sparkles",
      url: `${API}/${id}/brief`,
      body: {},
      title: "The operator (the studio workstation's model) writes a brief for a page answering this search. A person writes and publishes; nothing reaches the site by itself.",
    },
    { kind: "map", label: page ? "Map to another page…" : "Map to a page…", icon: "link" },
    target
      ? { kind: "post", label: "Remove the target", icon: "x-circle", url: `${API}/${id}/target`, body: { target: false } }
      : { kind: "post", label: "Mark as target", icon: "target", url: `${API}/${id}/target`, body: { target: true }, title: "A phrase the site should rank for: listed under the table with its position. Judged relevant if it was not." },
    { kind: "head", label: "Judge it" },
    judge("relevant", "Relevant", "check-circle"),
    judge("weak", "Weak", "minus"),
    judge("irrelevant", "Irrelevant", "x"),
    { kind: "head", label: "See" },
    ...(opportunities ? [{ kind: "link", label: `Its opportunities (${opportunities})`, icon: "lightbulb", href: oppsHref } as Item] : []),
    { kind: "link", label: "What Google shows for it", icon: "search", href: googleHref(phrase, lang), external: true },
  ];
  return <Menu title={`“${phrase}”`} items={items} mapUrl={`${API}/${id}/page`} mapCurrent={page} mapLang={lang} />;
}

/** A cluster's "⋯": a page for the whole topic, its phrases, its opportunities. */
export function ClusterMenu({ clusterKey, name, lang, page, phrasesHref, opportunities, oppsHref }: { clusterKey: string; name: string; lang: string; page: string | null; phrasesHref: string; opportunities: number; oppsHref: string }) {
  const items: Item[] = [
    { kind: "map", label: page ? "Map to another page…" : "Map to a page…", icon: "link" },
    { kind: "link", label: "Its phrases", icon: "list", href: phrasesHref },
    ...(opportunities ? [{ kind: "link", label: `Its opportunities (${opportunities})`, icon: "lightbulb", href: oppsHref } as Item] : []),
  ];
  return (
    <Menu
      title={`“${name}”`}
      items={items}
      mapUrl={`/api/v1/seo/clusters/${encodeURIComponent(clusterKey)}/page`}
      mapCurrent={page}
      mapLang={lang}
      said={(v) => {
        const c = (v as { cluster?: { page?: string | null } } | null)?.cluster;
        return c ? (c.page ? `Mapped to ${c.page}.` : "No page answers it (a gap).") : "Done.";
      }}
    />
  );
}

/* ---------- the ticked rows ---------------------------------------------------------------------- */

interface Bulk {
  picked: number;
  busy: boolean;
  said: { ok: boolean; text: string } | null;
  form: { ref: RefObject<HTMLFormElement | null>; onChange: () => void; onSubmit: (e: FormEvent<HTMLFormElement>) => void } | null;
}

const BulkContext = createContext<Bulk>({ picked: 0, busy: false, said: null, form: null });

/** The list's form, by id: the bulk menu's buttons sit in the panel's head, outside it, and submit it by this name. */
const BULK_FORM = "dk-seo-kw-bulkform";

/**
 * The ticked rows and what is done with them. The table's checkboxes (named
 * `ids`) are the fields of one form (`KwBulkForm`, around the table only) and
 * the bulk menu's buttons, in the panel's head, submit it by its id (the
 * `form` attribute), each with what it does: so the head can also hold "Track
 * a phrase", whose dialog has a form of its own, without nesting forms. One
 * request for all the ticked rows; the server answers one line per phrase.
 */
export function KwBulk({ children, exportBase }: { children: ReactNode; exportBase: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const { go, busy, message, setMessage } = useSend();
  const [picked, setPicked] = useState(0);

  const count = useCallback(() => {
    setTimeout(() => setPicked(ref.current?.querySelectorAll('input[name="ids"]:checked').length ?? 0), 0);
  }, []);
  useEffect(() => {
    count();
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const op = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? "";
    const ids = new FormData(e.currentTarget).getAll("ids").map(Number).filter(Number.isInteger);
    if (!ids.length) return setMessage({ ok: false, text: "Tick the phrases first." });
    if (op === "export") {
      window.location.assign(`${exportBase}&${ids.map((id) => `id=${id}`).join("&")}`);
      return;
    }
    void go<KeywordsActed>(`${API}/bulk`, { ids, op }, (v) => {
      const good = v.results.filter((r) => r.ok).length;
      const bad = v.results.filter((r) => !r.ok);
      return `${good} of ${v.results.length} done${bad.length ? `; not ${bad.length}: ${bad[0]!.line}` : "."}`;
    });
  };

  return <BulkContext.Provider value={{ picked, busy, said: message, form: { ref, onChange: count, onSubmit: submit } }}>{children}</BulkContext.Provider>;
}

/** The form the table's checkboxes belong to: put it around the table, inside `KwBulk`. */
export function KwBulkForm({ children, className }: { children: ReactNode; className?: string }) {
  const { form } = useContext(BulkContext);
  return (
    <form id={BULK_FORM} ref={form?.ref} className={className} onChange={form?.onChange} onSubmit={form?.onSubmit}>
      {children}
    </form>
  );
}

/** "Bulk actions" in the list's head: what happens to the ticked rows. */
export function KwBulkMenu() {
  const { picked, busy, said } = useContext(BulkContext);
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (busy) box.current?.removeAttribute("open");
  }, [busy]);
  useEffect(() => {
    const shut = (e: PointerEvent) => {
      if (box.current?.open && !box.current.contains(e.target as Node)) box.current.removeAttribute("open");
    };
    document.addEventListener("pointerdown", shut);
    return () => document.removeEventListener("pointerdown", shut);
  }, []);
  const op = (value: string, label: string, icon: IconName) => (
    <button type="submit" form={BULK_FORM} name="op" value={value} role="menuitem" disabled={!picked || busy}>
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
  return (
    <div className="dk-seo-kw-bulk">
      {said ? (
        <span className={cx("dk-seo-kw-said", !said.ok && "dk-seo-kw-said--bad")} role={said.ok ? "status" : "alert"}>
          {said.text}
        </span>
      ) : picked ? (
        <span className="dk-seo-kw-said">{picked} ticked</span>
      ) : null}
      <details ref={box} className="dk-seo-kw-menu dk-seo-kw-menu--static">
        <summary className="dk-btn dk-btn--quiet dk-btn--sm" aria-busy={busy}>
          <Icon name={busy ? "refresh" : "list"} size={14} />
          <span className="dk-btn-label">Bulk actions</span>
          <Icon name="chevron-down" size={14} />
        </summary>
        <div className="dk-seo-kw-menu-list" role="menu">
          {op("target", "Mark as targets", "target")}
          {op("untarget", "Remove the targets", "x-circle")}
          {op("relevant", "Judge relevant", "check-circle")}
          {op("weak", "Judge weak", "minus")}
          {op("irrelevant", "Judge irrelevant", "x")}
          {op("export", "Export the ticked (CSV)", "download")}
        </div>
      </details>
    </div>
  );
}

/* ---------- tracking a phrase ------------------------------------------------------------------- */

function TrackForm() {
  const { clusters } = useContext(Kit);
  const { go, busy, message } = useSend();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void go<KeywordChanged>(
      API,
      { phrase: String(f.get("phrase") ?? ""), lang: String(f.get("lang") ?? "") || null, cluster: String(f.get("cluster") ?? "") || null, target: f.get("target") === "on" },
      (v) => v.line,
    );
  };
  return (
    <form className="dk-seo-kw-track" onSubmit={submit}>
      <Field label="The phrase, as people search it">
        <Input name="phrase" required minLength={2} maxLength={120} placeholder="The words people type into Google" autoComplete="off" />
      </Field>
      <div className="dk-seo-kw-track-row">
        <Field label="Language">
          <Select
            name="lang"
            label="Language"
            size="md"
            defaultValue=""
            options={[
              { value: "", label: "Let the desk tell" },
              { value: "de", label: "German" },
              { value: "en", label: "English" },
            ]}
          />
        </Field>
        <Field label="Topic (optional)">
          <Select name="cluster" label="Topic" size="md" defaultValue="" options={[{ value: "", label: "No topic" }, ...clusters.map((c) => ({ value: c.key, label: c.name }))]} />
        </Field>
      </div>
      <label className="dk-seo-kw-track-check">
        <input type="checkbox" name="target" className="dk-check" />
        <span>Mark it as a target</span>
      </label>
      <p className="dk-seo-kw-track-note">
        It is judged relevant by you, also when the table already holds it, and no run or import changes your judgement. A phrase already in the table keeps the topic and language it has. Its impressions, clicks and position appear once Search Console counts the site for it; no figure is shown before then.
      </p>
      {message ? (
        <p className={cx("dk-seo-kw-said", !message.ok && "dk-seo-kw-said--bad")} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      ) : null}
      <DialogActions>
        <DialogClose variant="ghost" size="sm">
          {message?.ok ? "Done" : "Cancel"}
        </DialogClose>
        <Button type="submit" variant="primary" size="sm" icon={busy ? "refresh" : "plus"} disabled={busy} aria-busy={busy}>
          Track it
        </Button>
      </DialogActions>
    </form>
  );
}

/** "Track a phrase": a person adds a search the table does not hold yet. */
export function TrackPhrase() {
  return (
    <Dialog
      title="Track a phrase"
      description="A search the studio wants to be found for. It joins the keyword table as added by you; nothing on the website changes."
      trigger={{ label: "Track a phrase", variant: "quiet", size: "sm", icon: "plus" }}
    >
      <TrackForm />
    </Dialog>
  );
}
