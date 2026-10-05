import { db } from "../../db.ts";
import { bing } from "../search/index.ts";
import { abs } from "../site/http.ts";
import { lastSitemap } from "../site/index.ts";
import { allowed, parseRobots } from "../site/sitemap.ts";
import { keep, kept } from "../store.ts";
import type { PageReadiness, ReadinessCheck } from "../../../web/src/contract/seo/ai-search.ts";
import { fetchPage, readHtml, type Fetched } from "./html.ts";
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
 *   faq-schema the visible questions are all in FAQPage structured data,
 *              compared by their words (the site once marked up only the
 *              first three of the questions it showed)
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
 *
 * NOT READ IS NOT A FAILURE. An address that answers anything but 200 (or,
 * for robots.txt and /llms.txt, 404) could not be read: its check is
 * "unknown" with how it answered, a page keeps its last good read, and a run
 * that could read nothing erases nothing and says why (lastRun).
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

/** Two texts as one when only their case, punctuation, quotes or entities differ: a visible question against its name in FAQPage. */
const sameText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/&[a-z#0-9]+;/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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

  /* faq: the visible questions. A question is a heading, a <summary>, a <dt> or an accordion's own button
     that ends in "?"; a decoration inside it (the site's accordion carries a "+" in an aria-hidden <i>) is
     not part of the question, and counting it made every such question invisible to this check. */
  const asQuestion = (inner: string): string => plain(inner.replace(/<([a-z]+)\b[^>]*\baria-hidden=["']?true["']?[^>]*>[\s\S]*?<\/\1>/gi, " ")).replace(/[\s+＋›»▾▼–—-]+$/u, "");
  const visible = new Map<string, string>();
  for (const m of [...main.matchAll(/<(summary|h2|h3|h4|h5|dt)\b[^>]*>([\s\S]*?)<\/\1>/gi), ...main.matchAll(/<(button)\b[^>]*\baria-expanded\b[^>]*>([\s\S]*?)<\/button>/gi)]) {
    const q = asQuestion(m[2]!);
    if (q.endsWith("?") && words(q).length >= 3 && !visible.has(sameText(q))) visible.set(sameText(q), q);
  }
  const questions = new Set(visible.values());
  const faqHeading = r.headings.some((h) => /\bFAQ\b|frequently asked|questions|fragen|asked before deciding/i.test(h));
  const hasFaq = faqHeading || questions.size >= 2;
  add("faq", hasFaq ? "pass" : "fail", hasFaq ? `${questions.size} question${questions.size === 1 ? "" : "s"} on the page${faqHeading ? " under a FAQ heading" : ""}.` : "No questions and answers on the page.", "Add five to eight questions clients ask, each with a short, specific answer.", "content");

  /* faq-schema: every visible question is in FAQPage, compared by its words where FAQPage names its questions, by count where it does not. */
  const faqNodes = r.schema.filter((n) => (Array.isArray(n["@type"]) ? (n["@type"] as unknown[]) : [n["@type"]]).includes("FAQPage"));
  const entities = faqNodes.flatMap((f) => (Array.isArray(f.mainEntity) ? (f.mainEntity as unknown[]) : f.mainEntity ? [f.mainEntity] : []));
  const marked = entities.length;
  const markedNames = new Set(entities.map((e) => (e && typeof e === "object" && typeof (e as { name?: unknown }).name === "string" ? sameText((e as { name: string }).name) : "")).filter(Boolean));
  const unmarked = markedNames.size ? [...visible].filter(([k]) => !markedNames.has(k)).map(([, q]) => q) : [];
  if (!hasFaq) add("faq-schema", "n/a", "No visible questions to mark up.", null, null);
  else if (!marked) add("faq-schema", "fail", `${questions.size} visible question${questions.size === 1 ? "" : "s"}, no FAQPage structured data.`, "Emit every visible question and answer in FAQPage structured data.", "code");
  else if (unmarked.length)
    add(
      "faq-schema",
      "fail",
      `FAQPage holds ${questions.size - unmarked.length} of the ${questions.size} visible questions. Not in it: “${unmarked[0]}”${unmarked.length > 1 ? ` and ${unmarked.length - 1} more` : ""}.`,
      "Emit every visible question in FAQPage, not only the first few.",
      "code",
    );
  else if (!markedNames.size && questions.size && marked < questions.size) add("faq-schema", "fail", `FAQPage holds ${marked} of the ${questions.size} visible questions.`, "Emit every visible question in FAQPage, not only the first few.", "code");
  else add("faq-schema", "pass", `FAQPage holds ${marked} question${marked === 1 ? "" : "s"}${questions.size ? `, every one of the ${questions.size} visible` : ""}.`, null, null);

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
  /** `agents` is empty when robots.txt could not be read (`read` false): not known is never "blocked". */
  robots: { status: number; agents: { agent: string; family: string; allowed: boolean }[]; read?: boolean };
  llms: { status: number; present: boolean; line: string };
  lastmod: { addresses: number; withLastmod: number };
}

/** Where the readiness check reads. The check script replaces it. */
export const wire = { fetchPage, sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)) };

/** One request a second to the website at most, whoever asks: the job's loop and a person's "Check again" share this clock. */
const GAP_MS = 1000;
let lastAsk = 0;
async function politely(url: string, o?: { accept?: string }): Promise<Fetched> {
  const wait = lastAsk + GAP_MS - Date.now();
  if (wait > 0) await wire.sleep(wait);
  lastAsk = Date.now();
  return wire.fetchPage(url, o);
}

const STATUS_WORD: Record<number, string> = { 401: "sign-in required", 402: "payment required", 403: "refused", 404: "not found", 410: "gone", 429: "too many requests", 500: "server error", 502: "bad gateway", 503: "unavailable", 504: "gateway timeout" };

/** How an address answered, as a sentence's verb: "answered 402 (payment required)", "did not answer (no answer in time)". */
export const answered = (got: { status: number; error?: string | null }): string =>
  got.status === 0 ? `did not answer (${got.error ?? "no answer"})` : `answered ${got.status}${STATUS_WORD[got.status] ? ` (${STATUS_WORD[got.status]})` : ""}`;

/** 200 is the file, 404 or 410 says there is none: both are an answer. Anything else (402, 403, 5xx, nothing) says nothing about the file. */
const fileRead = (status: number): boolean => status === 200 || status === 404 || status === 410;

async function siteChecks(): Promise<SiteReadiness> {
  const checks: ReadinessCheck[] = [];
  const robotsGot = await politely(abs("/robots.txt"), { accept: "text/plain,*/*;q=0.5" });
  /* Without a robots.txt nothing is disallowed. A robots.txt that could not be read is not a robots.txt that blocks: until
     this rule a 402 from the host was reported as "robots.txt blocks GPTBot, OAI-SearchBot …" with a fix for the code. */
  const robotsRead = fileRead(robotsGot.status);
  const rules = robotsGot.status === 200 ? parseRobots(robotsGot.html ?? "") : null;
  const agents = robotsRead ? ROBOT_AGENTS.map((a) => ({ ...a, allowed: rules ? allowed(rules, "/", a.agent) : true })) : [];
  const blocked = agents.filter((a) => !a.allowed);
  checks.push({
    key: "robots",
    label: "robots.txt lets AI and search crawlers in",
    state: !robotsRead ? "unknown" : blocked.length ? "fail" : "pass",
    detail: !robotsRead
      ? `robots.txt ${answered(robotsGot)}, so what it says to the crawlers could not be read.`
      : blocked.length
        ? `robots.txt blocks ${blocked.map((b) => b.agent).join(", ")}.`
        : robotsGot.status === 200
          ? `robots.txt lets all ${agents.length} named crawlers read the site.`
          : `There is no robots.txt (${robotsGot.status}), so nothing is closed to any crawler.`,
    fix: blocked.length ? "Allow the search crawlers (OAI-SearchBot, PerplexityBot, Claude-SearchBot, Googlebot, Bingbot) in robots.txt." : null,
    who: blocked.length ? "code" : null,
  });

  const llmsGot = await politely(abs("/llms.txt"), { accept: "text/plain,*/*;q=0.5" });
  const llmsRead = fileRead(llmsGot.status);
  const present = llmsGot.status === 200 && !/text\/html/i.test(llmsGot.contentType ?? "") && !/<html/i.test((llmsGot.html ?? "").slice(0, 300));
  const llmsLine = present
    ? "/llms.txt answers with plain text."
    : !llmsRead
      ? `/llms.txt ${answered(llmsGot)}, so whether it is there could not be read.`
      : `/llms.txt ${llmsGot.status === 200 ? "answers 200 with a web page, not plain text" : `answers ${llmsGot.status}`}.`;
  checks.push({
    key: "llms",
    label: "/llms.txt (optional)",
    state: !llmsRead ? "unknown" : present ? "pass" : "fail",
    detail: `${llmsLine} Optional: Google says it is not needed, and no AI company's crawler documentation asks for it.`,
    fix: present || !llmsRead ? null : "Optional: generate /llms.txt from the content layer (services with their answers, the questions answered, case studies, contact).",
    who: present || !llmsRead ? null : "code",
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
    robots: { status: robotsGot.status, agents, read: robotsRead },
    llms: { status: llmsGot.status, present, line: llmsLine },
    lastmod: { addresses: entries.length, withLastmod },
  };
}

/* ---------- the job ------------------------------------------------------------------------- */

/** A page's row: its checks from the last read that worked, and why the newest attempt failed when it did. */
interface Stored {
  checks?: ReadinessCheck[];
  error?: string;
  failedAt?: string;
}

/** What the last run could and could not read, so the page can say it instead of drawing an empty table. */
export interface ReadinessRun {
  at: string;
  /** Sitemap pages the run asked for, and how many of them it read whole. */
  pages: number;
  read: number;
  /** How the unread pages answered: "answered 402 (payment required)". Null when every page was read. */
  why: string | null;
  /** False when the site did not answer at all: the site-wide checks are then the earlier run's. */
  site: boolean;
}

const RUN = "seo:readiness:run";

export function lastRun(): ReadinessRun | null {
  return kept<ReadinessRun>(RUN)?.value ?? null;
}

const UPSERT = "INSERT INTO cc_seo_readiness (path, checked_at, status, json) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET checked_at = excluded.checked_at, status = excluded.status, json = excluded.json";

/**
 * A page that could not be read keeps the checks of its last good read, with
 * why the newest attempt failed beside them: a site that answers 402 for a
 * day must not erase what the desk knew about every page. Returns whether an
 * earlier read was there to keep.
 */
function keepFailure(path: string, status: number, why: string): boolean {
  const had = db.prepare("SELECT json FROM cc_seo_readiness WHERE path = ?").get(path) as { json: string } | undefined;
  const before = json<Stored>(had?.json, {});
  if (before.checks) {
    db.prepare("UPDATE cc_seo_readiness SET status = ?, json = ? WHERE path = ?").run(status, JSON.stringify({ checks: before.checks, error: why, failedAt: now() } satisfies Stored), path);
    return true;
  }
  db.prepare(UPSERT).run(path, now(), status, JSON.stringify({ error: why, failedAt: now() } satisfies Stored));
  return false;
}

/**
 * Check every indexable sitemap page and the site-wide items. One request at
 * a time to the site, a second apart: about two minutes for a hundred pages.
 *
 * WHEN THE SITE DOES NOT ANSWER. A page that answers anything but 200 keeps
 * its last good read. When no page could be read at all, nothing is erased
 * and the site-wide checks are not replaced either; the run fails with the
 * reason, and `lastRun()` carries it to the page.
 */
export async function checkReadiness(progress: (done: number, of: number, what?: string) => void = () => {}): Promise<string> {
  const view = siteView();
  if (!view.at) throw new Error("The crawl has not read the site yet; the readiness check reads the pages it lists.");
  const lastmods = new Map((lastSitemap()?.entries ?? []).map((e) => [e.path, e.lastmod]));
  const listed = view.pages.filter((p) => p.inSitemap);
  const list = listed.filter((p) => p.status === 200);
  const hadRows = (db.prepare("SELECT COUNT(*) AS n FROM cc_seo_readiness").get() as { n: number }).n;
  const keptLine = hadRows ? " The earlier read of every page is kept." : "";
  if (!list.length) {
    const why = `the crawl lists no sitemap page that answers 200${listed.length ? ` (${listed.length} in the sitemap, none answering)` : ""}`;
    keep<ReadinessRun>(RUN, { at: now(), pages: 0, read: 0, why, site: false });
    throw new Error(`Nothing to read: ${why}.${keptLine}`);
  }
  const put = db.prepare(UPSERT);
  let ready = 0;
  let judged = 0;
  let read = 0;
  const failures = new Map<string, number>();
  for (const [i, p] of list.entries()) {
    progress(i, list.length, p.path);
    const got = await politely(p.url);
    if (got.status !== 200 || !got.html) {
      const why = got.status === 200 ? "answered 200 with nothing in it" : answered(got);
      failures.set(why, (failures.get(why) ?? 0) + 1);
      keepFailure(p.path, got.status, why);
      continue;
    }
    read++;
    const checks = judgePage(got.html, p.kind, lastmods.get(p.path) ?? null);
    put.run(p.path, now(), got.status, JSON.stringify({ checks } satisfies Stored));
    const applying = checks.filter((c) => c.state !== "n/a");
    if (applying.length) {
      judged++;
      if (applying.every((c) => c.state === "pass")) ready++;
    }
  }
  const failed = list.length - read;
  const sorted = [...failures.entries()].sort((a, b) => b[1] - a[1]);
  const why = !sorted.length ? null : sorted.length === 1 ? sorted[0]![0] : sorted.map(([w, n]) => `${w} for ${n}`).join(", ");

  if (!read) {
    keep<ReadinessRun>(RUN, { at: now(), pages: list.length, read: 0, why, site: false });
    throw new Error(`None of the ${list.length} sitemap pages could be read: the website ${why}.${keptLine}`);
  }

  /* A page that left the sitemap leaves this table. Only after a run that read the site: one that could not must erase nothing. */
  const keepPaths = new Set(listed.map((p) => p.path));
  for (const r of db.prepare("SELECT path FROM cc_seo_readiness").all() as { path: string }[]) if (!keepPaths.has(r.path)) db.prepare("DELETE FROM cc_seo_readiness WHERE path = ?").run(r.path);
  progress(list.length, list.length, "site-wide checks");
  const site = await siteChecks();
  keep("seo:readiness:site", site);
  keep<ReadinessRun>(RUN, { at: now(), pages: list.length, read, why, site: true });
  const failing = site.checks.filter((c) => c.state === "fail").length;
  const unknown = site.checks.filter((c) => c.state === "unknown").length;
  return `${read} of ${list.length} pages read: ${ready} of ${judged} pass every check that applies; ${failed ? `${failed} could not be read (${why}) and keep their earlier read; ` : ""}${failing} of ${site.checks.length} site-wide checks fail${unknown ? `, ${unknown} could not be read` : ""}`;
}

/**
 * Read ONE page again now and judge it: a person's "Check again" after the
 * page changed, without waiting for the daily run. The same polite clock as
 * the job. A page that does not answer 200 keeps its last good read, and the
 * answer says how it answered.
 */
export async function checkPage(path: string): Promise<{ ok: true; checks: ReadinessCheck[]; checkedAt: string } | { ok: false; why: string; kept: boolean }> {
  const p = siteView().byPath.get(path);
  if (!p) return { ok: false, why: `The crawl knows no page at ${path}.`, kept: false };
  if (!p.inSitemap) return { ok: false, why: `${path} is not in the sitemap; the readiness check reads the sitemap's pages.`, kept: false };
  const got = await politely(p.url);
  if (got.status !== 200 || !got.html) {
    const why = got.status === 200 ? "answered 200 with nothing in it" : answered(got);
    return { ok: false, why: `${path} ${why}.`, kept: keepFailure(path, got.status, why) };
  }
  const lastmod = (lastSitemap()?.entries ?? []).find((e) => e.path === path)?.lastmod ?? null;
  const checks = judgePage(got.html, p.kind, lastmod);
  const at = now();
  db.prepare(UPSERT).run(path, at, 200, JSON.stringify({ checks } satisfies Stored));
  return { ok: true, checks, checkedAt: at };
}

/* ---------- reading it back ------------------------------------------------------------------ */

export function siteReadiness(): SiteReadiness | null {
  return kept<SiteReadiness>("seo:readiness:site")?.value ?? null;
}

export function pageReadiness(): { checkedAt: string | null; pages: PageReadiness[]; unread: number } {
  const view = siteView();
  const rows = db.prepare("SELECT path, checked_at, json FROM cc_seo_readiness ORDER BY path").all() as { path: string; checked_at: string; json: string }[];
  let checkedAt: string | null = null;
  let unread = 0;
  const pages: PageReadiness[] = [];
  for (const r of rows) {
    const v = json<Stored>(r.json, {});
    if (v.error) unread++;
    if (!v.checks) continue;
    if (!checkedAt || r.checked_at > checkedAt) checkedAt = r.checked_at;
    const p = view.byPath.get(r.path);
    const applying = v.checks.filter((c) => c.state !== "n/a");
    pages.push({
      path: r.path,
      title: p?.title ?? null,
      kind: p?.kind ?? null,
      lang: p?.lang ?? null,
      checks: v.checks,
      pass: applying.filter((c) => c.state === "pass").length,
      of: applying.length,
      ...(v.error ? { unread: { why: v.error, at: v.failedAt ?? r.checked_at } } : {}),
    });
  }
  return { checkedAt, pages, unread };
}

/** One page's checks from its last good read; `unread` says why the newest attempt failed, when it did. */
export function readinessOf(path: string): { checkedAt: string; checks: ReadinessCheck[]; unread: { why: string; at: string } | null } | null {
  const r = db.prepare("SELECT checked_at, json FROM cc_seo_readiness WHERE path = ?").get(path) as { checked_at: string; json: string } | undefined;
  const v = json<Stored>(r?.json, {});
  return r && v.checks ? { checkedAt: r.checked_at, checks: v.checks, unread: v.error ? { why: v.error, at: v.failedAt ?? r.checked_at } : null } : null;
}
