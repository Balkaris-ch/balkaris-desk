import { HTTPException } from "hono/http-exception";
import { db } from "../../db.ts";
import { inventory, page as pageDetail } from "../site/index.ts";
import { ownTitle, pageText, type Block, type Pack, type PageTarget } from "./packs.ts";

/**
 * The data the page tasks are given ("og", "schema", "links", "alt") and the
 * two search tasks ("keywords", "serp"): the desk's own records, cut to what
 * a small local model holds, each block saying where it came from.
 *
 * A page task is given the page's own words and nothing else to write from:
 * every figure and every name in the answer is then checked against exactly
 * those words (kinds.ts strayFigures, strayNames), so a share card or a FAQ
 * never states what the page does not.
 */

const refuse = (message: string): never => {
  throw new HTTPException(409, { message });
};

type Extra = Partial<Pack> & { blocks: Block[] };

const block = (name: string, label: string, asOf: string | null, text: string): Block => ({ name, label, source: "crawl", asOf, state: "ok", text });

/** One page, as the crawl read it, with the start of its text. */
export async function pageTarget(path: string, chars: number): Promise<{ target: PageTarget; asOf: string | null; h2s: string[] }> {
  const d = pageDetail(path);
  if (d.state !== "ok") return refuse(`The crawl has not read ${path}: ${d.reason}`);
  const v = d.value;
  if (v.status !== 200) return refuse(`${path} answers ${v.status || "nothing"}, not 200: there is no page to work on.`);
  const text = await pageText(path, chars);
  if (!text) return refuse(`The text of ${path} could not be read from the live site just now, and the operator writes only from what the page says. Try again when the site answers.`);
  const h2s = v.facts?.h2s ?? [];
  const own = [v.title, v.description, v.h1, ...h2s, text].filter(Boolean).join("\n");
  return {
    target: { path, title: ownTitle(v.title), description: v.description, h1: v.h1, ogTitle: v.facts?.og.title ?? null, ogDescription: v.facts?.og.description ?? null, schemaTypes: v.facts?.schemaTypes ?? [], own },
    asOf: d.asOf,
    h2s,
  };
}

const pageLines = (t: PageTarget, h2s: string[], text: boolean): string[] => [
  `path: ${t.path}`,
  `title (the site adds " | Balkaris" itself): ${t.title ?? "none"}`,
  `description: ${t.description ?? "none"}`,
  `main heading: ${t.h1 ?? "none"}`,
  ...(h2s.length ? [`section headings: ${h2s.slice(0, 12).join(" | ")}`] : []),
  ...(text ? [`the page's own text: ${t.own.split("\n").slice(-1)[0]}`] : []),
];

export async function ogPack(path: string): Promise<Extra> {
  const { target, asOf, h2s } = await pageTarget(path, 900);
  const lines = [...pageLines(target, h2s, true), `current share title: ${target.ogTitle ?? "none"}`, `current share description: ${target.ogDescription ?? "none"}`];
  return { page: target, blocks: [block("page", `Page ${path}`, asOf, `PAGE\n${lines.join("\n")}`)] };
}

export async function schemaPack(path: string, asked: "FAQPage" | "Service" | undefined): Promise<Extra> {
  const { target, asOf, h2s } = await pageTarget(path, 2000);
  const printed = target.schemaTypes;
  const type = asked ?? (printed.includes("FAQPage") ? "Service" : "FAQPage");
  if (printed.includes(type)) refuse(`${path} prints ${type} already (it prints ${printed.join(", ")}): a second block would repeat it.`);
  const lines = [...pageLines(target, h2s, true), `structured data it prints already: ${printed.length ? printed.join(", ") : "none"}`];
  return { page: target, schemaType: type, blocks: [block("page", `Page ${path}`, asOf, `PAGE\n${lines.join("\n")}`)] };
}

const STOP = new Set(["the", "and", "for", "with", "your", "our", "you", "what", "how", "why", "balkaris", "page", "from", "that", "this", "are", "der", "die", "das", "und", "mit", "für"]);
const words = (s: string | null | undefined): string[] => (s ?? "").toLowerCase().split(/[^a-z0-9äöüéèàç]+/).filter((w) => w.length > 2 && !STOP.has(w));

/** Most pages one links task weighs. */
const LINK_CANDIDATES = 8;

/**
 * Pages that could link to this one: live pages in the sitemap that do not
 * link to it from their text yet, ranked by the words they share with it
 * (its address, title and heading). The rules choose; the model only picks
 * and words the link.
 */
export async function linksPack(path: string): Promise<Extra> {
  const { target, asOf } = await pageTarget(path, 500);
  const inv = inventory();
  if (inv.state !== "ok") return refuse(inv.reason);
  const already = new Set((db.prepare("SELECT source FROM cc_links WHERE target = ? AND internal = 1 AND place = 'main'").all(path) as { source: string }[]).map((r) => r.source));
  const mine = new Set([...words(path), ...words(target.title), ...words(target.h1)]);
  const scored = inv.value
    .filter((r) => r.path !== path && r.status === 200 && r.inSitemap && !already.has(r.path))
    .map((r) => {
      let score = 0;
      for (const w of new Set([...words(r.path), ...words(r.title), ...words(r.h1)])) if (mine.has(w)) score++;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.r.path.localeCompare(b.r.path))
    .slice(0, LINK_CANDIDATES);
  if (!scored.length) refuse(`No live page shares a word with ${path} and lacks a link to it from its text: there is nothing to suggest.`);
  const linkFrom = scored.map((x) => ({ path: x.r.path, title: x.r.title }));
  const lines = [
    `TARGET (the page that should get links)`,
    ...pageLines(target, [], true),
    `pages linking to it from their text now: ${already.size ? [...already].slice(0, 8).join(", ") : "none"}`,
    "",
    "CANDIDATES (pages that could link to it; none does from its text yet)",
    ...scored.map((x) => `- ${x.r.path}: ${x.r.title ?? "no title"}${x.r.h1 ? ` / heading: ${x.r.h1}` : ""}`),
  ];
  return { page: target, linkFrom, blocks: [block("links", "The crawl's link graph", asOf, lines.join("\n"))] };
}

/** Most pictures one alt task describes. */
const ALT_MOST = 10;

export async function altPack(path: string): Promise<Extra> {
  const d = pageDetail(path);
  if (d.state !== "ok") return refuse(d.reason);
  const imgs = (d.value.facts?.images ?? []).filter((i) => i.alt === "absent" && !i.hidden).slice(0, ALT_MOST);
  if (!imgs.length) refuse(`Every picture on ${path} has an alt attribute at the last crawl: there is nothing to write.`);
  const { target, asOf, h2s } = await pageTarget(path, 900);
  const images = imgs.map((i) => ({ src: i.file ?? i.remoteUrl ?? i.remote ?? "?", near: null }));
  const lines = [...pageLines(target, h2s, true), "", "PICTURES WITHOUT AN ALT TEXT (the file name is all that is known of each)", ...images.map((i) => `- ${i.src}`)];
  return { page: target, images, blocks: [block("pictures", `Pictures on ${path}`, asOf, lines.join("\n"))] };
}

/** Most phrases one keywords task sorts: a small model judges thirty well, not a hundred. */
export const KEYWORDS_MOST = 30;

export function keywordsPack(ids: number[] | undefined): Extra {
  const rows = (
    ids?.length
      ? (db.prepare(`SELECT id, phrase FROM cc_seo_keywords WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { id: number; phrase: string }[])
      : (db.prepare("SELECT id, phrase FROM cc_seo_keywords WHERE status = 'unjudged' ORDER BY last_seen DESC, id DESC LIMIT ?").all(KEYWORDS_MOST) as { id: number; phrase: string }[])
  ).slice(0, KEYWORDS_MOST);
  if (!rows.length) refuse(ids?.length ? "None of those phrases is tracked any more." : "No tracked phrase waits for a judgement.");
  const clusters = db.prepare("SELECT key, name FROM cc_seo_clusters ORDER BY COALESCE(rank, 999), name LIMIT 25").all() as { key: string; name: string }[];
  const topics = clusters.map((r) => r.name);
  const inv = inventory();
  const services = inv.state === "ok" ? inv.value.filter((r) => r.status === 200 && r.inSitemap && /service|hub/i.test(r.kindLabel)).map((r) => ownTitle(r.title) ?? r.path).slice(0, 30) : [];
  const lines = [
    "THE AGENCY — Balkaris, a Swiss creative and digital studio. What its website offers (its service pages, as the crawl read them):",
    ...(services.length ? services.map((s) => `- ${s}`) : ["- (the crawl has not read the service pages)"]),
    "",
    `TOPICS (the desk's own groups): ${topics.length ? topics.join(" | ") : "none yet"}`,
    "",
    "PHRASES",
    ...rows.map((r) => `- ${r.phrase}`),
  ];
  return { phrases: rows, topics, topicKeys: Object.fromEntries(clusters.map((c) => [c.name, c.key])), blocks: [{ name: "keywords", label: "Tracked searches", source: "desk", asOf: new Date().toISOString(), state: "ok", text: lines.join("\n") }] };
}

/** The structured-data types a read competitor page holds, whatever shape the column keeps them in. */
function typesOf(raw: string): string {
  try {
    const v = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(v)) return "";
    return v
      .map((x) => (typeof x === "string" ? x : typeof x === "object" && x !== null ? String((x as Record<string, unknown>)["@type"] ?? (x as Record<string, unknown>).type ?? "") : ""))
      .filter(Boolean)
      .join(", ");
  } catch {
    return "";
  }
}

interface SerpRow {
  id: number;
  phrase: string;
  done_at: string | null;
  result: string | null;
  own_position: number | null;
}

/** The kept result pages a "serp" task can read, newest first. */
export function serpChoices(limit = 12): { id: number; phrase: string; doneAt: string | null; ownPosition: number | null }[] {
  try {
    return (db.prepare("SELECT id, phrase, done_at, own_position FROM cc_seo_serp_checks WHERE state = 'done' AND result IS NOT NULL ORDER BY done_at DESC, id DESC LIMIT ?").all(limit) as unknown as SerpRow[]).map((r) => ({
      id: r.id,
      phrase: r.phrase,
      doneAt: r.done_at,
      ownPosition: r.own_position,
    }));
  } catch {
    return [];
  }
}

/**
 * A kept result page, the competitor pages the desk read for its search, and
 * our page for it: what the first results have is then in the data, and the
 * model only compares.
 */
export async function serpPack(serpId: number | undefined, path: string | undefined): Promise<Extra> {
  const r = (
    serpId
      ? db.prepare("SELECT id, phrase, done_at, result, own_position FROM cc_seo_serp_checks WHERE id = ? AND state = 'done'").get(serpId)
      : db.prepare("SELECT id, phrase, done_at, result, own_position FROM cc_seo_serp_checks WHERE state = 'done' AND result IS NOT NULL ORDER BY done_at DESC, id DESC LIMIT 1").get()
  ) as SerpRow | undefined;
  if (!r || !r.result) return refuse(serpId ? `There is no finished result page #${serpId}.` : "The desk keeps no result page yet: check a search on the Keywords or Competitors screen first.");
  const res = JSON.parse(r.result) as { organic?: { position: number; title: string; url: string; host: string; snippet: string }[]; questions?: string[]; related?: string[] };
  const organic = (res.organic ?? []).slice(0, 10);
  if (!organic.length) refuse(`The result page for "${r.phrase}" holds no results to compare with.`);
  const comp = db.prepare("SELECT url, title, h1, words, schema, price_text FROM cc_seo_comp_pages WHERE query = ? AND status = 200 ORDER BY words DESC LIMIT 8").all(r.phrase) as {
    url: string;
    title: string | null;
    h1: string | null;
    words: number | null;
    schema: string;
    price_text: string | null;
  }[];
  const mapped = path ?? (db.prepare("SELECT page FROM cc_seo_keywords WHERE phrase = ? AND page IS NOT NULL").get(r.phrase.toLowerCase().replace(/\s+/g, " ").trim()) as { page: string } | undefined)?.page;
  let ours: string[] = ["OUR PAGE: none is mapped to this search."];
  let target: PageTarget | undefined;
  if (mapped) {
    const d = pageDetail(mapped);
    if (d.state === "ok" && d.value.status === 200) {
      const v = d.value;
      const text = await pageText(mapped, 600);
      target = { path: mapped, title: ownTitle(v.title), description: v.description, h1: v.h1, ogTitle: null, ogDescription: null, schemaTypes: v.facts?.schemaTypes ?? [], own: [v.title, v.description, v.h1, ...(v.facts?.h2s ?? []), text].filter(Boolean).join("\n") };
      ours = [
        `OUR PAGE: ${mapped}${r.own_position ? `, result ${r.own_position} on this page` : ", not among the first ten"}`,
        `title: ${v.title ?? "none"} / heading: ${v.h1 ?? "none"} / ${v.words ?? "?"} words / structured data: ${v.facts?.schemaTypes?.join(", ") || "none"}`,
        ...(v.facts?.h2s?.length ? [`section headings: ${v.facts.h2s.slice(0, 10).join(" | ")}`] : []),
        ...(text ? [`the start of its text: ${text}`] : []),
      ];
    }
  }
  const lines = [
    `SEARCH: "${r.phrase}", read ${r.done_at?.slice(0, 10) ?? "on an unknown day"}.`,
    "FIRST RESULTS (position. title — address: snippet)",
    ...organic.map((o) => `${o.position}. ${o.title} — ${o.url}: ${o.snippet.slice(0, 160)}`),
    ...(res.questions?.length ? [`People also ask: ${res.questions.slice(0, 6).join(" | ")}`] : []),
    "",
    comp.length ? "THEIR PAGES AS THE DESK READ THEM (address | title | heading | words | structured data | price)" : "THEIR PAGES: the desk has not read any of them yet.",
    ...comp.map((c) => `- ${c.url} | ${c.title ?? "?"} | ${c.h1 ?? "?"} | ${c.words ?? "?"} words | ${typesOf(c.schema) || "none"} | ${c.price_text ?? "no price shown"}`),
    "",
    ...ours,
  ];
  return {
    ...(target ? { page: target } : {}),
    serp: { checkId: r.id, phrase: r.phrase, checkedAt: r.done_at, urls: [...new Set([...organic.map((o) => o.url), ...comp.map((c) => c.url)])] },
    blocks: [{ name: "serp", label: `Results for "${r.phrase}"`, source: "desk", asOf: r.done_at, state: "ok", text: lines.join("\n") }],
  };
}
