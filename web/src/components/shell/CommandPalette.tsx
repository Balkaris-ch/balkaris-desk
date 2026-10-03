"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "@/contract/common";
import { cx } from "@/lib/cx";
import { hrefKind } from "@/lib/href";
import { Icon, type IconName } from "@/components/ui/icons";
import { mayOpen, visibleSections, type PageAccess } from "./nav";
import "./palette.css";

interface Entry {
  kind: SearchHit["kind"];
  title: string;
  sub?: string;
  href: string;
  icon: IconName;
}

const KIND: Record<SearchHit["kind"], { group: string; icon: IconName }> = {
  section: { group: "Go to", icon: "arrow-right" },
  page: { group: "Pages", icon: "pages" },
  insight: { group: "Insights", icon: "article" },
  keyword: { group: "Keywords", icon: "search" },
  lead: { group: "Leads", icon: "inbox" },
  asset: { group: "Assets", icon: "image" },
};
const ORDER: SearchHit["kind"][] = ["section", "page", "insight", "keyword", "lead", "asset"];

/* The server is asked once typing pauses, and never for a single letter. */
const PAUSE = 180;
const MIN = 2;
/* Search is answered by the desk server from what it holds; past this it is stuck, not slow. */
const PATIENCE = 10_000;

/**
 * The command palette: Ctrl/⌘K, or a click on the top bar's search field.
 *
 * The sections this person may open are always offered and are matched
 * here, so the palette is useful with the server down. From two letters on it also asks
 * `/api/v1/search?q=` for pages, insights, keywords, leads and assets, and
 * lists what comes back under its kind. When that fails it says so in one
 * line and keeps the sections.
 *
 * Arrows move, Enter opens, Escape closes.
 */
export function CommandPalette({ open, onClose, pages }: { open: boolean; onClose: () => void; pages?: PageAccess | null }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [state, setState] = useState<"idle" | "asking" | "failed" | "late">("idle");
  const [at, setAt] = useState(0);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      input.current?.focus();
    }
    if (!open && d.open) d.close();
    if (!open) {
      setQ("");
      setHits([]);
      setState("idle");
      setAt(0);
    }
  }, [open]);

  const term = q.trim();

  useEffect(() => {
    if (!open || term.length < MIN) {
      setHits([]);
      setState("idle");
      return;
    }
    const abort = new AbortController();
    let late = false;
    let cutoff: ReturnType<typeof setTimeout> | undefined;
    setState("asking");
    const timer = setTimeout(async () => {
      /* A server that never answers must not leave "Searching…" up for minutes. */
      cutoff = setTimeout(() => {
        late = true;
        abort.abort();
      }, PATIENCE);
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(term)}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: abort.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const json: unknown = await res.json();
        if (abort.signal.aborted) throw new Error("stopped");
        setHits(Array.isArray(json) ? json.filter(isHit).slice(0, 30) : []);
        setState("idle");
      } catch {
        /* Aborted by a newer term or by closing: that one speaks for itself. */
        if (abort.signal.aborted && !late) return;
        setHits([]);
        setState(late ? "late" : "failed");
      } finally {
        clearTimeout(cutoff);
      }
    }, PAUSE);
    return () => {
      clearTimeout(timer);
      clearTimeout(cutoff);
      abort.abort();
    };
  }, [open, term]);

  const entries = useMemo<Entry[]>(() => {
    const needle = term.toLowerCase();
    const shown = visibleSections(pages);
    const sections: Entry[] = shown.filter((s) => !needle || s.label.toLowerCase().includes(needle) || s.hint.toLowerCase().includes(needle)).map((s) => ({
      kind: "section",
      title: s.label,
      sub: s.hint,
      href: s.href,
      icon: s.icon,
    }));
    /* A section's own pages (SEO's eleven, nav.ts) once something is typed: by
       name ("keywords"), or by section and name ("seo key"); the section's
       name alone lists only the section. */
    const asked = needle.trim().replace(/\s+/g, " ");
    if (asked) {
      for (const s of shown) {
        const own = s.label.toLowerCase();
        for (const c of s.children ?? []) {
          const name = c.label.toLowerCase();
          if (name.includes(asked) || (asked.length > own.length && `${own} ${name}`.includes(asked))) {
            sections.push({ kind: "section", title: c.label, sub: `${s.label} · ${c.hint}`, href: c.href, icon: c.icon });
          }
        }
      }
    }
    const found: Entry[] = hits
      /* The server may offer sections too; ours are already listed. */
      .filter((h) => h.kind !== "section" && mayOpen(pages, h.href))
      .map((h) => ({ ...h, icon: KIND[h.kind].icon }));
    return [...sections, ...found].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  }, [term, hits, pages]);

  /* The marked row never points past the end of a list that just got shorter. */
  const marked = Math.min(at, Math.max(0, entries.length - 1));

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [marked, entries]);

  const go = (e: Entry) => {
    onClose();
    const kind = hrefKind(e.href);
    if (kind === "app") router.push(e.href);
    else if (kind === "server") window.location.assign(e.href);
    else window.open(e.href, "_blank", "noreferrer");
  };

  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt(entries.length ? (marked + 1) % entries.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt(entries.length ? (marked - 1 + entries.length) % entries.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = entries[marked];
      if (pick) go(pick);
    }
  };

  let group = "";

  return (
    <dialog
      ref={dialog}
      className="dk-palette"
      aria-label="Search and go to"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open ? (
        <div className="dk-palette-panel" onKeyDown={key}>
          <div className="dk-palette-field">
            <Icon name="search" size={18} />
            <input
              ref={input}
              type="text"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setAt(0);
              }}
              placeholder="Search pages, insights, keywords, leads…"
              aria-label="Search"
              role="combobox"
              aria-expanded
              aria-controls="dk-palette-list"
              aria-activedescendant={entries.length ? `dk-palette-${marked}` : undefined}
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="dk-kbd">Esc</kbd>
          </div>

          <div className="dk-palette-list" id="dk-palette-list" role="listbox" aria-label="Results" ref={list}>
            {entries.map((e, i) => {
              const head = KIND[e.kind].group !== group ? (group = KIND[e.kind].group) : null;
              return (
                <div key={`${e.kind}:${e.href}:${e.title}`} role="presentation">
                  {head ? <p className="dk-palette-group">{head}</p> : null}
                  <div
                    id={`dk-palette-${i}`}
                    role="option"
                    aria-selected={i === marked}
                    className={cx("dk-palette-row", i === marked && "dk-palette-row--on")}
                    onPointerMove={() => i !== marked && setAt(i)}
                    onClick={() => go(e)}
                  >
                    <Icon name={e.icon} size={16} />
                    <span className="dk-palette-title">{e.title}</span>
                    {e.sub ? <span className="dk-palette-sub">{e.sub}</span> : null}
                    <Icon name="arrow-right" size={14} className="dk-palette-go" />
                  </div>
                </div>
              );
            })}

            {state === "failed" ? (
              <p className="dk-palette-note">Search is not answering just now. The sections can still be opened from here.</p>
            ) : state === "late" ? (
              <p className="dk-palette-note">Search took too long to answer. The sections can still be opened from here.</p>
            ) : term.length >= MIN && state === "idle" && entries.length === 0 ? (
              <p className="dk-palette-note">Nothing found for “{term}”.</p>
            ) : state === "asking" && entries.length === 0 ? (
              <p className="dk-palette-note">Searching…</p>
            ) : null}
          </div>

          <p className="dk-palette-foot" aria-hidden>
            <span>
              <kbd className="dk-kbd">↑</kbd>
              <kbd className="dk-kbd">↓</kbd> move
            </span>
            <span>
              <kbd className="dk-kbd">Enter</kbd> open
            </span>
          </p>
        </div>
      ) : null}
    </dialog>
  );
}

function isHit(v: unknown): v is SearchHit {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Partial<SearchHit>;
  return typeof h.title === "string" && typeof h.href === "string" && typeof h.kind === "string" && h.kind in KIND;
}
