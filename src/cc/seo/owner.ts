import { createHash } from "node:crypto";
import { db } from "../../db.ts";
import { note } from "../store.ts";
import type { OwnerTaskRow, Priority } from "../../../web/src/contract/seo/common.ts";
import { now } from "./tables.ts";

/**
 * "NEEDS YOU": what only the owner can do, and what the lead does by hand in
 * the owner's browser.
 *
 * Seeded from the SEO audit's actions (scripts/seo-import.ts): those it marked
 * "owner login" become owner tasks; the Search Console steps no API offers
 * (Request indexing, Validate fix, the Generative AI export) become the
 * lead's ("lead-chrome"). The audit's website-code and content actions are
 * kept here too ("code", "content") so the opportunity engine can carry them,
 * but they are not shown as "Needs you".
 *
 * DONE IS A PERSON'S MARK. Nothing the desk reads ever marks a task done: a
 * Business Profile that appears in the next check is evidence, shown beside
 * the task, and the owner still says it is done.
 *
 * ONE TASK PER TOPIC. The audit said several things twice (a measured pass and
 * a verified pass, and across sections). Each action is filed under a topic by
 * the patterns below, and one topic is one task: the verified wording wins.
 */

export type Who = "owner" | "lead-chrome" | "code" | "content";

/** Topics, in the order they are tried: the first pattern that matches files the action. Only words, no figures. */
export const TOPICS: [string, RegExp][] = [
  ["nap-decision", /one true name, address and phone/i],
  ["gsc-validate-noindex", /validate fix/i],
  ["gsc-request-indexing", /request indexing/i],
  ["gsc-sitemaps-feed", /feed\.xml/i],
  ["gsc-generative-ai", /generative ai/i],
  ["bing-webmaster", /bing webmaster/i],
  ["business-profile", /google business profile|business\.google\.com/i],
  ["linkedin", /linkedin company page|linkedin\.com\/company|^linkedin,/i],
  ["local-listings", /local\.ch and search\.ch|local\.ch\/search\.ch entry/i],
  ["commercial-register", /commercial register|easygov/i],
  ["bing-places-apple", /bing places|apple business|apple maps/i],
  ["directories", /clutch|goodfirms|designrush|sortlist|directory profiles|agency listings/i],
  ["reviews", /\breview/i],
  ["client-credits", /mention on their own site|credit that matches|credit line/i],
  ["local-business-lists", /dietlikon municipal|gewerbe/i],
  ["partner-programmes", /partner programme/i],
  ["awards", /\bawards?\b|best of swiss web/i],
  ["mobile-apps-decision", /sells mobile apps/i],
  ["vercel-firewall", /firewall/i],
  ["framer-unpublish", /framer project/i],
  ["brave-submit", /search\.brave\.com\/submit-url/i],
  ["german-locale", /de-ch\) (locale|versions)|german \(de-ch\)/i],
  ["german-price-pages", /german price pages/i],
  ["german-questions", /client questions in german/i],
  ["german-trades", /german versions of the trade pages/i],
  ["german-hub", /german hub/i],
  ["german-ai-pages", /german pages for ai services/i],
  ["german-plan", /plan proper german versions/i],
  ["ai-answer-pages", /ai-search answer pages/i],
  ["answer-fields", /`answer` field|answer` field|marketing pages: add an `answer`/i],
  ["service-answers", /service pages: show the existing `answer`/i],
  ["schema-fixes", /schema fixes/i],
  ["faq-schema", /faqpage/i],
  ["price-ranges", /price ranges and timelines/i],
  ["llms-txt", /llms\.txt/i],
  ["framer-redirects", /framer-era paths|framer leftovers|old framer (address|url)/i],
  ["sitemap-lastmod", /lastmod/i],
  ["instagram-sameas", /instagram/i],
  ["about-page", /rewrite \/about/i],
  ["ai-referrals", /ai referrals|ai baseline/i],
  ["faq-field-guard", /faq-field/i],
  ["titles-place", /titles and h1s/i],
  ["retitle-marketing", /retitle the english marketing pages/i],
  ["wedding-page", /wedding page|^wedding:/i],
  ["hubs-copy", /three hubs/i],
  ["contact-duplicates", /\/contact duplicates/i],
  ["insights-bylines", /sign articles/i],
  ["data-piece", /data piece/i],
  ["bylined-articles", /bylined expert articles/i],
  ["youtube", /youtube channel/i],
  ["off-site-presence", /consistent and earn real third-party mentions|build real presence off the site/i],
  ["crawl-demand", /raise crawl demand/i],
];

/**
 * An action's first sentence (or line): what it is about. Its later sentences
 * name other things in passing. A sentence ends at ".", "!" or "?" after a
 * word, so "in this order: 1. Sortlist" and "e.g." do not end one.
 */
export function headOf(text: string): string {
  return (text.trim().split(/(?<=[\p{L})\]'"”’]{2}[.!?])\s|\n/u)[0] ?? text).trim();
}

/** Topics that are the subject whenever a first sentence names them, wherever: "once registered and listed on Clutch, create a Wikidata item" is about Wikidata. */
const SUBJECTS: [string, RegExp][] = [["wikidata", /wikidata/i]];

/**
 * The topic an action is filed under: of the topics its FIRST SENTENCE names,
 * the one named first ("Register in the commercial register … then local.ch"
 * is the register, not the listings), a SUBJECTS topic before any; else one
 * made from its words, its own. Never matched on the whole text: a step that
 * mentions a review or a request for indexing in passing is not about either.
 */
export function topicOf(text: string): string {
  const head = headOf(text);
  for (const [key, re] of SUBJECTS) if (re.test(head)) return key;
  let best: { key: string; at: number } | null = null;
  for (const [key, re] of TOPICS) {
    const m = re.exec(head);
    if (m && (!best || m.index < best.at)) best = { key, at: m.index };
  }
  if (best) return best.key;
  return `audit-${createHash("sha1").update(text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80)).digest("hex").slice(0, 10)}`;
}

/** Topics that are steps in Search Console's own pages: the lead does them in the owner's browser. */
const CHROME_TOPICS = new Set(["gsc-validate-noindex", "gsc-request-indexing", "gsc-sitemaps-feed", "gsc-generative-ai", "brave-submit"]);

/**
 * Who does an audit action: by the audit's own "who", then by topic. Null
 * when it is not a person's step here: a "desk tool" is a feature of this
 * engine, not a task. "off-site" work (listings, reviews, a register entry,
 * mentions) is done in the owner's name and accounts, so it is the owner's.
 */
export function whoOf(auditWho: string, topic: string): Who | null {
  if (auditWho === "desk tool") return null;
  if (CHROME_TOPICS.has(topic)) return "lead-chrome";
  if (auditWho === "owner login" || auditWho === "off-site") return "owner";
  if (auditWho === "website code") return "code";
  if (auditWho === "content") return "content";
  return null;
}

/**
 * The first sentence of a step, at most 140 characters. A longer sentence is
 * cut at its first colon when what stands before it says something (25
 * characters or more: "In Search Console:" alone does not), else with "…".
 */
export function titleOf(step: string): string {
  const s = step.replace(/\s+/g, " ").trim();
  const first = s.split(/(?<=[.!?])\s/)[0] ?? s;
  if (first.length <= 140) return first.replace(/[.:]$/, "");
  const colon = first.indexOf(": ");
  if (colon >= 25 && colon <= 140) return first.slice(0, colon);
  return `${first.slice(0, 139).trimEnd()}…`;
}

export interface OwnerInput {
  id: string;
  step: string;
  why: string | null;
  impact: Priority;
  effort: string | null;
  who: Who;
  origin: string;
  sort: number;
}

interface OwnerDb {
  id: string;
  title: string;
  step: string;
  why: string | null;
  impact: Priority;
  effort: string | null;
  who: Who;
  origin: string;
  sort: number;
  done: number;
  done_by: string | null;
  done_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** Add or refresh a task from an import. Its done mark, who set it and the note are never touched. */
export function upsertOwnerTask(t: OwnerInput, at = now()): "added" | "changed" | "unchanged" {
  const had = db.prepare("SELECT * FROM cc_seo_owner_tasks WHERE id = ?").get(t.id) as OwnerDb | undefined;
  const title = titleOf(t.step);
  if (!had) {
    db.prepare("INSERT INTO cc_seo_owner_tasks (id, title, step, why, impact, effort, who, origin, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      t.id,
      title,
      t.step,
      t.why,
      t.impact,
      t.effort,
      t.who,
      t.origin,
      t.sort,
      at,
      at,
    );
    return "added";
  }
  if (had.title === title && had.step === t.step && had.why === t.why && had.impact === t.impact && had.effort === t.effort && had.who === t.who && had.origin === t.origin && had.sort === t.sort) return "unchanged";
  db.prepare("UPDATE cc_seo_owner_tasks SET title = ?, step = ?, why = ?, impact = ?, effort = ?, who = ?, origin = ?, sort = ?, updated_at = ? WHERE id = ?").run(
    title,
    t.step,
    t.why,
    t.impact,
    t.effort,
    t.who,
    t.origin,
    t.sort,
    at,
    t.id,
  );
  return "changed";
}

export interface OwnerTask extends OwnerTaskRow {
  /** Including "code" and "content", which are not shown as "Needs you". */
  whoAll: Who;
}

const toRow = (r: OwnerDb, opportunities: Map<string, number>): OwnerTask => ({
  id: r.id,
  title: r.title,
  step: r.step,
  why: r.why ?? "",
  impact: r.impact,
  effort: r.effort ?? "",
  who: r.who === "lead-chrome" ? "lead-chrome" : "owner",
  whoAll: r.who,
  from: r.origin,
  done: !!r.done,
  doneBy: r.done_by,
  doneAt: r.done_at,
  note: r.note,
  opportunities: opportunities.get(r.id) ?? 0,
});

const RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** Tasks by who does them, open first, then by impact and the audit's order. */
export function ownerTasks(who: Who[] = ["owner"]): OwnerTask[] {
  const marks = who.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM cc_seo_owner_tasks WHERE who IN (${marks})`).all(...who) as unknown as OwnerDb[];
  const opps = new Map(
    (db.prepare("SELECT json_extract(action, '$.ownerTaskId') AS t, COUNT(*) AS n FROM cc_seo_opps WHERE active = 1 AND json_extract(action, '$.ownerTaskId') IS NOT NULL GROUP BY t").all() as { t: string; n: number }[]).map((r) => [
      r.t,
      r.n,
    ]),
  );
  return rows.map((r) => toRow(r, opps)).sort((a, b) => Number(a.done) - Number(b.done) || RANK[a.impact] - RANK[b.impact] || a.title.localeCompare(b.title));
}

export function ownerTask(id: string): OwnerTask | null {
  return ownerTasks(["owner", "lead-chrome", "code", "content"]).find((t) => t.id === id) ?? null;
}

/** A person marks a task done or open again. */
export function markOwnerTask(id: string, done: boolean, by: string, noteText?: string | null): OwnerTask | null {
  const had = ownerTask(id);
  if (!had) return null;
  db.prepare("UPDATE cc_seo_owner_tasks SET done = ?, done_by = ?, done_at = ?, note = COALESCE(?, note) WHERE id = ?").run(done ? 1 : 0, done ? by : null, done ? now() : null, noteText ?? null, id);
  if (had.done !== done) {
    note("seo-state", done ? `Marked done: ${had.title}` : `Opened again: ${had.title}`, {
      tone: done ? "good" : "info",
      actor: by,
      detail: had.who === "lead-chrome" ? "A step in the owner's browser" : "An owner task",
      href: "/seo#needs-you",
      dedupe: `seo:owner:${id}:${done ? "done" : "open"}:${now()}`,
    });
  }
  return ownerTask(id);
}
