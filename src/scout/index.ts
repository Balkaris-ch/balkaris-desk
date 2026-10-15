import { db, log } from "../db.ts";
import { takeLink } from "../intake.ts";
import { languageOf } from "../language.ts";
import { match } from "../match.ts";
import { everyone, getPerson, type Person } from "../people.ts";
import { esc, send, edit, type Keyboard } from "../telegram.ts";
import type { Job } from "../cc/scheduler.ts";
import { note, setState, state } from "../cc/store.ts";
import { feedOf, FeedError, readSource, type Item, type SourceKind } from "./feeds.ts";

/**
 * THE SCOUT: it hunts the web for what the journal should write about, and
 * feeds what it finds into the same pipeline a shared link takes.
 *
 * Fini, 15 October 2026: "build one of these local AI agents to go hunt the
 * web and automatically create posts on Balkaris ... 3 to 5 times a day, or I
 * want to select ... it should not consume so much power ... I should have
 * states of that execution ... not just what we follow but also external: find
 * good sources, a scoring system, and if a channel gets good scores the AI goes
 * to that channel again."
 *
 * WHERE THE WORK HAPPENS. Finding and scoring run here on the server, with no
 * model: reading feeds is a few requests, and scoring is the desk's own service
 * matcher (match.ts) plus how fresh and how talked-about an item is, plus how
 * good its source has proved. Only what is chosen reaches the workstation's
 * local model, as an ordinary link: so 3 to 5 posts a day cost the workstation
 * 15 to 20 minutes and cost no Claude usage at all.
 *
 * THE STATES OF A FIND, all visible on the desk (Insights › Scout):
 *   found      read from a source and scored
 *   offered    put to the group in Telegram with buttons, waiting for a person
 *   queued     handed to the writer (it then shows in Insights like any link)
 *   skipped    a person said no, or it never scored high enough and aged out
 *   failed     the writer could not use it (its reason is on the link)
 * and "published" is read from the link's article when it goes live.
 *
 * THE MODES (one switch, changeable any time):
 *   auto       it chooses and publishes up to `perDay` a day by itself
 *   mix        it publishes up to `autoNews` of the clearest news a day by
 *              itself, and offers the next best to the group for a person to pick
 *   select     it only offers; nothing is written until somebody taps
 *   off        it reads nothing
 *
 * SOURCES EARN THEIR VISITS. Each has a score from 0 to 100, worked out every
 * night from what came of its finds: kept, published, and the views those
 * articles got (GA4, 30 days). A good source is read every hour, an average
 * one every three, a weak one twice a day, and one that has given nothing in a
 * month is paused. New sources come from the publishers Google News surfaces:
 * the desk finds each one's own feed and tries it as a "trial" source.
 */

/* ---------- tables and settings ----------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_scout_sources (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL,
    url         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    origin      TEXT NOT NULL DEFAULT 'seed',
    score       REAL NOT NULL DEFAULT 50,
    finds       INTEGER NOT NULL DEFAULT 0,
    kept        INTEGER NOT NULL DEFAULT 0,
    published   INTEGER NOT NULL DEFAULT 0,
    views       INTEGER NOT NULL DEFAULT 0,
    last_checked TEXT,
    last_ok     TEXT,
    last_error  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS cc_scout_finds (
    id          INTEGER PRIMARY KEY,
    source_id   INTEGER NOT NULL,
    url         TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    summary     TEXT,
    published_at TEXT,
    found_at    TEXT NOT NULL DEFAULT (datetime('now')),
    signal      INTEGER NOT NULL DEFAULT 0,
    score       REAL NOT NULL DEFAULT 0,
    kind        TEXT NOT NULL DEFAULT 'news',
    why         TEXT,
    state       TEXT NOT NULL DEFAULT 'found',
    link_id     INTEGER,
    tg_chat     INTEGER,
    tg_msg      INTEGER,
    decided_by  TEXT,
    decided_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS cc_scout_finds_state ON cc_scout_finds (state, score);
`);

export type Mode = "auto" | "mix" | "select" | "off";
export interface ScoutSettings {
  mode: Mode;
  /** Posts a day the Scout may start, by itself and by a person's tap together. */
  perDay: number;
  /** In "mix": how many of those it may publish by itself. */
  autoNews: number;
  /** The score a find needs before it is published without a person (0-100). */
  autoMin: number;
  /** Where offers and news go: a Telegram chat, set with /scout here. */
  chat: number | null;
}
const SETTINGS = "scout.settings";
const DEFAULT: ScoutSettings = { mode: "mix", perDay: 4, autoNews: 2, autoMin: 70, chat: null };

export function settings(): ScoutSettings {
  try {
    const s = { ...DEFAULT, ...(JSON.parse(state(SETTINGS) ?? "{}") as Partial<ScoutSettings>) };
    const n = (v: unknown, lo: number, hi: number, d: number) => (Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : d);
    return {
      mode: ["auto", "mix", "select", "off"].includes(s.mode) ? s.mode : DEFAULT.mode,
      perDay: n(s.perDay, 0, 10, DEFAULT.perDay),
      autoNews: n(s.autoNews, 0, 10, DEFAULT.autoNews),
      autoMin: n(s.autoMin, 30, 100, DEFAULT.autoMin),
      chat: Number.isInteger(Number(s.chat)) && s.chat !== null ? Number(s.chat) : null,
    };
  } catch {
    return { ...DEFAULT };
  }
}
export function saveSettings(next: Partial<ScoutSettings>): ScoutSettings {
  setState(SETTINGS, JSON.stringify({ ...settings(), ...next }));
  return settings();
}

/* ---------- the first sources ------------------------------------------------- */

/* Every one of these answered the desk's server on 15 October 2026. Two that
   did not (VentureBeat, Search Engine Land: a bot wall) are left out. */
const SEED: { kind: SourceKind; url: string; name: string }[] = [
  { kind: "rss", url: "https://techcrunch.com/category/artificial-intelligence/feed/", name: "TechCrunch AI" },
  { kind: "rss", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", name: "The Verge AI" },
  { kind: "rss", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed", name: "MIT Technology Review AI" },
  { kind: "rss", url: "https://arstechnica.com/ai/feed/", name: "Ars Technica AI" },
  { kind: "rss", url: "https://the-decoder.com/feed/", name: "The Decoder" },
  { kind: "rss", url: "https://openai.com/news/rss.xml", name: "OpenAI news" },
  { kind: "rss", url: "https://blog.google/technology/ai/rss/", name: "Google AI blog" },
  { kind: "rss", url: "https://www.marketingdive.com/feeds/news/", name: "Marketing Dive" },
  { kind: "gnews", url: "https://news.google.com/rss/search?q=artificial+intelligence+business&hl=en-CH&gl=CH&ceid=CH:en", name: "Google News: AI in business" },
  { kind: "gnews", url: "https://news.google.com/rss/search?q=generative+AI+video&hl=en-CH&gl=CH&ceid=CH:en", name: "Google News: generative AI video" },
  { kind: "gnews", url: "https://news.google.com/rss/search?q=AI+marketing+agency&hl=en-CH&gl=CH&ceid=CH:en", name: "Google News: AI marketing" },
  { kind: "gnews", url: "https://news.google.com/rss/search?q=AI+Switzerland&hl=en-CH&gl=CH&ceid=CH:en", name: "Google News: AI Switzerland" },
  { kind: "hn", url: "https://hn.algolia.com/api/v1/search?tags=front_page", name: "Hacker News front page" },
  { kind: "reddit", url: "https://www.reddit.com/r/artificial/top/.rss?t=day", name: "Reddit r/artificial" },
  { kind: "youtube", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCbfYPyITQ-7l4upoX8nvctg", name: "Two Minute Papers" },
  { kind: "youtube", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UChpleBmo18P08aKCIgti38g", name: "Matt Wolfe" },
  { kind: "youtube", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCNJ1Ymd5yFuUPtn21xtRbbw", name: "AI Explained" },
  { kind: "youtube", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCP7jMXSY2xbc3KCAE0MHQ-A", name: "Google DeepMind" },
];

function seed(): void {
  const add = db.prepare("INSERT OR IGNORE INTO cc_scout_sources (kind, url, name, origin) VALUES (?, ?, ?, 'seed')");
  for (const s of SEED) add.run(s.kind, s.url, s.name);
}
seed();

/* ---------- reading sources --------------------------------------------------- */

interface SourceRow {
  id: number;
  kind: SourceKind;
  url: string;
  name: string;
  status: string;
  origin: string;
  score: number;
  last_checked: string | null;
}

/** Minutes between visits, by how good a source has proved. A trial source is read every three hours until it shows what it is. */
const everyMinutes = (s: SourceRow): number => (s.status === "trial" ? 180 : s.score >= 70 ? 60 : s.score >= 40 ? 180 : 720);

const due = (s: SourceRow): boolean =>
  s.status !== "paused" && (!s.last_checked || Date.now() - Date.parse(`${s.last_checked.replace(" ", "T")}Z`) >= everyMinutes(s) * 60_000);

/* Words that put an item in the journal's world: AI, the tools, and the work Balkaris sells. */
const OURS = /\b(ai|a\.i\.|artificial intelligence|llms?|gpt[- ]?\d*|chatgpt|claude|gemini|openai|anthropic|mistral|deepmind|copilot|machine learning|generative|genai|agents?|agentic|automation|automate|chatbots?|seo|search engine|marketing|advert\w*|branding|video|website|e-?commerce|crm|startups?)\b/i;

/** 0-100: what this item is worth to the journal, with the reasons. */
export function scoreItem(it: Item, sourceScore: number, kind: SourceKind): { score: number; why: string; format: "news" | "standard" } {
  const text = `${it.title}. ${it.summary}`;
  const m = match(it.title, it.summary);
  const ours = (text.match(new RegExp(OURS.source, "gi")) ?? []).length;
  const relevance = Math.min(40, m.services.length * 10 + Math.min(m.topicScore, 10) + Math.min(ours, 4) * 4);
  const hours = it.published ? (Date.now() - Date.parse(it.published)) / 3_600_000 : 48;
  const fresh = hours <= 12 ? 25 : hours <= 24 ? 20 : hours <= 48 ? 12 : hours <= 24 * 7 ? 5 : 0;
  const talked = kind === "hn" ? Math.min(15, Math.round(it.signal / 30)) : 0;
  const trust = Math.round((sourceScore / 100) * 20);
  const score = Math.max(0, Math.min(100, relevance + fresh + talked + trust));
  const why = [
    m.services.length ? `about ${m.services.map((s) => s.slug).slice(0, 2).join(", ")}` : ours ? "on the journal's subjects" : "off our subjects",
    hours <= 48 ? `${Math.max(1, Math.round(hours))} h old` : `${Math.round(hours / 24)} days old`,
    talked ? `${it.signal} points and comments on Hacker News` : "",
    `source scores ${Math.round(sourceScore)}`,
  ]
    .filter(Boolean)
    .join(", ");
  return { score, why, format: hours <= 48 && kind !== "youtube" ? "news" : "standard" };
}

/** Read every source that is due; keep the new, English, on-subject items as finds. */
async function readDue(): Promise<{ read: number; added: number; failed: number; discovered: string[] }> {
  const rows = db.prepare("SELECT * FROM cc_scout_sources ORDER BY score DESC").all() as unknown as SourceRow[];
  const known = new Set((db.prepare("SELECT url FROM links").all() as { url: string }[]).map((r) => r.url.replace(/\/$/, "")));
  let read = 0;
  let added = 0;
  let failed = 0;
  /* Publishers Google News surfaced, with how often: one that appears once is as likely a small local paper as a good source. */
  const publishers = new Map<string, number>();
  for (const s of rows.filter(due).slice(0, 12)) {
    read += 1;
    let items: Item[];
    try {
      items = await readSource(s.kind, s.url);
      db.prepare("UPDATE cc_scout_sources SET last_checked = datetime('now'), last_ok = datetime('now'), last_error = NULL WHERE id = ?").run(s.id);
    } catch (e) {
      failed += 1;
      const why = e instanceof FeedError ? e.message : e instanceof Error ? e.message : String(e);
      db.prepare("UPDATE cc_scout_sources SET last_checked = datetime('now'), last_error = ? WHERE id = ?").run(why.slice(0, 200), s.id);
      continue;
    }
    for (const it of items.slice(0, 40)) {
      if (it.publisherSite) publishers.set(it.publisherSite, (publishers.get(it.publisherSite) ?? 0) + 1);
      /* A Google News link leads back to Google, not to the article: those are read for their publishers, not kept as finds. */
      if (s.kind === "gnews") continue;
      const url = it.url.replace(/[?&]utm_[^&]+/g, "").replace(/\/$/, "");
      if (known.has(url)) continue;
      if (!OURS.test(`${it.title} ${it.summary}`)) continue;
      if (!languageOf(`${it.title}\n${it.summary}`).english) continue;
      const sc = scoreItem(it, s.score, s.kind);
      const r = db
        .prepare("INSERT OR IGNORE INTO cc_scout_finds (source_id, url, title, summary, published_at, signal, score, kind, why) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(s.id, url, it.title.slice(0, 300), it.summary.slice(0, 600), it.published, it.signal, sc.score, sc.format, sc.why);
      if (r.changes) {
        added += 1;
        db.prepare("UPDATE cc_scout_sources SET finds = finds + 1 WHERE id = ?").run(s.id);
      }
    }
    /* One request a second at most, across all sources. */
    await new Promise((r) => setTimeout(r, 1_000));
  }
  const often = [...publishers].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([site]) => site);
  return { read, added, failed, discovered: await discover(often) };
}

/** New sources from the publishers Google News surfaced: at most three a run, each tried as "trial". */
async function discover(sites: string[]): Promise<string[]> {
  const have = new Set((db.prepare("SELECT url FROM cc_scout_sources").all() as { url: string }[]).map((r) => new URL(r.url).hostname.replace(/^www\./, "")));
  const tried = new Set<string>(JSON.parse(state("scout.tried") ?? "[]") as string[]);
  const out: string[] = [];
  for (const site of sites) {
    if (out.length >= 3) break;
    let host: string;
    try {
      host = new URL(site).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (have.has(host) || tried.has(host)) continue;
    tried.add(host);
    try {
      const feed = await feedOf(site);
      if (!feed) continue;
      const r = db.prepare("INSERT OR IGNORE INTO cc_scout_sources (kind, url, name, status, origin, score) VALUES ('rss', ?, ?, 'trial', 'found', 40)").run(feed.url, feed.name);
      if (r.changes) out.push(feed.name);
    } catch {
      /* a site that will not show its feed is simply not a source */
    }
  }
  setState("scout.tried", JSON.stringify([...tried].slice(-500)));
  if (out.length) note("insight", `The Scout found ${out.length} new source${out.length === 1 ? "" : "s"} to try`, { tone: "info", detail: out.join(", "), href: "/insights?tab=scout" });
  return out;
}

/* ---------- deciding ------------------------------------------------------------ */

interface FindRow {
  id: number;
  source_id: number;
  url: string;
  title: string;
  summary: string | null;
  published_at: string | null;
  found_at: string;
  score: number;
  kind: "news" | "standard";
  why: string | null;
  state: string;
  link_id: number | null;
}

/** Started in the last 24 hours, by the Scout itself and by a person's tap on an offer: "a day" as a rolling window, so a quota never resets twice. */
function startedToday(): { all: number; auto: number } {
  const r = db
    .prepare("SELECT COUNT(*) all_n, SUM(CASE WHEN decided_by = 'Scout' THEN 1 ELSE 0 END) auto_n FROM cc_scout_finds WHERE state = 'queued' AND decided_at >= datetime('now', '-24 hours')")
    .get() as { all_n: number; auto_n: number | null };
  return { all: r.all_n, auto: r.auto_n ?? 0 };
}

const owner = (): Person | null => everyone().find((p) => p.owner && p.canPublish) ?? null;

/** Hand a find to the writer, as the person who chose it (their byline) or, for the Scout itself, the owner. */
export async function queueFind(id: number, format: "news" | "standard", by: Person | null, decidedBy: string): Promise<{ ok: boolean; line: string }> {
  const f = db.prepare("SELECT * FROM cc_scout_finds WHERE id = ?").get(id) as FindRow | undefined;
  if (!f) return { ok: false, line: "The Scout has no such find." };
  if (f.state === "queued") return { ok: false, line: "It is already with the writer." };
  const who = by ?? owner();
  const s = settings();
  const got = await takeLink(`${f.url} ${format === "news" ? "news" : "standard"}`, {
    chat: s.chat ?? undefined,
    user: who?.telegram,
    name: who?.name ?? "Scout",
    note: `Found by the Scout: ${f.why ?? ""}`.slice(0, 300),
  });
  if (!got) return { ok: false, line: "The writer did not take it." };
  db.prepare("UPDATE cc_scout_finds SET state = 'queued', link_id = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(got.id, decidedBy, id);
  db.prepare("UPDATE cc_scout_sources SET kept = kept + 1 WHERE id = ?").run(f.source_id);
  log("scout.queued", { find: id, format, by: decidedBy }, got.id);
  return { ok: true, line: got.already ? "The desk already had this link; it is shown in Insights." : `Queued ${format === "news" ? "as news" : "as an article"}: it is in Insights now.` };
}

export function skipFind(id: number, by: string): boolean {
  const r = db.prepare("UPDATE cc_scout_finds SET state = 'skipped', decided_by = ?, decided_at = datetime('now') WHERE id = ? AND state IN ('found', 'offered')").run(by, id);
  return r.changes > 0;
}

const offerKeys = (id: number): Keyboard => [
  [
    { text: "News", data: `s:${id}:news` },
    { text: "Article", data: `s:${id}:standard` },
    { text: "Skip", data: `s:${id}:skip` },
  ],
];

/** Put the best finds not yet offered to the chosen chat, each with its buttons. */
async function offer(n: number): Promise<number> {
  const s = settings();
  if (!s.chat || n <= 0) return 0;
  const rows = db.prepare("SELECT * FROM cc_scout_finds WHERE state = 'found' AND found_at >= datetime('now', '-2 days') ORDER BY score DESC LIMIT ?").all(n) as unknown as FindRow[];
  for (const f of rows) {
    const src = (db.prepare("SELECT name FROM cc_scout_sources WHERE id = ?").get(f.source_id) as { name: string } | undefined)?.name ?? "a source";
    const text = `<b>Scout</b> · ${Math.round(f.score)}/100 · ${esc(src)}\n\n<b>${esc(f.title)}</b>\n${esc((f.summary ?? "").slice(0, 220))}\n\n${esc(f.url)}\n<i>${esc(f.why ?? "")}</i>`;
    const msg = await send(s.chat, text, undefined, offerKeys(f.id));
    db.prepare("UPDATE cc_scout_finds SET state = 'offered', tg_chat = ?, tg_msg = ? WHERE id = ?").run(s.chat, msg, f.id);
  }
  return rows.length;
}

/** A tap on an offer's button: News, Article or Skip. Answers with a sentence for the button's toast. */
export async function answerOffer(data: string, chat: number, from: { id: number; name: string }): Promise<string | null> {
  const m = /^s:(\d+):(news|standard|skip)$/.exec(data);
  if (!m) return null;
  const id = Number(m[1]);
  const f = db.prepare("SELECT * FROM cc_scout_finds WHERE id = ?").get(id) as (FindRow & { tg_chat: number | null; tg_msg: number | null }) | undefined;
  if (!f || f.tg_chat !== chat) return "That find is not in this chat.";
  if (f.state !== "offered" && f.state !== "found") return f.state === "queued" ? "Already with the writer." : "Already decided.";
  let line: string;
  if (m[2] === "skip") {
    skipFind(id, from.name);
    line = `Skipped by ${from.name}.`;
  } else {
    const out = await queueFind(id, m[2] as "news" | "standard", getPerson(from.id), from.name);
    line = out.ok ? `${m[2] === "news" ? "News" : "Article"}: chosen by ${from.name}.` : out.line;
  }
  if (f.tg_msg) await edit(chat, f.tg_msg, `<b>${esc(f.title)}</b>\n${esc(f.url)}\n\n<i>${esc(line)}</i>`, []);
  return line;
}

/** The decision for this run, by the mode. */
async function decide(): Promise<string> {
  const s = settings();
  if (s.mode === "off" || s.perDay === 0) return "";
  const today = startedToday();
  const left = Math.max(0, s.perDay - today.all);
  if (!left) return "; today's posts are done";
  const said: string[] = [];

  const autoLeft = s.mode === "auto" ? left : s.mode === "mix" ? Math.max(0, Math.min(left, s.autoNews - today.auto)) : 0;
  if (autoLeft) {
    const best = db
      .prepare("SELECT * FROM cc_scout_finds WHERE state IN ('found', 'offered') AND score >= ? AND found_at >= datetime('now', '-2 days') ORDER BY score DESC LIMIT ?")
      .all(s.autoMin, s.mode === "auto" ? 1 : autoLeft) as unknown as FindRow[];
    /* One at a time in auto, spread over the day: a run every half hour starts at most one. */
    for (const f of best.slice(0, 1)) {
      const out = await queueFind(f.id, f.kind, null, "Scout");
      if (out.ok) said.push(`started "${f.title.slice(0, 60)}"`);
    }
  }

  /* Offers: in mix and select, twice a day (09 and 15 Zurich), enough to fill what is left. */
  if (s.mode !== "auto") {
    const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hour12: false }));
    const slot = hour >= 15 ? "pm" : hour >= 9 ? "am" : null;
    const key = `scout.offered.${new Date().toISOString().slice(0, 10)}.${slot}`;
    if (slot && !state(key)) {
      const n = await offer(Math.min(5, left + 1));
      setState(key, String(n));
      if (n) said.push(`offered ${n} in Telegram`);
    }
  }

  /* Finds nobody chose age out after three days. */
  db.prepare("UPDATE cc_scout_finds SET state = 'skipped', decided_by = 'aged out', decided_at = datetime('now') WHERE state IN ('found', 'offered') AND found_at < datetime('now', '-3 days')").run();
  return said.length ? `; ${said.join("; ")}` : "";
}

/* ---------- scoring the sources --------------------------------------------- */

/** Nightly: each source's score from what its finds became. */
async function scoreSources(): Promise<number> {
  const views = new Map<string, number>();
  try {
    const { pages } = await import("../cc/ga4.ts");
    const got = await pages("30d");
    for (const r of got.data?.rows ?? []) views.set(r.path.replace(/\/$/, ""), r.views);
  } catch {
    /* without GA4 the score is from kept and published alone */
  }
  const rows = db.prepare("SELECT id, status, origin, finds, created_at FROM cc_scout_sources").all() as { id: number; status: string; origin: string; finds: number; created_at: string }[];
  let changed = 0;
  for (const s of rows) {
    const kept = (db.prepare("SELECT COUNT(*) n FROM cc_scout_finds WHERE source_id = ? AND state = 'queued'").get(s.id) as { n: number }).n;
    const pub = db
      .prepare("SELECT d.slug FROM cc_scout_finds f JOIN drafts d ON d.link_id = f.link_id WHERE f.source_id = ? AND d.state = 'listed'")
      .all(s.id) as { slug: string }[];
    const seen = pub.reduce((sum, p) => sum + (views.get(`/insights/${p.slug}`) ?? 0), 0);
    const recent = (db.prepare("SELECT COUNT(*) n FROM cc_scout_finds WHERE source_id = ? AND found_at >= datetime('now', '-30 days')").get(s.id) as { n: number }).n;
    const keptRate = s.finds ? kept / s.finds : 0;
    const score = Math.max(0, Math.min(100, 30 + Math.min(20, recent) + 40 * keptRate + 8 * pub.length + Math.min(25, seen / 4)));
    const ageDays = (Date.now() - Date.parse(`${s.created_at.replace(" ", "T")}Z`)) / 86_400_000;
    let status = s.status;
    if (s.status === "trial" && pub.length > 0) status = "active";
    if (s.status === "trial" && ageDays > 14 && kept === 0) status = "paused";
    if (s.status === "active" && s.origin !== "person" && recent === 0 && ageDays > 30) status = "paused";
    db.prepare("UPDATE cc_scout_sources SET score = ?, kept = ?, published = ?, views = ?, status = ? WHERE id = ?").run(Math.round(score), kept, pub.length, seen, status, s.id);
    changed += 1;
  }
  setState("scout.scored", new Date().toISOString());
  return changed;
}

/* ---------- the job ------------------------------------------------------------- */

export const scoutJob: Job = {
  name: "scout",
  title: "Scout: find what the journal should write about",
  every: 30 * 60,
  delay: 120,
  run: async () => {
    const s = settings();
    if (s.mode === "off") return "Switched off.";
    const r = await readDue();
    /* Once a night, the sources are scored again. */
    const last = state("scout.scored");
    if (!last || Date.now() - Date.parse(last) > 20 * 3_600_000) await scoreSources();
    const decided = await decide();
    return `${r.read} source${r.read === 1 ? "" : "s"} read, ${r.added} new find${r.added === 1 ? "" : "s"}${r.failed ? `, ${r.failed} did not answer` : ""}${r.discovered.length ? `, ${r.discovered.length} new source${r.discovered.length === 1 ? "" : "s"} to try` : ""}${decided}`;
  },
};

export const jobs: Job[] = [scoutJob];

/* ---------- what a screen and the bot read ---------------------------------- */

export function overview(): {
  settings: ScoutSettings;
  today: { all: number; auto: number };
  finds: (FindRow & { source: string; published: boolean; liveSlug: string | null })[];
  sources: (SourceRow & { finds: number; kept: number; published: number; views: number; last_ok: string | null; last_error: string | null; every: number })[];
} {
  const finds = db
    .prepare(
      `SELECT f.*, s.name AS source,
              (SELECT d.slug FROM drafts d WHERE d.link_id = f.link_id AND d.state = 'listed' ORDER BY d.id DESC LIMIT 1) AS liveSlug
         FROM cc_scout_finds f JOIN cc_scout_sources s ON s.id = f.source_id
        WHERE f.found_at >= datetime('now', '-7 days') OR f.state IN ('found', 'offered')
        ORDER BY CASE f.state WHEN 'offered' THEN 0 WHEN 'found' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, f.score DESC
        LIMIT 120`,
    )
    .all() as unknown as (FindRow & { source: string; liveSlug: string | null })[];
  const sources = db.prepare("SELECT * FROM cc_scout_sources ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'trial' THEN 1 ELSE 2 END, score DESC").all() as unknown as (SourceRow & {
    finds: number;
    kept: number;
    published: number;
    views: number;
    last_ok: string | null;
    last_error: string | null;
  })[];
  return {
    settings: settings(),
    today: startedToday(),
    finds: finds.map((f) => ({ ...f, published: !!f.liveSlug })),
    sources: sources.map((s) => ({ ...s, every: everyMinutes(s) })),
  };
}

/** A source a person adds: a feed, a YouTube channel feed, or any site whose feed the desk can find. */
export async function addSource(input: string): Promise<{ ok: boolean; line: string }> {
  let u: URL;
  try {
    u = new URL(input.trim().startsWith("http") ? input.trim() : `https://${input.trim()}`);
  } catch {
    return { ok: false, line: "That is not an address." };
  }
  if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) return { ok: false, line: "Only a public website can be a source." };
  let kind: SourceKind = "rss";
  let url = u.toString();
  let name = u.hostname.replace(/^www\./, "");
  if (/youtube\.com$/.test(u.hostname) && u.searchParams.get("channel_id")) kind = "youtube";
  else if (/reddit\.com$/.test(u.hostname)) {
    kind = "reddit";
    if (!/\.rss/.test(u.pathname)) url = `${u.origin}${u.pathname.replace(/\/$/, "")}/top/.rss?t=day`;
  } else {
    try {
      const items = await readSource("rss", url);
      if (!items.length) throw new Error("no items");
    } catch {
      const feed = await feedOf(url).catch(() => null);
      if (!feed) return { ok: false, line: "The desk could not find a news feed on that site." };
      url = feed.url;
      name = feed.name;
    }
  }
  const r = db.prepare("INSERT OR IGNORE INTO cc_scout_sources (kind, url, name, status, origin, score) VALUES (?, ?, ?, 'active', 'person', 60)").run(kind, url, name);
  return r.changes ? { ok: true, line: `Added ${name}. The Scout reads it on its next run.` } : { ok: false, line: "The Scout already reads that source." };
}

export function setSourceStatus(id: number, status: "active" | "paused"): boolean {
  return db.prepare("UPDATE cc_scout_sources SET status = ? WHERE id = ?").run(status, id).changes > 0;
}

/** /scout in Telegram: the state in a few lines. */
export function statusText(): string {
  const o = overview();
  const s = o.settings;
  const modeWord = { auto: "Automatic", mix: "Mix (clearest news by itself, the rest offered)", select: "You select", off: "Off" }[s.mode];
  const waiting = o.finds.filter((f) => f.state === "offered" || f.state === "found").length;
  const active = o.sources.filter((x) => x.status !== "paused").length;
  return [
    "<b>Scout</b>",
    `Mode: <b>${modeWord}</b>`,
    `Today: ${o.today.all} of ${s.perDay} started${s.mode === "mix" ? ` (${o.today.auto} by itself)` : ""}`,
    `Waiting: ${waiting} finds · Sources: ${active} read, ${o.sources.length - active} paused`,
    s.chat ? "" : "\nNo chat chosen for offers: send /scout here in the chat that should get them.",
    "\n/scout auto · /scout mix · /scout select · /scout off · /scout here",
  ]
    .filter(Boolean)
    .join("\n");
}
