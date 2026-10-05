"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Me, SystemStatus } from "@/contract/common";
import { ago } from "@/lib/format";
import { useLive } from "@/lib/live";
import { Avatar } from "@/components/ui/Avatar";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { StatusDot } from "@/components/ui/StatusDot";
import { CommandPalette } from "./CommandPalette";
import { mayOpen, type PageAccess } from "./nav";
import { MenuButton } from "./NavDrawer";
import { Popover } from "./Popover";
import { ThemeToggle } from "./ThemeToggle";
import "./topbar.css";

/* How often the light asks the server how things are. */
const EVERY = 60_000;

export interface TopBarProps {
  me: Me;
  /** The status as the server gave it when the frame was drawn, or null when it gave none. */
  system: SystemStatus | null;
}

/**
 * The frame's top bar: search (which opens the command palette), the status
 * light with its checks, the bell with its notices, and the person's menu.
 *
 * The light is the server's judgement, never this component's: it is green
 * only when `SystemStatus.ok` says nothing is failing AND `checked` says
 * something was looked at. Over nothing checked, or when the server has not
 * reported, it is grey and says so, rather than assuming all is well.
 *
 * Its panels link only to pages this person may open (`Me.access.pages`): the
 * status keeps its lines and a notice its text, without a link that would
 * end at a refusal.
 */
export function TopBar({ me, system }: TopBarProps) {
  const [palette, setPalette] = useState(false);
  /* The chip shows the key this machine has; until the browser says, the wider one. */
  const [mac, setMac] = useState(false);
  const live = useLive<SystemStatus>("/api/v1/system", EVERY, system);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return (
    <header className="dk-top">
      <MenuButton />

      <button type="button" className="dk-search" onClick={() => setPalette(true)} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K">
        <Icon name="search" size={16} />
        <span className="dk-search-text">Search pages, insights, keywords, leads…</span>
        <kbd className="dk-kbd dk-search-kbd">{mac ? "⌘ K" : "Ctrl K"}</kbd>
      </button>

      <div className="dk-top-right">
        <StatusLight status={live.data} problem={live.error} pages={me.access?.pages} />
        <span className="dk-top-sep" aria-hidden />
        <Notices status={live.data} pages={me.access?.pages} />
        <ThemeToggle />
        <span className="dk-top-sep" aria-hidden />
        <PersonMenu me={me} />
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} pages={me.access?.pages} />
    </header>
  );
}

function StatusLight({ status, problem, pages }: { status: SystemStatus | null; problem: string | null; pages: PageAccess | undefined }) {
  /* `ok` only says nothing is failing. Over nothing checked it vouches for
     nothing, so the light is then grey, neither green nor red. */
  const vouches = status !== null && status.checked > 0;
  const tone = !status || !vouches ? "quiet" : status.ok ? "good" : "bad";
  const line = status ? status.line : "Status not reported";
  const checks = status ? [...status.checks].sort((a, b) => Number(a.ok) - Number(b.ok)) : [];
  const failing = status ? status.sources.filter((s) => s.state === "failing") : [];
  const health = mayOpen(pages, "/site-health");
  const sources = mayOpen(pages, "/settings");

  return (
    <Popover
      title="System status"
      buttonClass="dk-status"
      panelClass="dk-pop-panel--status"
      button={
        <>
          <StatusDot tone={tone} pulse={vouches && status.ok} title={line} />
          <span className="dk-status-line">{line}</span>
        </>
      }
    >
      <p className="dk-pop-title">{line}</p>

      {!status ? (
        <p className="dk-pop-note">
          The desk server gave no status{problem ? `: ${problem}` : "."} Nothing is assumed to be well or unwell until it does.
        </p>
      ) : !vouches ? (
        <>
          <p className="dk-pop-note">No check has reported yet, so the light is neither green nor red. It vouches only for what is checked.</p>
          {checks.length > 0 ? <CheckList checks={checks} /> : null}
        </>
      ) : (
        <CheckList checks={checks} />
      )}

      {failing.length > 0 ? (
        <>
          <p className="dk-pop-group">Sources that are failing</p>
          <ul className="dk-checks">
            {failing.map((s) => (
              <li key={s.id + s.name} className="dk-check-row">
                <StatusDot tone="bad" title="Failing" />
                <span className="dk-check-name">{s.name}</span>
                <span className="dk-check-detail">{s.error ?? "No answer."}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {status && problem ? <p className="dk-pop-note">Could not refresh just now: {problem}</p> : null}

      {health || sources ? (
        <div className="dk-pop-links">
          {health ? (
            <Link href="/site-health" prefetch={false}>
              Site Health
            </Link>
          ) : null}
          {sources ? (
            <Link href="/settings" prefetch={false}>
              Sources
            </Link>
          ) : null}
        </div>
      ) : null}
    </Popover>
  );
}

/* Each check the server listed, failing first (the caller sorts). */
function CheckList({ checks }: { checks: SystemStatus["checks"] }) {
  return (
    <ul className="dk-checks">
      {checks.map((c) => (
        <li key={c.name} className="dk-check-row">
          <StatusDot tone={c.ok ? "good" : "bad"} title={c.ok ? "Passing" : "Failing"} />
          <span className="dk-check-name">{c.name}</span>
          <span className="dk-check-detail">{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/*
 * Where this browser keeps the time (ms) of the newest notice it has shown.
 * A time, not an id: ids are not in the order things happened (a row written
 * later about something earlier gets a higher id), and `at` is.
 */
const SEEN = "dk-notices-seen-at";

/** A notice's moment in ms, or 0 for one whose time cannot be read (never counted as new). */
const when = (a: { at: string }): number => {
  const t = Date.parse(a.at);
  return Number.isFinite(t) ? t : 0;
};

/**
 * The bell. The server sends the latest things that happened; which of them
 * this person has not looked at yet is known only here, so the count is the
 * notices that happened after the newest one this browser has shown in the
 * panel. A browser that has never shown the panel starts from what is there
 * now: what had already happened before it first looked is not news, so a
 * first visit shows no count. Where the browser cannot remember (storage
 * refused), there is no count at all: a number on a bell must never be a guess.
 */
function Notices({ status, pages }: { status: SystemStatus | null; pages: PageAccess | undefined }) {
  const notices = status?.notices ?? [];
  /* The newest moment already shown, or null while it is not known. */
  const [seen, setSeen] = useState<number | null>(null);
  /* What had been seen when the panel last opened: the rows after it are marked. */
  const [shownFrom, setShownFrom] = useState<number | null>(null);

  const newest = notices.reduce((m, a) => Math.max(m, when(a)), 0);
  const listed = status !== null;

  useEffect(() => {
    if (seen !== null || !listed) return;
    try {
      const kept = localStorage.getItem(SEEN);
      const at = kept === null || kept === "" ? NaN : Number(kept);
      if (Number.isFinite(at)) {
        setSeen(at);
      } else {
        /* The first time this browser sees the bell. */
        localStorage.setItem(SEEN, String(newest));
        setSeen(newest);
      }
    } catch {
      /* Storage refused (a locked-down profile): no count, rather than a wrong one. */
    }
  }, [seen, listed, newest]);

  const n = seen === null ? 0 : notices.filter((a) => when(a) > seen).length;

  const look = () => {
    setShownFrom(seen);
    if (seen === null || newest <= seen) return;
    setSeen(newest);
    try {
      localStorage.setItem(SEEN, String(newest));
    } catch {
      /* Storage refused after all: the count starts again next time. */
    }
  };

  return (
    <Popover
      title="Notices"
      label={n === 0 ? "Notices" : `Notices, ${n} new`}
      buttonClass="dk-top-icon"
      panelClass="dk-pop-panel--notices"
      onOpen={look}
      button={
        <>
          <Icon name="bell" size={20} />
          {n > 0 ? <span className="dk-bell-count dk-num">{n > 9 ? "9+" : n}</span> : null}
        </>
      }
    >
      <p className="dk-pop-title">Notices</p>
      {!status ? (
        <p className="dk-pop-note">The desk server gave no status, so there is nothing to list.</p>
      ) : notices.length === 0 ? (
        <p className="dk-pop-note">Nothing has happened yet.</p>
      ) : (
        <ul className="dk-notices">
          {notices.map((a) => {
            const fresh = shownFrom !== null && when(a) > shownFrom;
            const body = (
              <>
                <StatusDot tone={a.tone} title={a.kind} />
                <span className="dk-notice-text">
                  <span className={fresh ? "dk-notice-new" : undefined}>
                    {a.text}
                    {fresh ? <span className="dk-sr"> (new)</span> : null}
                  </span>
                  {a.detail ? <span className="dk-notice-detail">{a.detail}</span> : null}
                </span>
                <time className="dk-notice-time" dateTime={a.at} suppressHydrationWarning>
                  {ago(a.at)}
                </time>
              </>
            );
            return (
              <li key={a.id}>
                {a.href && mayOpen(pages, a.href) ? (
                  <Go href={a.href} className="dk-notice dk-notice--link">
                    {body}
                  </Go>
                ) : (
                  <div className="dk-notice">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Popover>
  );
}

function PersonMenu({ me }: { me: Me }) {
  return (
    <Popover
      title="Your account"
      buttonClass="dk-person"
      panelClass="dk-pop-panel--menu"
      button={
        <>
          <Avatar name={me.name} />
          <span className="dk-person-name">{me.name}</span>
          <Icon name="chevron-down" size={14} />
        </>
      }
    >
      <div className="dk-menu-who">
        <span className="dk-menu-name">{me.name}</span>
        {me.email ? <span className="dk-menu-mail">{me.email}</span> : null}
      </div>
      {mayOpen(me.access?.pages, "/settings") ? (
        <Link href="/settings" prefetch={false} className="dk-menu-row">
          <Icon name="settings" size={16} />
          Settings
        </Link>
      ) : null}
      {me.owner ? (
        <Link href="/team" prefetch={false} className="dk-menu-row">
          <Icon name="users" size={16} />
          Team activity
        </Link>
      ) : null}
      {/* The classic console is drawn by the desk server, not by this app: a plain link. */}
      {mayOpen(me.access?.pages, "/content") ? (
        <a href="/console" className="dk-menu-row">
          <Icon name="terminal" size={16} />
          Classic console
        </a>
      ) : null}
      <form method="post" action="/logout" className="dk-menu-form">
        <button type="submit" className="dk-menu-row">
          <Icon name="logout" size={16} />
          Sign out
        </button>
      </form>
    </Popover>
  );
}
