import type { AttentionItem, Range, Reading, SourceId, Tone } from "../../web/src/contract/common.ts";
import type { AttentionPanel, AttentionRuleState } from "../../web/src/contract/overview.ts";
import { status as jobStatus } from "./scheduler.ts";
import { ok, off, reading, series, waiting } from "./store.ts";
import { scrub } from "./system.ts";

/**
 * "Attention required": a row exists only because a stated rule found it.
 *
 * Each rule below says in one sentence what it compares and against what, and
 * every row it makes carries the two figures it compared. Nothing is ranked by
 * a score of ours and nothing is guessed: a rule whose source is not connected
 * says so (state "off" with the step) and produces no rows, never pretend ones.
 *
 * Rules read only what the desk already keeps or the collectors' own cached
 * reads; none of them asks a slow source on its own, and none of them is a
 * person looking (no GA4 read here passes `screen`).
 *
 * The collectors are loaded inside each rule (`import()`), so a collector
 * that fails to load costs its own rules and not the list.
 *
 * Other screens may reuse the list: `RULES` is exported, each rule is run on
 * its own with `rule.find(range)`, and `attention(range)` runs them all.
 */

export type Area = AttentionItem["area"];

export interface AttentionRule {
  /** Stable: "seo.position-drop". Part of every row's id. */
  id: string;
  /** What a person calls it: "Position drop". */
  title: string;
  area: Area;
  source: SourceId;
  /** The rule in one sentence, with its yardstick. Shown beside the full list. */
  rule: string;
  /** The rows it finds now, or why it cannot look. */
  find: (range: Range) => Promise<Reading<AttentionItem[]>>;
}

const site = () => import("./site/index.ts");
const gsc = () => import("./search/gsc.ts");
const leads = () => import("./leads.ts");

/** Where a page's problems are acted on: its detail on the Pages screen (the address src/cc/site uses for search hits). */
const pageHref = (path: string): string => `/pages?open=${encodeURIComponent(path)}`;

const one = (n: number, word: string, many = `${word}s`): string => `${n} ${n === 1 ? word : many}`;
const round1 = (v: number): string => (Math.round(v * 10) / 10).toString();
const ms = (v: number): string => (v >= 1000 ? `${round1(v / 1000)}s` : `${Math.round(v)}ms`);

/* The verb on the button follows the tone, as on the board: a fall is
   investigated, a weakness improved, a rise or a fact viewed. */
const act = (tone: Tone, href: string, label?: string) => ({ label: label ?? (tone === "bad" ? "Investigate" : tone === "warn" ? "Improve" : "View"), href });

/** A rule over the crawl's findings for one of its own rules (src/cc/site/rules.ts). */
function crawlRule(o: {
  id: string;
  title: string;
  area: Area;
  crawlRule: "page.status" | "page.noindex-in-sitemap" | "links.broken" | "title.missing" | "description.missing" | "share.default-picture";
  tone: Tone;
  rule: string;
  text: (f: { measured: number | string | null; limit: number | string | null; related?: string[] }) => string;
  label?: string;
}): AttentionRule {
  return {
    id: o.id,
    title: o.title,
    area: o.area,
    source: "crawl",
    rule: o.rule,
    find: async () => {
      const s = await site();
      const found = s.issues({ rule: o.crawlRule });
      if (found.state !== "ok") return found;
      return ok(
        found.value
          .filter((f) => f.path !== null)
          .map((f) => ({
            id: `${o.id}|${f.path}`,
            subject: f.path as string,
            text: o.text(f),
            area: o.area,
            tone: o.tone,
            action: act(o.tone, pageHref(f.path as string), o.label),
            source: "crawl" as const,
          })),
        "crawl",
        found.asOf,
      );
    },
  };
}

export const RULES: readonly AttentionRule[] = [
  /* ---------- Search Console: off until it is connected ---------- */
  {
    id: "seo.position-drop",
    title: "Position drop",
    area: "SEO",
    source: "gsc",
    rule: "A page whose average position in Google fell by 3 places or more against the window before, shown at least 30 times in both windows (Google's average position, not a tracked rank).",
    find: async (range) => {
      /* The standard floor, named: a rule never reads a list in its early mode (gsc.ts, EARLY). */
      const g = await gsc();
      const r = await g.movers(range, { floor: g.FLOOR.movers });
      if (r.state !== "ok") return r;
      return ok(
        r.value.rows
          .filter((m) => m.kind === "page" && m.path && m.change <= -3)
          .map((m) => ({
            id: `seo.position-drop|${m.path}`,
            subject: m.path as string,
            text: `Average position ${round1(m.previous)} → ${round1(m.current)} in Google`,
            area: "SEO" as const,
            tone: "bad" as const,
            action: act("bad", pageHref(m.path as string)),
            source: "gsc" as const,
          })),
        "gsc",
        r.asOf,
        r.note,
      );
    },
  },
  {
    id: "seo.low-ctr",
    title: "Low click-through",
    area: "SEO",
    source: "gsc",
    rule: "A page whose click-through rate is under half the median of this site's own pages at a similar position, shown at least 50 times. The yardstick is ours: Google publishes no expected CTR.",
    find: async (range) => {
      const g = await gsc();
      const r = await g.ctrOutliers(range, { floor: g.FLOOR.ctr });
      if (r.state !== "ok") return r;
      return ok(
        r.value.rows.map((p) => ({
          id: `seo.low-ctr|${p.path}`,
          subject: p.path,
          text: `CTR ${round1(p.ctr)}% against ${round1(p.median)}%, our median at positions ${p.band}`,
          area: "SEO" as const,
          tone: "warn" as const,
          action: act("warn", pageHref(p.path)),
          source: "gsc" as const,
        })),
        "gsc",
        r.asOf,
        r.note,
      );
    },
  },

  /* ---------- the engine: off until its key exists ---------- */
  {
    id: "conversion.page-enquiries",
    title: "Enquiries from a page changed",
    area: "CONVERSION",
    source: "engine",
    rule: "A page from which enquiries were sent 3 or more times more or fewer than in the window before, and by at least half. Counts only, from the engine.",
    find: async (range) => {
      const r = await (await leads()).byPage(range);
      if (r.state !== "ok") return r;
      return ok(
        r.value
          .filter((g) => g.key !== "" && g.previous !== null)
          .filter((g) => {
            const before = g.previous as number;
            const diff = Math.abs(g.count - before);
            return diff >= 3 && (before === 0 || diff / before >= 0.5);
          })
          .map((g) => {
            const tone: Tone = g.count > (g.previous as number) ? "good" : "warn";
            return {
              id: `conversion.page-enquiries|${g.key}`,
              subject: g.key,
              text: `Enquiries sent from this page ${g.previous} → ${g.count}`,
              area: "CONVERSION" as const,
              tone,
              action: act(tone, "/conversions", "View"),
              source: "engine" as const,
            };
          }),
        "engine",
        r.asOf,
        r.note,
      );
    },
  },

  /* ---------- the desk's own crawl ---------- */
  crawlRule({
    id: "health.page-status",
    title: "Page does not answer 200",
    area: "HEALTH",
    crawlRule: "page.status",
    tone: "bad",
    rule: "A page in the sitemap or the website's page files that answered anything but 200 at the last crawl.",
    text: (f) => (f.measured === 0 ? "Did not answer at the last crawl; it should answer 200" : `Answers ${f.measured}, not 200`),
  }),
  crawlRule({
    id: "seo.noindex-in-sitemap",
    title: "Noindex in the sitemap",
    area: "SEO",
    crawlRule: "page.noindex-in-sitemap",
    tone: "bad",
    rule: "A page the sitemap offers to search engines that says noindex.",
    text: () => "Listed in the sitemap, but says noindex",
  }),
  crawlRule({
    id: "health.broken-links",
    title: "Broken internal links",
    area: "HEALTH",
    crawlRule: "links.broken",
    tone: "bad",
    rule: "A page that links to an address on the site that did not answer at the last crawl.",
    text: (f) => `Links to ${one(Number(f.measured) || 0, "address", "addresses")} that ${Number(f.measured) === 1 ? "does" : "do"} not answer${f.related?.length ? `: ${f.related.slice(0, 2).join(", ")}` : ""}`,
    label: "Fix",
  }),
  crawlRule({
    id: "pages.missing-title",
    title: "Missing title",
    area: "PAGES",
    crawlRule: "title.missing",
    tone: "bad",
    rule: "A page in the sitemap with no <title>.",
    text: () => "Has no title tag",
    label: "Fix",
  }),
  crawlRule({
    id: "pages.missing-description",
    title: "Missing description",
    area: "PAGES",
    crawlRule: "description.missing",
    tone: "warn",
    rule: "A page in the sitemap with no meta description.",
    text: () => "Has no meta description",
    label: "Fix",
  }),
  crawlRule({
    id: "content.default-share",
    title: "Default share picture",
    area: "CONTENT",
    crawlRule: "share.default-picture",
    tone: "quiet",
    rule: "A page that is shared with the website's default picture because it has none of its own.",
    text: () => "Shared with the site's default picture",
  }),

  /* ---------- the desk's own probes ---------- */
  {
    id: "health.incident",
    title: "Site not answering",
    area: "HEALTH",
    source: "probe",
    rule: "An open incident: the home page failed two checks in a row from the desk's server and has not answered since.",
    find: async () => {
      const r = (await site()).incidents("30d");
      if (r.state !== "ok") return r;
      return ok(
        r.value
          .filter((i) => i.ended === null)
          .map((i) => ({
            id: `health.incident|${i.id}`,
            subject: "/",
            text: `Not answering for ${one(i.minutes, "minute")}: ${scrub(i.cause).slice(0, 90)}`,
            area: "HEALTH" as const,
            tone: "bad" as const,
            action: act("bad", "/site-health"),
            source: "probe" as const,
          })),
        "probe",
        r.asOf,
        r.note,
      );
    },
  },

  /* ---------- the desk's own scheduler ---------- */
  {
    id: "health.job-failed",
    title: "A scheduled job failed",
    area: "HEALTH",
    source: "desk",
    rule: "A scheduled job that is connected and switched on, and whose last run failed.",
    find: async () =>
      ok(
        jobStatus()
          .filter((j) => j.ready && j.enabled && j.lastOk === false)
          .map((j) => ({
            id: `health.job-failed|${j.name}`,
            subject: j.title,
            text: `Failed ${j.fails} of ${one(j.runs, "run")}; the last said: ${scrub(j.lastNote ?? "nothing").slice(0, 90)}`,
            area: "HEALTH" as const,
            tone: "warn" as const,
            action: act("warn", "/automations", "View"),
            source: "desk" as const,
          })),
        "desk",
        new Date().toISOString(),
      ),
  },

  /* ---------- PageSpeed's lab runs ---------- */
  {
    id: "health.speed-regression",
    title: "Lab speed regression",
    area: "HEALTH",
    source: "psi",
    rule: "A tested page whose lab Largest Contentful Paint (mobile) is at least 20% and 300 ms slower than at the run before, or whose lab layout shift grew by 0.05 or more to above 0.1. Lab: one Lighthouse load, not a visitor.",
    find: async () => {
      const r = (await site()).labRuns("mobile");
      if (r.state !== "ok") return r;
      const rows: AttentionItem[] = [];
      for (const run of r.value) {
        const lcp = series(`speed.mobile.lcp:${run.path}`, 60).slice(-2);
        if (lcp.length === 2) {
          const [before, now] = [lcp[0]!.value, lcp[1]!.value];
          if (now - before >= 300 && now >= before * 1.2) {
            rows.push({
              id: `health.speed-regression|lcp|${run.path}`,
              subject: run.path,
              text: `Lab LCP ${ms(before)} → ${ms(now)} on mobile, against the run before`,
              area: "HEALTH",
              tone: "warn",
              action: act("warn", "/site-health"),
              source: "psi",
            });
          }
        }
        const cls = series(`speed.mobile.cls:${run.path}`, 60).slice(-2);
        if (cls.length === 2) {
          const [before, now] = [cls[0]!.value, cls[1]!.value];
          if (now - before >= 0.05 && now > 0.1) {
            rows.push({
              id: `health.speed-regression|cls|${run.path}`,
              subject: run.path,
              text: `Lab layout shift ${before.toFixed(2)} → ${now.toFixed(2)} on mobile, against the run before`,
              area: "HEALTH",
              tone: "warn",
              action: act("warn", "/site-health"),
              source: "psi",
            });
          }
        }
      }
      return ok(rows, "psi", r.asOf, r.note);
    },
  },
];

/** Worst first: what is broken, then what is weak, then good news, then housekeeping. */
const RANK: Record<Tone, number> = { bad: 0, warn: 1, good: 2, info: 3, quiet: 4 };

/**
 * Every rule run on its own, its rows together, worst first.
 *
 * `replace` swaps one rule's finding for another (by rule id): the dev copy's
 * ?specimen=1 feeds the rules whose source is not connected yet from rows the
 * route keeps in its own file. Nothing else passes it.
 */
export async function attention(range: Range, o: { replace?: Record<string, () => Reading<AttentionItem[]>> } = {}): Promise<Reading<AttentionPanel>> {
  const found = await Promise.all(
    RULES.map(async (rule) => {
      const swap = o.replace?.[rule.id];
      const got = swap ? swap() : await reading<AttentionItem[]>(rule.source, () => rule.find(range));
      return { rule, got };
    }),
  );

  const items = found
    .flatMap(({ got }) => (got.state === "ok" ? got.value : []))
    .sort((a, b) => RANK[a.tone] - RANK[b.tone] || a.area.localeCompare(b.area) || a.subject.localeCompare(b.subject));

  const rules: AttentionRuleState[] = found.map(({ rule, got }) => ({
    id: rule.id,
    title: rule.title,
    area: rule.area,
    source: rule.source,
    rule: rule.rule,
    state: got.state,
    found: got.state === "ok" ? got.value.length : 0,
    ...(got.state !== "ok" ? { reason: got.reason } : {}),
    ...(got.state === "off" && got.step ? { step: got.step } : {}),
  }));

  const ran = rules.filter((r) => r.state === "ok");
  if (!ran.length) {
    /* Not one rule could look: the list is not empty, it is unknown. */
    const first = found[0]?.got;
    return first && first.state !== "ok" ? waiting("desk", "No rule could look yet: the crawl, the probes and the other sources have not answered.") : off("desk", "No rule is defined.");
  }
  return ok({ items, total: items.length, rules }, "desk", new Date().toISOString(), `${ran.length} of ${rules.length} rules could look. A row exists only because a stated rule found it.`);
}
