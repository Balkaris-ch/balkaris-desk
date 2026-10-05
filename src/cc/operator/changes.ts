import { db } from "../../db.ts";
import type { DeskJsonLdBlock, ProposalKind, ProposalRow } from "../../../web/src/contract/operator.ts";
import { decode } from "../seo/html.ts";
import { abs, get, UA } from "../site/http.ts";
import { inventory, lastSitemap, page as pageDetail } from "../site/index.ts";
import { figuresIn, strayFigures, strayNames } from "./kinds.ts";
import { ownTitle, pageText, shownTitle } from "./packs.ts";
import { pictureBytes } from "./pictures.ts";
import { blockProblem, blockWords, foreignLinks, isAddress, LIMIT, OG_IMAGE, pictureProblem, textProblem, type OverridesFile } from "./rules.ts";
import { SITE, uploadedPicture } from "./tables.ts";

/**
 * The four kinds of change the website's overrides v2 added: a share card
 * ("og"), out of or back into search ("index"), a canonical address, and a
 * structured-data block ("schema"). Each has, here:
 *
 *   before        what the live page shows now, as the crawl read it
 *   refusal       the rules, asked of the desk's own records (fast)
 *   liveRefusal   the rules that need the live site or the page's own text
 *   applyTo       its fields written into the page's entry
 *   undo          its fields taken out again, on Withdraw
 *   holds         whether the site's file already says it
 *   readBack      whether the live page shows it, after the deploy
 *
 * The rules are the website's (work/audit/OVERRIDES-V2.md, rules.ts) and the
 * desk's stricter ones: never a field that copies another, never noindex on
 * the home page or beside a canonical, never a canonical that is a chain, and
 * never a structured-data block that says what the page does not.
 */

export type SiteKind = "og" | "index" | "canonical" | "schema";
export const isSiteKind = (k: string): k is SiteKind => k === "og" || k === "index" || k === "canonical" || k === "schema";

type After = ProposalRow["after"];
type Before = ProposalRow["before"];

const OPEN = "('waiting','approved','applied')";

/** What the crawl read on the live page: the "before" of a proposal. */
export function beforeOf(kind: ProposalKind, address: string): Before {
  const d = pageDetail(address);
  const f = d.state === "ok" ? d.value.facts : null;
  const v = d.state === "ok" ? d.value : null;
  switch (kind) {
    case "og":
      return { ogTitle: f?.og.title ?? null, ogDescription: f?.og.description ?? null, ogImage: f?.og.image ?? null };
    case "index":
      return { noindex: /noindex/i.test(f?.robots ?? "") || (v ? !v.indexable && v.status === 200 && !v.inSitemap : false) };
    case "canonical":
      return { canonical: f?.canonical ?? null };
    case "schema":
      return { schemaTypes: f?.schemaTypes ?? [] };
    case "redirect":
      return { to: null };
    default:
      return { title: v?.title ?? null, description: v?.description ?? null };
  }
}

/** Proposals that are waiting or live, with their after, for one kind. */
function open(kind: ProposalKind, except: number[]): { id: number; address: string; state: string; after: After }[] {
  return (db.prepare(`SELECT id, address, state, after_json FROM cc_proposals WHERE kind = ? AND state IN ${OPEN}`).all(kind) as { id: number; address: string; state: string; after_json: string }[])
    .filter((r) => !except.includes(r.id))
    .map((r) => ({ id: r.id, address: r.address, state: r.state, after: JSON.parse(r.after_json) as After }));
}

/** The page answered 200 at the last crawl, and no redirect leaves from it. */
function pageRefusal(address: string): string | null {
  if (!isAddress(address)) return `"${address}" is not a page address the website matches: "/" or lower-case segments with no trailing slash, as the page's own canonical names it.`;
  const inv = inventory();
  if (inv.state !== "ok") return `The desk has no crawl to tell whether ${address} is a page: ${inv.reason}`;
  const row = inv.value.find((r) => r.path === address);
  if (!row || row.status !== 200) return `${address} is not a page that answered 200 at the last crawl.`;
  if (open("redirect", []).some((r) => r.address === address)) return `A redirect from ${address} is waiting or live: the page is on its way out, so it gets no other change.`;
  return null;
}

/** Why this change may not be proposed (or approved), by the desk's own records; null when it may. */
export function refusal(kind: SiteKind, address: string, after: After, except: number[]): string | null {
  const page = pageRefusal(address);
  if (page) return page;
  switch (kind) {
    case "og": {
      if (after.ogTitle === undefined && after.ogDescription === undefined && after.ogImage === undefined) return "It changes nothing: give a share title, a share description or a share picture.";
      if (after.ogTitle !== undefined) {
        const p = textProblem("The share title", after.ogTitle, LIMIT.title);
        if (p) return p;
      }
      if (after.ogDescription !== undefined) {
        const p = textProblem("The share description", after.ogDescription, LIMIT.description);
        if (p) return p;
      }
      if (after.ogImage !== undefined && (after.ogImage.length > LIMIT.path || !OG_IMAGE.test(after.ogImage))) {
        return `"${after.ogImage}" is not a picture address the website accepts: site-relative and lower case, ending in .png, .jpg, .jpeg or .webp, like /desk/og/seo-1a2b3c4d.jpg.`;
      }
      /* A copy adds nothing: the site already uses the title and description on the card. */
      const d = pageDetail(address);
      if (d.state === "ok") {
        const metaOpen = open("meta", []).filter((r) => r.address === address && r.state === "applied");
        const title = metaOpen.find((r) => r.after.title !== undefined)?.after.title ?? ownTitle(d.value.title);
        const description = metaOpen.find((r) => r.after.description !== undefined)?.after.description ?? d.value.description;
        if (after.ogTitle !== undefined && title && after.ogTitle.trim() === title.trim()) return "The share title is the same as the page's title, which the card uses already: it adds nothing.";
        if (after.ogDescription !== undefined && description && after.ogDescription.trim() === description.trim()) return "The share description is the same as the page's description, which the card uses already: it adds nothing.";
      }
      return null;
    }
    case "index": {
      if (typeof after.noindex !== "boolean") return "Say whether the page goes out of search (noindex: true) or back in (noindex: false).";
      if (after.noindex && address === "/") {
        return "The home page can never be taken out of search: it would leave the sitemap, the journal feed and llms.txt, and search engines would drop the site's front door. The website ignores it anyway.";
      }
      const mine = open("index", except).filter((r) => r.address === address);
      if (after.noindex) {
        if (open("canonical", []).some((r) => r.address === address)) return `${address} has a canonical waiting or live: a page carries noindex or a canonical, never both (the website would apply noindex and ignore the canonical). Withdraw or reject that first.`;
        const pointing = open("canonical", []).filter((r) => r.after.canonical === address);
        if (pointing.length) return `${pointing.map((r) => r.address).join(", ")} ${pointing.length === 1 ? "names" : "name"} ${address} as canonical: out of search, it would undo ${pointing.length === 1 ? "that" : "those"}.`;
        if (mine.some((r) => r.after.noindex === true && r.state === "applied")) return `${address} is out of search already, by an approved change.`;
      } else if (!open("index", []).some((r) => r.address === address && r.after.noindex === true && r.state === "applied")) {
        return `The desk never took ${address} out of search, so it has nothing to put back. If the page is out of search, the website keeps it out for its own reasons (a placeholder, an unpublished article), which only its code changes.`;
      }
      return null;
    }
    case "canonical": {
      const to = after.canonical;
      if (typeof to !== "string" || !isAddress(to)) return `"${to ?? ""}" is not an address of this site the website accepts: "/" or lower-case segments, no dots, no trailing slash.`;
      if (to === address) return "A page cannot name itself as canonical: it is already its own.";
      if (address === "/") return "The home page can never be given a canonical.";
      const map = lastSitemap();
      if (!map) return "The desk has no reading of the sitemap yet, so it cannot tell whether the target is a page search engines count. The crawl reads it; run it first.";
      if (!map.entries.some((e) => e.path === to)) return `${to} is not in the sitemap: a canonical must point at a page search engines count (answers 200, not out of search, not canonical elsewhere).`;
      const inv = inventory();
      const target = inv.state === "ok" ? inv.value.find((r) => r.path === to) : undefined;
      if (!target || target.status !== 200) return `${to} did not answer 200 at the last crawl.`;
      if (open("index", []).some((r) => r.address === address && r.after.noindex === true)) return `${address} is going out of search (noindex): a page carries noindex or a canonical, never both.`;
      if (open("index", []).some((r) => r.address === to && r.after.noindex === true)) return `${to} is going out of search (noindex): a canonical pointing there would be ignored.`;
      if (open("canonical", except).some((r) => r.address === to)) return `${to} has a canonical of its own waiting or live: the website applies only the last link of a chain.`;
      if (open("canonical", except).some((r) => r.after.canonical === address)) return `Another page names ${address} as canonical: a chain is refused.`;
      return null;
    }
    case "schema": {
      const b = after.jsonLd;
      const p = blockProblem(b);
      if (p) return p;
      const block = b as DeskJsonLdBlock;
      const type = block["@type"];
      if (type === "Organization" || type === "LocalBusiness") return `Every page prints the company's Organization and its offices (a LocalBusiness) already. Point at it with "@id": "${SITE}/#organization" instead.`;
      if (type === "BreadcrumbList" && address !== "/") return "Every page but the home page prints its BreadcrumbList already.";
      const d = pageDetail(address);
      const printed = d.state === "ok" ? (d.value.facts?.schemaTypes ?? []) : [];
      if (printed.includes(type)) return `${address} prints ${type} already: a second would repeat it. The page prints ${printed.join(", ")}.`;
      const foreign = foreignLinks(block);
      if (foreign.length) return `It links outside the site (${foreign.slice(0, 2).join(", ")}): a block here describes only this site.`;
      const others = open("schema", except).filter((r) => r.address === address && r.state === "applied" && r.after.jsonLd?.["@type"] !== type);
      if (others.length >= LIMIT.blocks) return `${address} carries ${others.length} of the desk's blocks already; the website prints at most ${LIMIT.blocks}.`;
      return null;
    }
  }
}

/* ---------- what needs the live site ------------------------------------------------------ */

const PICTURE_TIMEOUT = 20_000;

/** A picture on the live site, as bytes. Never throws: a status and the reason. */
async function liveBytes(sitePath: string): Promise<{ status: number; bytes: Uint8Array | null; error?: string }> {
  try {
    const res = await fetch(abs(sitePath), { headers: { "user-agent": UA, accept: "image/*" }, redirect: "manual", signal: AbortSignal.timeout(PICTURE_TIMEOUT) });
    if (res.status !== 200) return { status: res.status, bytes: null };
    return { status: 200, bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch (e) {
    return { status: 0, bytes: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The bytes of a share picture: the desk's upload, or the file the live site serves. */
export async function pictureOf(sitePath: string): Promise<{ bytes: Uint8Array; uploaded: boolean } | { refused: string }> {
  const up = uploadedPicture(sitePath);
  if (up) return { bytes: pictureBytes(up.name)!.data, uploaded: true };
  if (/^\/desk\/og\//.test(sitePath)) return { refused: `${sitePath} is not a picture uploaded to the desk, nor one it committed: upload it again.` };
  const got = await liveBytes(sitePath);
  if (got.status !== 200 || !got.bytes) {
    return { refused: `${sitePath} could not be read on the live site (${got.status ? `it answered ${got.status}` : (got.error ?? "no answer")}), so the desk cannot tell whether the website would show it.` };
  }
  return { bytes: got.bytes, uploaded: false };
}

/** The page's own words, for the structured-data guards: what it says, as the crawl and the live page give it. */
async function ownWords(address: string): Promise<string | null> {
  const d = pageDetail(address);
  if (d.state !== "ok") return null;
  const v = d.value;
  const text = await pageText(address, 2000);
  if (!text) return null;
  return [v.title, v.description, v.h1, ...(v.facts?.h2s ?? []), text, "Balkaris www.balkaris.ch Switzerland Swiss"].filter(Boolean).join("\n");
}

/**
 * Why this change may not be made, asked of the live site and the page's own
 * text; null when it may. "propose": the picture is read and checked, and a
 * structured-data block is held against what the page says. "approve": the
 * same, and the page itself (and a canonical's target) must answer 200 on the
 * live site now.
 */
export async function liveRefusal(kind: SiteKind, address: string, after: After, at: "propose" | "approve"): Promise<string | null> {
  if (at === "approve") {
    const g = await get(abs(address), { maxHops: 0, body: false, timeout: 15_000 });
    if (g.status !== 200) return `${address} ${g.status ? `answers ${g.status}` : `could not be reached (${g.error ?? "no answer"})`} on the live site now, not 200: the website reads an entry only for a page that exists. Try again when the site answers.`;
  }
  if (kind === "og" && after.ogImage !== undefined) {
    const pic = await pictureOf(after.ogImage);
    if ("refused" in pic) return pic.refused;
    const p = pictureProblem(after.ogImage, pic.bytes);
    if (p) return p;
  }
  if (kind === "canonical" && at === "approve" && after.canonical) {
    const g = await get(abs(after.canonical), { maxHops: 0, body: false, timeout: 15_000 });
    if (g.status !== 200) return `${after.canonical} answers ${g.status || "nothing"} on the live site now, not 200: a canonical must point at a page that answers.`;
  }
  if (kind === "schema" && after.jsonLd) {
    const own = await ownWords(address);
    if (!own) return `The text of ${address} could not be read, so the desk cannot check that the block says only what the page says. Try again when the page answers.`;
    const words = blockWords(after.jsonLd).join("\n");
    const figures = strayFigures(words, figuresIn(own)).stray;
    if (figures.length) return `The block holds ${figures.slice(0, 4).join(", ")}, which ${address} does not say. Structured data may only repeat the page's own facts.`;
    const names = strayNames(words, own);
    if (names.length) return `The block names ${names.slice(0, 4).join(", ")}, which ${address} does not mention. Structured data may only repeat the page's own facts.`;
  }
  return null;
}

/* ---------- the entry in the site's file ------------------------------------------------- */

/** The page's entry, as a plain object, made if missing. */
const entryOf = (o: OverridesFile, address: string): Record<string, unknown> => {
  const e = o.meta[address];
  return e && typeof e === "object" && !Array.isArray(e) ? { ...e } : {};
};

const blockEq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Write the change into the file. Returns the picture to commit beside it, if it uploads one. */
export function applyTo(o: OverridesFile, kind: SiteKind, address: string, after: After): { path: string; content: Uint8Array } | null {
  const e = entryOf(o, address);
  let extra: { path: string; content: Uint8Array } | null = null;
  switch (kind) {
    case "og":
      if (after.ogTitle !== undefined) e.ogTitle = after.ogTitle;
      if (after.ogDescription !== undefined) e.ogDescription = after.ogDescription;
      if (after.ogImage !== undefined) {
        e.ogImage = after.ogImage;
        const up = uploadedPicture(after.ogImage);
        if (up) extra = { path: `public${up.sitePath}`, content: pictureBytes(up.name)!.data };
      }
      break;
    case "index":
      if (after.noindex) e.noindex = true;
      else delete e.noindex;
      break;
    case "canonical":
      e.canonical = after.canonical;
      break;
    case "schema": {
      const type = after.jsonLd!["@type"];
      const kept = Array.isArray(e.jsonLd) ? (e.jsonLd as { "@type"?: unknown }[]).filter((b) => b?.["@type"] !== type) : [];
      e.jsonLd = [...kept, after.jsonLd];
      break;
    }
  }
  if (Object.keys(e).length) o.meta[address] = e;
  else delete o.meta[address];
  return extra;
}

/**
 * Take the change out of the file again. `removed` is false when the file no
 * longer held it. A share picture the desk committed goes in the same commit,
 * unless another entry still names it.
 */
export function undo(o: OverridesFile, kind: SiteKind, address: string, after: After): { removed: boolean; dropPicture: string | null } {
  const e = entryOf(o, address);
  let removed = false;
  let dropPicture: string | null = null;
  switch (kind) {
    case "og":
      for (const k of ["ogTitle", "ogDescription", "ogImage"] as const) {
        if (after[k] !== undefined && e[k] === after[k]) {
          delete e[k];
          removed = true;
        }
      }
      break;
    case "index":
      if (after.noindex && e.noindex === true) {
        delete e.noindex;
        removed = true;
      } else if (!after.noindex && e.noindex === undefined) {
        e.noindex = true;
        removed = true;
      }
      break;
    case "canonical":
      if (e.canonical === after.canonical) {
        delete e.canonical;
        removed = true;
      }
      break;
    case "schema":
      if (Array.isArray(e.jsonLd)) {
        const kept = (e.jsonLd as unknown[]).filter((b) => !blockEq(b, after.jsonLd));
        removed = kept.length !== e.jsonLd.length;
        if (kept.length) e.jsonLd = kept;
        else delete e.jsonLd;
      }
      break;
  }
  if (Object.keys(e).length) o.meta[address] = e;
  else delete o.meta[address];
  if (kind === "og" && after.ogImage && /^\/desk\/og\//.test(after.ogImage)) {
    const still = Object.values(o.meta).some((x) => x && typeof x === "object" && (x as Record<string, unknown>).ogImage === after.ogImage);
    if (!still) dropPicture = `public${after.ogImage}`;
  }
  return { removed, dropPicture };
}

/** Whether the file already says this change. */
export function holds(o: Partial<OverridesFile>, kind: SiteKind, address: string, after: After): boolean {
  const e = o.meta && typeof o.meta === "object" ? (o.meta as Record<string, Record<string, unknown>>)[address] : undefined;
  if (!e || typeof e !== "object") return kind === "index" && after.noindex === false;
  switch (kind) {
    case "og":
      return (["ogTitle", "ogDescription", "ogImage"] as const).every((k) => after[k] === undefined || e[k] === after[k]);
    case "index":
      return after.noindex ? e.noindex === true : e.noindex === undefined;
    case "canonical":
      return e.canonical === after.canonical;
    case "schema":
      return Array.isArray(e.jsonLd) && e.jsonLd.some((b) => blockEq(b, after.jsonLd));
  }
}

/* ---------- the words of the commit and the activity feed -------------------------------- */

export function verbOf(kind: ProposalKind, address: string, after: After): { applied: string; withdrawn: string; proposed: string } {
  switch (kind) {
    case "og":
      return { applied: `Applied a new share card for ${address}`, withdrawn: `Withdrew the share card for ${address}`, proposed: `Proposed a share card for ${address}` };
    case "index":
      return after.noindex
        ? { applied: `Took ${address} out of search`, withdrawn: `Put ${address} back in search (withdrawn)`, proposed: `Proposed taking ${address} out of search` }
        : { applied: `Put ${address} back in search`, withdrawn: `Took ${address} out of search again (withdrawn)`, proposed: `Proposed putting ${address} back in search` };
    case "canonical":
      return { applied: `Pointed ${address} at ${after.canonical}`, withdrawn: `Withdrew the canonical of ${address}`, proposed: `Proposed a canonical for ${address}` };
    case "schema":
      return { applied: `Added ${after.jsonLd?.["@type"] ?? "structured data"} to ${address}`, withdrawn: `Withdrew the ${after.jsonLd?.["@type"] ?? "structured data"} of ${address}`, proposed: `Proposed ${after.jsonLd?.["@type"] ?? "structured data"} for ${address}` };
    case "redirect":
      return { applied: `Applied a redirect from ${address}`, withdrawn: `Withdrew the redirect from ${address}`, proposed: `Proposed a redirect from ${address}` };
    default:
      return { applied: `Applied new metadata for ${address}`, withdrawn: `Withdrew the metadata for ${address}`, proposed: `Proposed metadata for ${address}` };
  }
}

/* ---------- reading the live page back after the deploy ---------------------------------- */

interface Head {
  title: string | null;
  meta: Map<string, string>;
  canonical: string | null;
  desk: string[];
}

/** The parts of a page's head the overrides reach, read from its HTML. */
export function readHead(html: string): Head {
  const meta = new Map<string, string>();
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const a of m[0].matchAll(/([a-z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi)) attrs.set(a[1]!.toLowerCase(), decode(a[3] ?? a[4] ?? ""));
    const k = attrs.get("property") ?? attrs.get("name");
    if (k && attrs.has("content") && !meta.has(k.toLowerCase())) meta.set(k.toLowerCase(), attrs.get("content")!);
  }
  const link = /<link\s[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(html)?.[0] ?? "";
  const desk: string[] = [];
  for (const s of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*data-desk[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(s[1]!.replace(/\\u003c/gi, "<")) as { "@type"?: unknown };
      desk.push(String(v["@type"] ?? ""));
    } catch {
      desk.push("");
    }
  }
  return {
    title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)![1]!.trim()) : null,
    meta,
    canonical: /href\s*=\s*["']([^"']*)["']/i.exec(link)?.[1] ?? null,
    desk,
  };
}

/** What the live page must show for this change (section 4 of the contract), and what it shows instead. */
export async function readBack(kind: ProposalKind, address: string, after: After): Promise<{ ok: boolean; line: string; missing: string[] }> {
  if (kind === "redirect") {
    const g = await get(abs(address), { maxHops: 0, body: false, timeout: 15_000 });
    const to = g.headers.location ? new URL(g.headers.location, abs(address)).pathname.replace(/\/+$/, "") || "/" : null;
    const ok = g.status >= 300 && g.status < 400 && to === after.to;
    return { ok, line: ok ? `${address} redirects to ${after.to} on the live site.` : `${address} answers ${g.status || "nothing"}${to ? ` to ${to}` : ""} on the live site, not a redirect to ${after.to}.`, missing: ok ? [] : ["redirect"] };
  }
  const g = await get(abs(address), { timeout: 20_000 });
  if (g.status !== 200 || !g.body) return { ok: false, line: `The live page could not be read: it answered ${g.status || (g.error ?? "nothing")}. Nothing is known about whether the change shows.`, missing: ["page"] };
  const h = readHead(g.body);
  const m = (k: string) => h.meta.get(k) ?? null;
  const missing: string[] = [];
  const want = (label: string, ok: boolean) => {
    if (!ok) missing.push(label);
  };
  let inMap: boolean | null = null;
  if (kind === "canonical" || kind === "index") {
    const s = await get(abs("/sitemap.xml"), { timeout: 20_000 });
    inMap = s.status === 200 && s.body ? s.body.includes(`<loc>${SITE}${address === "/" ? "" : address}</loc>`) || s.body.includes(`<loc>${SITE}${address}</loc>`) : null;
  }
  switch (kind) {
    case "meta":
      if (after.title !== undefined) want("title", h.title === shownTitle(after.title));
      if (after.description !== undefined) want("description", m("description") === after.description);
      break;
    case "og":
      if (after.ogTitle !== undefined) want("share title (og:title, twitter:title)", m("og:title") === after.ogTitle && m("twitter:title") === after.ogTitle);
      if (after.ogDescription !== undefined) want("share description (og:description, twitter:description)", m("og:description") === after.ogDescription && m("twitter:description") === after.ogDescription);
      if (after.ogImage !== undefined) {
        const url = `${SITE}${after.ogImage}`;
        const up = uploadedPicture(after.ogImage);
        want("share picture (og:image, twitter:image)", m("og:image") === url && m("twitter:image") === url);
        if (up) want("picture size (og:image:width, og:image:height)", m("og:image:width") === String(up.width) && m("og:image:height") === String(up.height));
      }
      break;
    case "index":
      if (after.noindex) {
        want('robots "noindex, follow"', /noindex/i.test(m("robots") ?? ""));
        if (inMap !== null) want("gone from sitemap.xml", !inMap);
      } else want("no noindex", !/noindex/i.test(m("robots") ?? ""));
      break;
    case "canonical":
      want("canonical link", h.canonical === `${SITE}${after.canonical}`);
      want("og:url", m("og:url") === `${SITE}${after.canonical}`);
      if (inMap !== null) want("gone from sitemap.xml", !inMap);
      break;
    case "schema":
      want(`a ${after.jsonLd?.["@type"] ?? ""} block marked data-desk`, h.desk.includes(String(after.jsonLd?.["@type"] ?? "")));
      break;
  }
  return missing.length
    ? { ok: false, line: `The live page does not show: ${missing.join(", ")}. The website ignores a field that breaks one of its rules without a word, or the deploy has not happened yet.`, missing }
    : { ok: true, line: "The live page shows the change." , missing: [] };
}
