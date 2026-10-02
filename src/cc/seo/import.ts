import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { db } from "../../db.ts";
import { note } from "../store.ts";
import type { Intent, KeywordSource, KeywordStatus } from "../../../web/src/contract/seo/keywords.ts";
import type { NewAiCheck } from "../../../web/src/contract/seo/ai-search.ts";
import type { Priority } from "../../../web/src/contract/seo/common.ts";
import { addCheck, checkRefusal, parseCsv } from "./aisearch.ts";
import { addCompetitorPage, addSighting, domainKey, readable } from "./competitors.ts";
import { remap, upsertCluster, upsertKeyword } from "./keywords.ts";
import { topicOf, upsertOwnerTask, whoOf } from "./owner.ts";
import { upsertProfile } from "./presence.ts";
import { now } from "./tables.ts";
import { normal } from "./words.ts";

/**
 * THE AUDIT'S FINDINGS INTO THE DATABASE: the keyword and cluster tables, the
 * owner's tasks, the AI-assistant baseline, the Google results it captured
 * and the profiles it found. Real data lives only in the database; the files
 * stay in the git-ignored work/seo-audit/ (copied to the box to import there).
 *
 *   keywords/keywords.csv   phrases: language, sources, relevance, cluster,
 *                           intent, flags, the page the audit mapped
 *   keywords/clusters.csv   clusters: name, language, intent, the audit's
 *                           judgement (priority), order of attack, page, why
 *   audit.json              the audit's actions: owner tasks and the rest
 *   chrome/ai-checks.json   the questions asked of the AI assistants
 *   chrome/serp.json        the Google results observed for client queries
 *   offsite/profiles.json   the profiles and listings found, and their NAP
 *
 * IDEMPOTENT. Every row has a natural key (the phrase, the cluster, the topic,
 * the check, the sighting, the profile), and an import of the same files
 * changes nothing the second time. What a person decided (a status, a
 * mapping, a done mark, a state) is never overwritten by an import.
 */

export interface ImportResult {
  lines: string[];
}

type Count = { read: number; added: number; changed: number };
const count = (): Count => ({ read: 0, added: 0, changed: 0 });
const tallied = (c: Count, r: "added" | "changed" | "unchanged" | boolean) => {
  c.read++;
  if (r === "added" || r === true) c.added++;
  else if (r === "changed") c.changed++;
};
const line = (what: string, c: Count): string => `${what}: ${c.read.toLocaleString("en-GB")} read, ${c.added.toLocaleString("en-GB")} added, ${c.changed.toLocaleString("en-GB")} changed`;

/** A CSV with a header row, as objects. */
function rowsOf(text: string): Record<string, string>[] {
  const cells = parseCsv(text);
  const head = (cells[0] ?? []).map((h) => h.trim());
  return cells.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** "https://www.balkaris.ch/seo" → "/seo"; anything that is not one of the site's addresses → null. */
function sitePath(v: string): string | null {
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    if (!/(^|\.)balkaris\.ch$/i.test(u.hostname)) return null;
    return u.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

const INTENTS = new Set<Intent>(["commercial", "transactional", "informational", "local", "navigational"]);
const intentOf = (v: string): Intent | null => (INTENTS.has(v as Intent) ? (v as Intent) : null);
const priorityOf = (v: string): Priority => (v === "high" || v === "medium" || v === "low" ? v : "medium");
const yes = (v: string): boolean => v.toLowerCase() === "yes";

export function importKeywords(text: string): string {
  const c = count();
  const at = now();
  db.exec("BEGIN");
  try {
    for (const r of rowsOf(text)) {
      if (!r.keyword) continue;
      const status: KeywordStatus = r.relevant === "yes" ? "relevant" : r.relevant === "weak" ? "weak" : r.relevant === "no" ? "irrelevant" : "unjudged";
      const also: KeywordSource[] = (r.sources ?? "")
        .split(/[;,|]/)
        .map((s) => s.trim())
        .flatMap((s): KeywordSource[] => (s === "search-console" ? ["gsc"] : s === "autocomplete" ? ["autocomplete"] : []));
      tallied(
        c,
        upsertKeyword(
          {
            phrase: r.keyword,
            lang: r.lang === "de" || r.lang === "en" ? r.lang : null,
            cluster: r.cluster || null,
            intent: intentOf(r.intent ?? ""),
            source: "audit",
            also,
            status,
            page: sitePath(r.target_page ?? ""),
            note: r.relevance_note || null,
            flags: { local: yes(r.local ?? ""), question: yes(r.question ?? ""), price: yes(r.price ?? "") },
            by: "audit",
          },
          at,
        ),
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return line("keywords", c);
}

export function importClusters(text: string): string {
  const c = count();
  const at = now();
  for (const r of rowsOf(text)) {
    if (!r.cluster) continue;
    tallied(
      c,
      upsertCluster(
        {
          key: r.cluster,
          name: r.name || r.cluster,
          lang: r.lang || "en",
          intent: intentOf(r.intent ?? ""),
          priority: priorityOf(r.winnability ?? ""),
          rank: Number(r.attack_rank) || null,
          page: sitePath(r.target_page ?? ""),
          pageSaid: [r.page_status, sitePath(r.target_page ?? "") ? null : r.target_page].filter((x) => x && x !== "-").join("; ") || null,
          why: r.attack_reason || r.winnability_reason || null,
          action: r.action || null,
          examples: (r.examples ?? "").split(" | ").map((x) => x.trim()).filter(Boolean),
          source: "audit",
        },
        at,
      ),
    );
  }
  return line("clusters", c);
}

interface AuditAction {
  action: string;
  who: string;
  impact: string;
  effort: string;
  why: string;
}

/**
 * Sections in the order their actions are filed: the first to name a topic
 * gives its wording. A verified pass replaces the measured one. "chrome-live"
 * is the audit's pass in the owner's browser (measured only).
 */
const SECTIONS = ["off-site", "search-console", "keywords", "ai-readiness", "chrome-live"];

export function importAudit(json: Record<string, { actions?: AuditAction[] }>, day: string): string {
  const c = count();
  const seen = new Set<string>();
  /* Who a topic's first task is for: the same topic for someone else is another task ("business-profile" for the owner, "business-profile-code" for the website). */
  const firstWho = new Map<string, string>();
  let sort = 0;
  for (const section of SECTIONS) {
    const pass = json[`verify:${section}`] ?? json[`measure:${section}`];
    const which = json[`verify:${section}`] ? "verified" : "measured";
    for (const a of pass?.actions ?? []) {
      const step = String(a.action ?? "").trim();
      if (!step) continue;
      const topic = topicOf(step);
      const who = whoOf(String(a.who ?? ""), topic);
      if (!who) continue;
      const id = firstWho.has(topic) && firstWho.get(topic) !== who ? `${topic}-${who}` : topic;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!firstWho.has(topic)) firstWho.set(topic, who);
      tallied(
        c,
        upsertOwnerTask({
          id,
          step,
          why: a.why ? String(a.why) : null,
          impact: priorityOf(String(a.impact ?? "")),
          effort: a.effort ? String(a.effort) : null,
          who,
          origin: `SEO audit (${section}, ${which}), ${day}`,
          sort: sort++,
        }),
      );
    }
  }
  /* A task the audit no longer lists goes, unless a person has touched it (a done mark, a note): then it stays, theirs. */
  const stale = (db.prepare("SELECT id FROM cc_seo_owner_tasks WHERE origin LIKE 'SEO audit%' AND done = 0 AND done_by IS NULL AND note IS NULL").all() as { id: string }[]).filter((r) => !seen.has(r.id));
  for (const r of stale) db.prepare("DELETE FROM cc_seo_owner_tasks WHERE id = ?").run(r.id);
  return `${line("owner, browser, code and content tasks", c)}${stale.length ? `, ${stale.length} no longer listed removed` : ""}`;
}

export function importAiChecks(json: { day?: string; by?: string; checks?: Partial<NewAiCheck>[] }): string {
  const c = count();
  const refused: string[] = [];
  for (const raw of json.checks ?? []) {
    const check = { day: json.day, by: json.by, ...raw } as NewAiCheck;
    const why = checkRefusal(check);
    if (why) {
      refused.push(`${raw.engine ?? "?"} “${raw.question ?? "?"}”: ${why}`);
      continue;
    }
    tallied(c, addCheck(check, "the import"));
  }
  return `${line("AI checks", c)}${refused.length ? `; refused ${refused.length}: ${refused.slice(0, 3).join("; ")}` : ""}`;
}

interface Serp {
  day?: string;
  by?: string;
  searches?: {
    query: string;
    lang?: string;
    /** Balkaris's own organic position as the audit counted it; null or absent when the notes do not record it. */
    balkaris?: number | null;
    organic?: { position: number; domain: string; url?: string }[];
    localPack?: { position: number; name: string; domain: string | null; note?: string }[];
    aioNamed?: { name: string; domain: string | null }[];
    aioCited?: { name: string; domain: string | null }[];
  }[];
}

/** How many of a query's top organic results have their page read. */
const READ_TOP = 5;

/** The site's own host as a sighting's domain (domainKey's form). */
const OWN_DOMAIN = "balkaris.ch";

/**
 * Balkaris's own position in a captured search, kept beside the others' so a
 * page can set a competitor's position against ours for the same search and
 * day. It is a sighting of our own host and never a competitor: it is not
 * added to cc_seo_competitors, and its page is not read. Returns whether it
 * was new.
 */
function addOwnSighting(s: { query: string; lang: string | null; cluster: string | null; position: number; day: string; by: string }): boolean {
  const r = db
    .prepare("INSERT OR IGNORE INTO cc_seo_sightings (domain, name, engine, kind, query, lang, cluster, position, day, by, note) VALUES (?, ?, 'google', 'organic', ?, ?, ?, ?, ?, ?, ?)")
    .run(OWN_DOMAIN, "Balkaris", s.query, s.lang, s.cluster, s.position, s.day, s.by, "our own position, as the capture counted it");
  return r.changes > 0;
}

export function importSerp(json: Serp): string {
  const s = count();
  const pages = count();
  const day = json.day ?? now().slice(0, 10);
  const by = json.by ?? "audit";
  const clusterOf = db.prepare("SELECT cluster FROM cc_seo_keywords WHERE phrase = ?");
  for (const q of json.searches ?? []) {
    const cluster = (clusterOf.get(normal(q.query)) as { cluster: string | null } | undefined)?.cluster ?? null;
    const lang = q.lang ?? null;
    if (typeof q.balkaris === "number" && Number.isInteger(q.balkaris) && q.balkaris > 0) tallied(s, addOwnSighting({ query: q.query, lang, cluster, position: q.balkaris, day, by }));
    for (const o of q.organic ?? []) {
      const domain = domainKey(o.domain);
      if (!domain) continue;
      tallied(s, addSighting({ domain, name: null, engine: "google", kind: "organic", query: q.query, lang, cluster, position: o.position, day, by }));
      if (o.position <= READ_TOP && readable(domain)) {
        tallied(pages, addCompetitorPage({ url: o.url ?? `https://${domain}/`, domain, address: o.url ? "ranking" : "home", cluster, query: q.query }));
      }
    }
    for (const l of q.localPack ?? []) {
      const domain = domainKey(l.domain, l.name);
      if (domain) tallied(s, addSighting({ domain, name: l.name, engine: "google-local", kind: "local-pack", query: q.query, lang, cluster, position: l.position, day, by, note: l.note ?? null }));
    }
    for (const n of q.aioNamed ?? []) {
      const domain = domainKey(n.domain, n.name);
      if (domain) tallied(s, addSighting({ domain, name: n.name, engine: "google-aio", kind: "named", query: q.query, lang, cluster, position: null, day, by }));
    }
    for (const n of q.aioCited ?? []) {
      const domain = domainKey(n.domain, n.name);
      if (domain) tallied(s, addSighting({ domain, name: n.domain ? null : n.name, engine: "google-aio", kind: "cited", query: q.query, lang, cluster, position: null, day, by }));
    }
  }
  return `${line("sightings", s)}; ${line("competitor pages to read", pages)}`;
}

interface Profiles {
  day?: string;
  profiles?: { key: string; name: string; kind: string; url: string | null; state: string; seen: { name: string | null; address: string | null; phone: string | null } | null; ownerTask: string | null; note: string | null }[];
}

export function importProfiles(json: Profiles): string {
  const c = count();
  const day = json.day ?? now().slice(0, 10);
  for (const [i, p] of (json.profiles ?? []).entries()) {
    const state = p.state === "exists" || p.state === "not-found" || p.state === "unknown" ? p.state : "not-checked";
    tallied(
      c,
      upsertProfile({
        key: p.key,
        name: p.name,
        kind: (["listing", "social", "directory", "register", "website"].includes(p.kind) ? p.kind : "listing") as "listing",
        url: p.url,
        state,
        stateWhy: state === "not-found" ? `The audit found no ${p.name} entry on ${day}${p.url ? "" : "; there is no address to check until one exists"}.${p.note ? ` ${p.note}` : ""}` : `As the audit saw it on ${day}.${p.note ? ` ${p.note}` : ""}`,
        seen: p.seen ? { ...p.seen, day } : null,
        ownerTask: p.ownerTask,
        source: "audit",
        sort: i,
      }),
    );
  }
  return line("profiles", c);
}

/** The day a file was written, as YYYY-MM-DD: the audit's own day. */
const dayOf = (file: string): string => statSync(file).mtime.toISOString().slice(0, 10);

/**
 * Import everything found under `dir` (default work/seo-audit). Files that
 * are not there are said, not failed: the box may hold only the CSVs.
 */
export function importAll(dir: string, o: { audit?: string } = {}): ImportResult {
  const lines: string[] = [];
  const file = (rel: string) => path.join(dir, rel);
  const read = (rel: string): string | null => (existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null);

  const kw = read("keywords/keywords.csv");
  const cl = read("keywords/clusters.csv");
  if (cl) lines.push(importClusters(cl));
  else lines.push("clusters: keywords/clusters.csv is not there");
  if (kw) lines.push(importKeywords(kw));
  else lines.push("keywords: keywords/keywords.csv is not there");

  const auditFile = o.audit ?? file("audit.json");
  if (existsSync(auditFile)) lines.push(importAudit(JSON.parse(readFileSync(auditFile, "utf8")), dayOf(auditFile)));
  else lines.push(`tasks: ${auditFile} is not there`);

  const ai = read("chrome/ai-checks.json");
  lines.push(ai ? importAiChecks(JSON.parse(ai)) : "AI checks: chrome/ai-checks.json is not there");
  const serp = read("chrome/serp.json");
  lines.push(serp ? importSerp(JSON.parse(serp)) : "sightings: chrome/serp.json is not there");
  const prof = read("offsite/profiles.json");
  lines.push(prof ? importProfiles(JSON.parse(prof)) : "profiles: offsite/profiles.json is not there");

  const m = remap();
  lines.push(`mapping by rule: ${m.keywords} phrases and ${m.clusters} clusters mapped anew`);
  /* Said in the log only when something changed: the same files twice say nothing the second time. */
  const changed = lines.reduce((n, l) => n + [...l.matchAll(/([\d,]+) (?:added|changed|mapped anew|no longer listed removed)/g)].reduce((m, x) => m + Number(x[1]!.replace(/,/g, "")), 0), 0);
  if (changed) note("seo-import", "Imported the SEO audit's findings", { tone: "info", detail: lines.slice(0, 3).join("; "), href: "/seo", dedupe: `seo:import:${now()}` });
  return { lines };
}
