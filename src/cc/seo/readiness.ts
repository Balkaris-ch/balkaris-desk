import { db } from "../../db.ts";
import { bing } from "../search/index.ts";
import { abs } from "../site/http.ts";
import { lastSitemap } from "../site/index.ts";
import { allowed, parseRobots } from "../site/sitemap.ts";
import { keep, kept } from "../store.ts";
import type { PageReadiness, ReadinessCheck } from "../../../web/src/contract/seo/ai-search.ts";
import { fetchPage, readHtml } from "./html.ts";
import { napMatrix, profiles } from "./presence.ts";
import { siteView } from "./site.ts";
import { json, now } from "./tables.ts";

/**
 * AI READINESS: what an AI search engine needs to find, understand and quote
 * a page, checked on the page the way a crawler gets it (no JavaScript), once
 * a day. Every check says what it read; none is a score of ours.
 *
 * PER PAGE (which checks apply depends on the page's kind: APPLIES)
 *   answer     a paragraph of 40 to 140 words directly under the main heading,
 *              within its first 100 words: the direct answer an assistant
 *              quotes (the audit's fix: a 50 to 100 word answer under the H1)
 *   faq        questions and answers on the page (a FAQ heading, or two or
 *              more questions as headings or <summary>)
 *   faq-schema the visible questions are all in FAQPage structured data
 *   org        the page names Balkaris and its place (Zürich, Switzerland)
 *   price      a CHF amount stated on the page
 *   timeline   a duration stated on the page (days, weeks, months)
 *   german     a German version linked by hreflang
 *   updated    a last-updated date: dateModified or datePublished in the
 *              page's structured data, or the sitemap's lastmod
 *
 * SITE-WIDE
 *   robots     robots.txt lets the AI and search crawlers read the site
 *   llms       /llms.txt answers with plain text (optional: Google says it is
 *              not needed; no AI company's crawler documentation asks for it)
 *   lastmod    every sitemap address carries a real lastmod
 *   bing       Bing Webmaster is connected (Copilot and ChatGPT search draw on Bing)
 *   profile    a Google Business Profile exists (AI Mode and AI Overviews name
 *              agencies from Maps profiles)
 *   nap        name, address and phone agree wherever they are stated
 */

type Key = "answer" | "faq" | "faq-schema" | "org" | "price" | "timeline" | "german" | "updated";

const LABEL: Record<Key, string> = {
  answer: "Direct answer under the heading",
  faq: "Questions answered on the page",
  "faq-schema": "FAQ in structured data",
  org: "Names Balkaris and its place",
  price: "States a price",
  timeline: "States how long it takes",
  german: "German version",
  updated: "Last-updated date",
};

/** Which checks apply to which kind of page. */
const APPLIES: Record<string, Key[]> = {
  home: ["org", "german", "updated"],
  service: ["answer", "faq", "faq-schema", "org", "price", "timeline", "german", "updated"],
  landing: ["answer", "faq", "faq-schema", "org", "price", "timeline", "german", "updated"],
  segment: ["answer", "faq", "faq-schema", "org", "german", "updated"],
  article: ["updated"],
  case: ["org", "updated"],
  standard: ["org", "updated"],
  insights: ["updated"],
  legal: [],
};

const ALL: Key[] = ["answer", "faq", "faq-schema", "org", "price", "timeline", "german", "updated"];

const words = (s: string): string[] => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
const plain = (html: string): string =>
  html
    .replace(/<(script|style|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;|&rsquo;/g, "’")
    .replace(/\s+/g, " ")
    .trim();

const DURATION = /\b\d+\s*(?:[–-]|to|bis)?\s*\d*\s*(?:working\s+)?(?:weeks?|days?|months?|Wochen|Woche|Tagen?|Monaten?)\b/i;
const PRICE = /(?:CHF|Fr\.|SFr\.?)\s?\d|\d[\d'’.,]*\s?(?:CHF|Franken)\b/i;

/** The checks of one page from its HTML, the kind it is and the sitemap's lastmod. */
export function judgePage(html: string, kind: string, lastmod: string | null): ReadinessCheck[] {
  const r = readHtml(html);
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? html;
  const applies = new Set(APPLIES[kind] ?? APPLIES.standard);
  const out: ReadinessCheck[] = [];
  const add = (key: Key, state: ReadinessCheck["state"], detail: string, fix: string | null, who: ReadinessCheck["who"]) =>
    out.push({ key, label: LABEL[key], state: applies.has(key) ? state : "n/a", detail: applies.has(key) ? detail : "Does not apply to this kind of page.", fix: applies.has(key) && state === "fail" ? fix : null, who: applies.has(key) && state === "fail" ? who : null });

  /* answer: the first paragraphs after the h1 */
  const afterH1 = main.split(/<\/h1>/i).slice(1).join("</h1>") || main;
  const paras = [...afterH1.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => plain(m[1]!)).filter(Boolean);
  let seen = 0;
  let found: string | null = null;
  let longest = 0;
  for (const p of paras) {
    if (seen >= 100) break;
    const n = words(p).length;
    longest = Math.max(longest, n);
    if (n >= 40 && n <= 140) {
      found = p;
      break;
    }
    seen += n;
  }
  add(
    "answer",
    found ? "pass" : "fail",
    found ? `A ${words(found).length}-word paragraph under the heading: “${words(found).slice(0, 18).join(" ")}…”` : `No paragraph of 40 to 140 words in the first 100 words under the heading (the longest there has ${longest}).`,
    "Write a 50 to 100 word direct answer to the page's question and show it as the first paragraph under the H1.",
    "content",
  );

  /* faq: headings and summaries */
  const questions = new Set(
    [...main.matchAll(/<(summary|h2|h3|h4|dt)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => plain(m[2]!)).filter((q) => q.endsWith("?") && words(q).length >= 3),
  );
  const faqHeading = r.headings.some((h) => /\bFAQ\b|frequently asked|questions|fragen|asked before deciding/i.test(h));
  const hasFaq = faqHeading || questions.size >= 2;
  add("faq", hasFaq ? "pass" : "fail", hasFaq ? `${questions.size} question${questions.size === 1 ? "" : "s"} on the page${faqHeading ? " under a FAQ heading" : ""}.` : "No questions and answers on the page.", "Add five to eight questions clients ask, each with a short, specific answer.", "content");

  /* faq-schema */
  const faqNodes = r.schema.filter((n) => (Array.isArray(n["@type"]) ? (n["@type"] as unknown[]) : [n["@type"]]).includes("FAQPage"));
  const marked = faqNodes.reduce((n, f) => n + (Array.isArray(f.mainEntity) ? (f.mainEntity as unknown[]).length : f.mainEntity ? 1 : 0), 0);
  if (!hasFaq) add("faq-schema", "n/a", "No visible questions to mark up.", null, null);
  else if (!marked) add("faq-schema", "fail", `${questions.size} visible question${questions.size === 1 ? "" : "s"}, no FAQPage structured data.`, "Emit every visible question and answer in FAQPage structured data.", "code");
  else if (questions.size && marked < questions.size) add("faq-schema", "fail", `FAQPage holds ${marked} of the ${questions.size} visible questions.`, "Emit every visible question in FAQPage, not only the first few.", "code");
  else add("faq-schema", "pass", `FAQPage holds ${marked} question${marked === 1 ? "" : "s"}.`, null, null);

  /* org, price, timeline: in the content's text */
  const text = r.text;
  const named = /Balkaris/i.test(text);
  const place = /Z[uü]rich|Switzerland|Swiss|Schweiz/i.test(text);
  add("org", named && place ? "pass" : "fail", named && place ? "Names Balkaris and Zürich or Switzerland." : named ? "Names Balkaris but not where it works." : place ? "Names a place but not Balkaris." : "Names neither Balkaris nor its place.", "Say who does the work and where: Balkaris, Zürich, Switzerland.", "content");
  const price = PRICE.exec(text);
  add("price", price ? "pass" : "fail", price ? `States “${price[0].trim()}”.` : "No CHF amount on the page.", "State a price range (from CHF …) for the service: AI answers quote pages that give one.", "owner");
  const dur = DURATION.exec(text);
  add("timeline", dur ? "pass" : "fail", dur ? `States “${dur[0].trim()}”.` : "No duration on the page.", "State how long the work typically takes.", "content");

  /* german: an hreflang alternate */
  const german = /<link\b[^>]*hreflang=["']?de/i.test(html);
  add("german", german ? "pass" : "fail", german ? "Links a German version (hreflang)." : "No German version is linked (no hreflang de).", "Publish a German (de-CH) version and link the two with hreflang.", "code");

  /* updated */
  const dated = r.schema.map((n) => (typeof n.dateModified === "string" ? n.dateModified : typeof n.datePublished === "string" ? n.datePublished : null)).find(Boolean) ?? null;
  const when = dated ?? lastmod;
  add("updated", when ? "pass" : "fail", when ? `${dated ? "Structured data" : "The sitemap"} dates it ${when.slice(0, 10)}.` : "Neither the page's structured data nor the sitemap gives a date.", "Give the page a real last-updated date: dateModified in its structured data and lastmod in the sitemap.", "code");

  return ALL.map((k) => out.find((c) => c.key === k)!);
}

/* ---------- site-wide ---------------------------------------------------------------------- */

/** The crawlers robots.txt is read for. */
export const ROBOT_AGENTS: { agent: string; family: string }[] = [
  { agent: "GPTBot", family: "OpenAI (training)" },
  { agent: "OAI-SearchBot", family: "OpenAI (ChatGPT search)" },
  { agent: "ChatGPT-User", family: "OpenAI (a user's request)" },
  { agent: "PerplexityBot", family: "Perplexity" },
  { agent: "ClaudeBot", family: "Anthropic (training)" },
  { agent: "Claude-SearchBot", family: "Anthropic (search)" },
  { agent: "Google-Extended", family: "Google (Gemini training token)" },
  { agent: "Googlebot", family: "Google Search, AI Overviews, AI Mode" },
  { agent: "Bingbot", family: "Bing, Copilot, ChatGPT search" },
  { agent: "Applebot", family: "Apple (Siri, Spotlight)" },
  { agent: "CCBot", family: "Common Crawl" },
];

export interface SiteReadiness {
  at: string;
  checks: ReadinessCheck[];
  robots: { status: number; agents: { agent: string; family: string; allowed: boolean }[] };
  llms: { status: number; present: boolean; line: string };
  lastmod: { addresses: number; withLastmod: number };
}

/** Where the readiness check reads. The check script replaces it. */
export const wire = { fetchPage, sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)) };

async function siteChecks(): Promise<SiteReadiness> {
  const checks: ReadinessCheck[] = [];
  const robotsGot = await wire.fetchPage(abs("/robots.txt"), { accept: "text/plain,*/*;q=0.5" });
  const robots = robotsGot.status === 200 && robotsGot.html ? parseRobots(robotsGot.html) : null;
  const agents = ROBOT_AGENTS.map((a) => ({ ...a, allowed: robots ? allowed(robots, "/", a.agent) : robotsGot.status === 404 }));
  const blocked = agents.filter((a) => !a.allowed);
  checks.push({
    key: "robots",
    label: "robots.txt lets AI and search crawlers in",
    state: robotsGot.status === 0 ? "unknown" : blocked.length ? "fail" : "pass",
    detail: robotsGot.status === 0 ? `robots.txt did not answer (${robotsGot.error ?? "no answer"}).` : blocked.length ? `robots.txt blocks ${blocked.map((b) => b.agent).join(", ")}.` : `robots.txt (${robotsGot.status}) lets all ${agents.length} named crawlers read the site.`,
    fix: blocked.length ? "Allow the search crawlers (OAI-SearchBot, PerplexityBot, Claude-SearchBot, Googlebot, Bingbot) in robots.txt." : null,
    who: blocked.length ? "code" : null,
  });

  await wire.sleep(400);
  const llmsGot = await wire.fetchPage(abs("/llms.txt"), { accept: "text/plain,*/*;q=0.5" });
  const present = llmsGot.status === 200 && !/text\/html/i.test(llmsGot.contentType ?? "") && !/<html/i.test((llmsGot.html ?? "").slice(0, 300));
  const llmsLine = present ? "/llms.txt answers with plain text." : `/llms.txt ${llmsGot.status ? `answers ${llmsGot.status}${llmsGot.status === 200 ? " with a web page" : ""}` : "does not answer"}.`;
  checks.push({
    key: "llms",
    label: "/llms.txt (optional)",
    state: llmsGot.status === 0 ? "unknown" : present ? "pass" : "fail",
    detail: `${llmsLine} Optional: Google says it is not needed, and no AI company's crawler documentation asks for it.`,
    fix: present ? null : "Optional: generate /llms.txt from the content layer (services with their answers, the questions answered, case studies, contact).",
    who: present ? null : "code",
  });

  const map = lastSitemap();
  const entries = map?.entries ?? [];
  const withLastmod = entries.filter((e) => e.lastmod).length;
  checks.push({
    key: "lastmod",
    label: "Every sitemap address has a real lastmod",
    state: !map ? "unknown" : withLastmod === entries.length ? "pass" : "fail",
    detail: !map ? "The sitemap has not been read yet." : `${withLastmod} of ${entries.length} sitemap addresses carry a lastmod.`,
    fix: map && withLastmod < entries.length ? "Give every sitemap entry the date its content last changed (app/sitemap.ts), not the build time." : null,
    who: map && withLastmod < entries.length ? "code" : null,
  });

  let bingState: ReadinessCheck["state"] = "unknown";
  let bingDetail = "Bing Webmaster's state could not be read.";
  try {
    const s = bing.status();
    bingState = s.state === "connected" ? "pass" : "fail";
    bingDetail = s.state === "connected" ? "Bing Webmaster is connected to the desk." : "Bing Webmaster is not connected: Bing's index feeds Copilot and ChatGPT search.";
  } catch {
    /* unknown, said above */
  }
  checks.push({ key: "bing", label: "Bing Webmaster is set up", state: bingState, detail: bingDetail, fix: bingState === "fail" ? "Owner: set up Bing Webmaster Tools by importing from Search Console and submit the sitemap." : null, who: bingState === "fail" ? "owner" : null });

  const gbp = profiles().find((p) => p.key === "google-business-profile");
  const gbpExists = gbp?.state === "exists" || (gbp?.state === "unknown" && !!gbp.napSeen);
  checks.push({
    key: "profile",
    label: "A Google Business Profile exists",
    state: !gbp ? "unknown" : gbpExists ? "pass" : "fail",
    detail: !gbp ? "The profiles have not been imported yet." : gbpExists ? `It exists${gbp.napSeen ? ` (seen by the audit on ${gbp.napSeen.day})` : ""}; its category and reviews are the owner task's to fix.` : "No Google Business Profile is known.",
    fix: gbp && !gbpExists ? "Owner: create and verify the Google Business Profile." : null,
    who: gbp && !gbpExists ? "owner" : null,
  });

  const nap = napMatrix();
  const stated = nap.fields.some((f) => f.values.length);
  checks.push({
    key: "nap",
    label: "Name, address and phone agree everywhere",
    state: !stated ? "unknown" : nap.consistent ? "pass" : "fail",
    detail: !stated ? "No profile states them yet." : nap.consistent ? "Every source states the same name, address and phone." : `They differ: ${nap.fields.filter((f) => !f.consistent).map((f) => `${f.field} (${new Set(f.values.map((v) => v.value)).size} versions)`).join(", ")}.`,
    fix: stated && !nap.consistent ? "Owner: decide the one true name, address and phone, then copy it to every profile." : null,
    who: stated && !nap.consistent ? "owner" : null,
  });

  return {
    at: now(),
    checks,
    robots: { status: robotsGot.status, agents },
    llms: { status: llmsGot.status, present, line: llmsLine },
    lastmod: { addresses: entries.length, withLastmod },
  };
}

/* ---------- the job ------------------------------------------------------------------------- */

/**
 * Check every indexable sitemap page and the site-wide items. One request at
 * a time to the site, 400 ms apart: about a minute for a hundred pages.
 */
export async function checkReadiness(progress: (done: number, of: number, what?: string) => void = () => {}): Promise<string> {
  const view = siteView();
  if (!view.at) throw new Error("The crawl has not read the site yet; the readiness check reads the pages it lists.");
  const lastmods = new Map((lastSitemap()?.entries ?? []).map((e) => [e.path, e.lastmod]));
  const list = view.pages.filter((p) => p.inSitemap && p.status === 200);
  const put = db.prepare("INSERT INTO cc_seo_readiness (path, checked_at, status, json) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET checked_at = excluded.checked_at, status = excluded.status, json = excluded.json");
  let ready = 0;
  let judged = 0;
  for (const [i, p] of list.entries()) {
    if (i) await wire.sleep(400);
    progress(i, list.length, p.path);
    const got = await wire.fetchPage(p.url);
    if (got.status !== 200 || !got.html) {
      put.run(p.path, now(), got.status, JSON.stringify({ error: got.error ?? `answered ${got.status}` }));
      continue;
    }
    const checks = judgePage(got.html, p.kind, lastmods.get(p.path) ?? null);
    put.run(p.path, now(), got.status, JSON.stringify({ checks }));
    const applying = checks.filter((c) => c.state !== "n/a");
    if (applying.length) {
      judged++;
      if (applying.every((c) => c.state === "pass")) ready++;
    }
  }
  /* A page that left the sitemap leaves this table. */
  const keepPaths = new Set(list.map((p) => p.path));
  for (const r of db.prepare("SELECT path FROM cc_seo_readiness").all() as { path: string }[]) if (!keepPaths.has(r.path)) db.prepare("DELETE FROM cc_seo_readiness WHERE path = ?").run(r.path);
  progress(list.length, list.length, "site-wide checks");
  const site = await siteChecks();
  keep("seo:readiness:site", site);
  const failing = site.checks.filter((c) => c.state === "fail").length;
  return `${list.length} pages read: ${ready} of ${judged} pass every check that applies; ${failing} of ${site.checks.length} site-wide checks fail`;
}

/* ---------- reading it back ------------------------------------------------------------------ */

export function siteReadiness(): SiteReadiness | null {
  return kept<SiteReadiness>("seo:readiness:site")?.value ?? null;
}

export function pageReadiness(): { checkedAt: string | null; pages: PageReadiness[] } {
  const view = siteView();
  const rows = db.prepare("SELECT path, checked_at, json FROM cc_seo_readiness ORDER BY path").all() as { path: string; checked_at: string; json: string }[];
  let checkedAt: string | null = null;
  const pages: PageReadiness[] = [];
  for (const r of rows) {
    const v = json<{ checks?: ReadinessCheck[]; error?: string }>(r.json, {});
    if (!v.checks) continue;
    if (!checkedAt || r.checked_at > checkedAt) checkedAt = r.checked_at;
    const p = view.byPath.get(r.path);
    const applying = v.checks.filter((c) => c.state !== "n/a");
    pages.push({ path: r.path, title: p?.title ?? null, kind: p?.kind ?? null, lang: p?.lang ?? null, checks: v.checks, pass: applying.filter((c) => c.state === "pass").length, of: applying.length });
  }
  return { checkedAt, pages };
}

export function readinessOf(path: string): { checkedAt: string; checks: ReadinessCheck[] } | null {
  const r = db.prepare("SELECT checked_at, json FROM cc_seo_readiness WHERE path = ?").get(path) as { checked_at: string; json: string } | undefined;
  const v = json<{ checks?: ReadinessCheck[] }>(r?.json, {});
  return r && v.checks ? { checkedAt: r.checked_at, checks: v.checks } : null;
}
