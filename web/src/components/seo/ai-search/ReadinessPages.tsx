"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import type { PageReadiness, PageReadinessAnswer, PageReadinessRow, ReadinessCheck, ReadinessTally } from "@/contract/seo/ai-search";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { fullDate, num } from "@/lib/format";
import { CHECK_STATE, WHO_FIX } from "./look";
import "@/components/ui/table.css";
import "./ai-search.css";

/** Short heads for the check columns, in the checks' own order. */
const SHORT: Record<string, string> = {
  answer: "Answer",
  faq: "FAQ",
  "faq-schema": "FAQ data",
  org: "Who, where",
  price: "Price",
  timeline: "Time",
  german: "German",
  updated: "Date",
};

/** The filter's words for the pages that fail a check. */
const FAILING: Record<string, string> = {
  answer: "No direct answer",
  faq: "No questions",
  "faq-schema": "FAQ not in data",
  org: "Not who and where",
  price: "No price",
  timeline: "No timeline",
  german: "No German",
  updated: "No date",
};

const SHOWN = 12;

function Cell({ state, label }: { state: ReadinessCheck["state"] | undefined; label: string }) {
  if (!state || state === "n/a")
    return (
      <span className="dk-seo-ai-search-cell dk-seo-ai-search-cell--none" title={`${label}: does not apply to this kind of page`}>
        ·
      </span>
    );
  const icon = state === "pass" ? "check" : state === "fail" ? "x" : "help";
  const tone = state === "pass" ? "good" : state === "fail" ? "bad" : "warn";
  return (
    <span className={cx("dk-seo-ai-search-cell", `dk-tone-${tone}`)} title={`${label}: ${CHECK_STATE[state].word.toLowerCase()}`}>
      <Icon name={icon} size={14} />
      <span className="dk-sr">
        {label}: {CHECK_STATE[state].word.toLowerCase()}.
      </span>
    </span>
  );
}

type Got = { state: "asking" } | { state: "ok"; page: PageReadiness; checkedAt: string | null } | { state: "none" } | { state: "failed"; why: string };

/** What each check read on one page, asked of the desk when its row opens (GET /api/v1/seo/ai-search/page). */
function PageDetail({ got }: { got: Got | undefined }) {
  if (!got || got.state === "asking") return <p className="dk-seo-ai-search-quiet">Reading what each check found on this page…</p>;
  if (got.state === "failed") return <p className="dk-seo-ai-search-quiet">{got.why}</p>;
  if (got.state === "none") return <p className="dk-seo-ai-search-quiet">The readiness check has no read of this page any more: it left the sitemap, or the next read has not reached it.</p>;
  return (
    <>
      <ul className="dk-seo-ai-search-checks dk-seo-ai-search-page-checks">
        {got.page.checks.map((c) => {
          const s = CHECK_STATE[c.state];
          return (
            <li key={c.key} className="dk-seo-ai-search-check">
              <span className={cx("dk-seo-ai-search-check-mark", `dk-tone-${s.tone}`)} title={s.word}>
                <Icon name={s.icon} size={16} />
                <span className="dk-sr">{s.word}: </span>
              </span>
              <div className="dk-seo-ai-search-check-text">
                <p className="dk-seo-ai-search-strong">{c.label}</p>
                <p className="dk-seo-ai-search-quiet">{c.detail}</p>
                {c.fix ? (
                  <p className="dk-seo-ai-search-check-fix">
                    <Icon name="arrow-right" size={12} />
                    <span>{c.fix}</span>
                  </p>
                ) : null}
              </div>
              {c.who && c.state === "fail" ? <Chip tone={WHO_FIX[c.who].tone}>{WHO_FIX[c.who].word}</Chip> : null}
            </li>
          );
        })}
      </ul>
      <p className="dk-seo-ai-search-quiet dk-seo-ai-search-page-checks-foot">
        {got.checkedAt ? `Read ${fullDate(got.checkedAt)}. ` : ""}
        <Link href={`/seo/pages/view?path=${encodeURIComponent(got.page.path)}`} prefetch={false} className="dk-seo-ai-search-link">
          Open in Page Optimization
        </Link>
      </p>
    </>
  );
}

/**
 * Every checked page with its checks, the least ready first. A filter shows
 * the pages that fail one check; a row opens what each check read on that
 * page (asked of the desk when it opens, so the page carries only the
 * marks); the address opens Page Optimization.
 */
export function ReadinessPages({ pages, checks, checkedAt }: { pages: PageReadinessRow[]; checks: ReadinessTally[]; checkedAt: string }) {
  const [failing, setFailing] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [got, setGot] = useState<Record<string, Got>>({});
  const keys = checks.map((c) => c.key);
  const labelOf = (k: string) => checks.find((c) => c.key === k)?.label ?? k;

  const rows = useMemo(() => {
    const list = failing ? pages.filter((p) => p.states[failing] === "fail") : pages.filter((p) => p.of > 0);
    return [...list].sort((a, b) => b.of - b.pass - (a.of - a.pass) || b.of - a.of || a.path.localeCompare(b.path));
  }, [pages, failing]);
  const shown = all ? rows : rows.slice(0, SHOWN);

  const toggle = async (path: string) => {
    if (opened === path) {
      setOpened(null);
      return;
    }
    setOpened(path);
    if (got[path] && got[path].state !== "failed") return;
    setGot((g) => ({ ...g, [path]: { state: "asking" } }));
    let next: Got;
    try {
      const res = await fetch(`/api/v1/seo/ai-search/page?path=${encodeURIComponent(path)}`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      const json = (await res.json().catch(() => null)) as (PageReadinessAnswer & { error?: string }) | null;
      if (!res.ok || !json) next = { state: "failed", why: json?.error ?? `The desk server answered ${res.status}.` };
      else next = json.page ? { state: "ok", page: json.page, checkedAt: json.checkedAt } : { state: "none" };
    } catch {
      next = { state: "failed", why: "The desk server is not answering." };
    }
    setGot((g) => ({ ...g, [path]: next }));
  };

  return (
    <Card
      title="Pages and their readiness"
      icon="pages"
      flush
      className="dk-seo-ai-search-panel"
      info="Every sitemap page the readiness check read, the pages with the most failing checks first. Open a row to see what each check read on that page and the step that fixes it; a dot means the check does not apply to that kind of page. The address opens Page Optimization."
      sub={`${num(pages.length)} pages read, ${fullDate(checkedAt)} · ${failing ? `${num(rows.length)} fail “${labelOf(failing)}”` : "every check"}`}
    >
      <div className="dk-seo-ai-search-filters dk-seo-ai-search-pad-x" role="group" aria-label="Show pages that fail one check">
        <button type="button" className={cx("dk-seo-ai-search-filter", failing === null && "dk-seo-ai-search-filter--on")} aria-pressed={failing === null} onClick={() => setFailing(null)}>
          All pages
        </button>
        {checks
          .filter((c) => c.fail > 0)
          .map((c) => (
            <button key={c.key} type="button" className={cx("dk-seo-ai-search-filter", failing === c.key && "dk-seo-ai-search-filter--on")} aria-pressed={failing === c.key} onClick={() => setFailing(c.key)}>
              {FAILING[c.key] ?? `Fails: ${c.label}`}
              <span className="dk-num dk-seo-ai-search-filter-n">{num(c.fail)}</span>
            </button>
          ))}
      </div>
      <div className="dk-table-wrap">
        <table className="dk-table dk-table--dense dk-table--caps dk-seo-ai-search-pages">
          <caption className="dk-sr">Pages and their AI readiness checks, checked {checkedAt.slice(0, 10)}</caption>
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">Kind</th>
              {keys.map((k) => (
                <th key={k} scope="col" className="dk-table-center">
                  {SHORT[k] ?? k}
                </th>
              ))}
              <th scope="col" className="dk-table-right">
                Pass
              </th>
              <th scope="col">
                <span className="dk-sr">Open what each check read</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const isOpen = opened === p.path;
              return (
                <Fragment key={p.path}>
                  <tr className={cx(isOpen && "dk-table-picked")}>
                    <td className="dk-seo-ai-search-page">
                      <Link href={`/seo/pages/view?path=${encodeURIComponent(p.path)}`} prefetch={false} className="dk-seo-ai-search-page-link">
                        <span className="dk-seo-ai-search-page-title">{p.title ?? p.path}</span>
                        <span className="dk-seo-ai-search-quiet">{p.path}</span>
                      </Link>
                    </td>
                    <td className="dk-seo-ai-search-quiet">
                      {p.kind ?? "—"}
                      {p.lang ? ` · ${p.lang.toUpperCase()}` : ""}
                    </td>
                    {keys.map((k) => (
                      <td key={k} className="dk-table-center">
                        <Cell state={p.states[k]} label={labelOf(k)} />
                      </td>
                    ))}
                    <td className={cx("dk-table-right", "dk-num", p.pass === p.of ? "dk-seo-ai-search-good" : p.pass === 0 ? "dk-seo-ai-search-bad" : undefined)}>
                      {num(p.pass)} <span className="dk-seo-ai-search-quiet">of {num(p.of)}</span>
                    </td>
                    <td className="dk-seo-ai-search-page-open">
                      <button type="button" className="dk-seo-ai-search-page-toggle" aria-expanded={isOpen} aria-label={`${isOpen ? "Close" : "Open"} what each check read on ${p.path}`} onClick={() => void toggle(p.path)}>
                        <Icon name={isOpen ? "chevron-up" : "chevron-down"} size={14} />
                      </button>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="dk-seo-ai-search-page-more">
                      <td colSpan={keys.length + 4}>
                        <div className="dk-seo-ai-search-page-detail" aria-live="polite">
                          <PageDetail got={got[p.path]} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!rows.length ? (
              <tr className="dk-table-none">
                <td colSpan={keys.length + 4}>No page fails this check.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN ? (
        <button type="button" className="dk-seo-ai-search-more" onClick={() => setAll((x) => !x)}>
          {all ? "Show fewer" : `Show all ${num(rows.length)} pages`}
          <Icon name={all ? "chevron-up" : "chevron-down"} size={14} />
        </button>
      ) : null}
    </Card>
  );
}
