import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

/**
 * A URL in, the article out.
 *
 * Readability is the same algorithm Firefox's reader view uses, so it is
 * already tuned against the whole ugly web: cookie walls, share bars, related
 * boxes, newsletter interstitials. Writing a bespoke extractor for this would
 * be a month of work to arrive somewhere worse.
 *
 * This runs ON THE BOX, not on the workstation — it is a fetch and a parse,
 * not a model — so a link shared at midnight is read, titled and matched to
 * services straight away. Only the prose waits for the 4090.
 *
 * What it refuses, and why: anything that is not HTML (a PDF needs a
 * different reader, a video needs a transcript), anything over `MAX_BYTES`
 * (a 40 MB page is a mistake, and the box has 3.7 GB for everything), and
 * anything that yields less than `MIN_WORDS` of text — a paywall stub or a
 * cookie wall parses perfectly and says nothing, and an article written from
 * one would be invention with a citation stapled to it.
 */

const MAX_BYTES = 6_000_000;
const MIN_WORDS = 180;
const TIMEOUT_MS = 20_000;

/* A real browser's UA. Not to sneak past anything — half the web serves a
   near-empty shell to an unknown agent, and an empty shell reads as a
   paywall. Anything actually gated still fails the word count below. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export interface Extract {
  url: string;
  /** Where it ended up, if the link redirected. */
  finalUrl: string;
  site: string;
  title: string;
  author: string | null;
  published: string | null;
  /** The article as plain paragraphs, blank line between. */
  text: string;
  words: number;
  excerpt: string | null;
  lead: string | null;
}

export class ExtractError extends Error {
  constructor(
    message: string,
    /** A short reason the bot can say back to a person without apologising. */
    readonly kind: "fetch" | "type" | "size" | "empty" | "thin",
  ) {
    super(message);
  }
}

export function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>()"']+/i);
  if (!m) return null;
  /* Trailing punctuation belongs to the sentence, not the URL — except a
     closing bracket that has an opener inside the URL, which Wikipedia needs. */
  return m[0].replace(/[.,;:!?]+$/, "");
}

export async function extract(url: string): Promise<Extract> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new ExtractError(`could not reach it (${e instanceof Error ? e.message : e})`, "fetch");
  }

  if (!res.ok) throw new ExtractError(`the site answered ${res.status}`, "fetch");

  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml/i.test(type)) {
    throw new ExtractError(`that is ${type.split(";")[0] || "not a web page"}, and I only read web pages`, "type");
  }

  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) throw new ExtractError("that page is enormous", "size");

  const html = await res.text();
  if (html.length > MAX_BYTES) throw new ExtractError("that page is enormous", "size");

  /* jsdom shouts about every stylesheet it cannot parse and every script it
     will not run. None of it matters here and all of it would fill the log. */
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { url: res.url, virtualConsole });
  const doc = dom.window.document;

  const meta = (...names: string[]): string | null => {
    for (const n of names) {
      const el =
        doc.querySelector(`meta[property="${n}"]`) ??
        doc.querySelector(`meta[name="${n}"]`) ??
        doc.querySelector(`meta[itemprop="${n}"]`);
      const v = el?.getAttribute("content")?.trim();
      if (v) return v;
    }
    return null;
  };

  const article = new Readability(doc, { charThreshold: 250 }).parse();
  dom.window.close();

  if (!article?.textContent) throw new ExtractError("there is no article on that page that I can find", "empty");

  /* Readability returns the text with the page's own whitespace. Collapse
     runs of blank lines to one so paragraphs survive and the rest does not. */
  const text = article.textContent
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();

  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS) {
    throw new ExtractError(
      `only ${words} words came back — that is usually a paywall or a cookie wall rather than the article`,
      "thin",
    );
  }

  return {
    url,
    finalUrl: res.url,
    site: new URL(res.url).hostname.replace(/^www\./, ""),
    title: (article.title || meta("og:title", "twitter:title") || doc.title || "").trim(),
    author: article.byline?.trim() || meta("article:author", "author"),
    published: meta("article:published_time", "datePublished", "og:article:published_time"),
    text,
    words,
    excerpt: article.excerpt?.trim() || meta("og:description", "description"),
    lead: meta("og:image", "twitter:image"),
  };
}
