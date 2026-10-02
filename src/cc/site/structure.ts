import { keep, kept } from "../store.ts";
import { filesUnder, head, read } from "./repo.ts";

/**
 * What the website's source says about its own shape.
 *
 * A served page cannot tell the desk three things, and the sitemap leaves
 * them out on purpose:
 *
 *   - which pages exist but are kept out of the index (the unwritten
 *     marketing placeholders, the boards held in reserve, the articles the
 *     desk has published but nobody has listed yet);
 *   - which marketing page is for a kind of business and which for a kind of
 *     work (content/marketing.ts says `of: "segment"` or `of: "service"`);
 *   - which old addresses the site promises to keep answering (the redirects
 *     in next.config, and the ones approved on the desk that it reads from
 *     content/desk/overrides.json).
 *
 * All of it is read as TEXT from the branch, with patterns, because the desk
 * cannot run the website's TypeScript. That is brittle by nature, so every
 * reader here fails soft: a file that moved or changed shape yields an empty
 * list, the crawl goes on without that knowledge, and nothing is invented to
 * fill the gap.
 *
 * Read once per commit: the answer is kept beside the commit id it was read
 * at and asked for again only when the branch has moved.
 */

export interface RosterEntry {
  /** The page's address. */
  path: string;
  /** A kind of work, or a kind of business: the roster's own field. */
  of: "service" | "segment";
  /** False while the page is the placeholder: live, noindex, not in the sitemap. */
  written: boolean;
  /** What the menu's marquee calls it. */
  title: string;
}

export interface RedirectRule {
  /** As next.config writes it; may hold a `:param`. */
  source: string;
  destination: string;
  permanent: boolean;
  /** Where the rule is written: next.config itself, or approved on the desk (content/desk/overrides.json). */
  by: "config" | "desk";
}

export interface Structure {
  /** The commit this was read at. */
  head: string;
  /** Every page with a fixed address: each page file under app/ that has no [param] in its path. */
  routes: string[];
  /** Articles the desk wrote whose file says `listed: false`: live at their address, noindex, in no sitemap. */
  unlisted: string[];
  /** The marketing pages (content/marketing.ts). */
  roster: RosterEntry[];
  /** The redirects next.config promises. */
  redirects: RedirectRule[];
  /** The share picture a page has when nobody made one for it (lib/site.ts `ogImage`), site-relative. */
  defaultShare: string | null;
}

/** A page file's address: route groups "(site)" vanish, a "[param]" or a private folder means it has no single address. */
function routeOf(file: string): string | null {
  const m = /^app\/(?:(.*)\/)?page\.(?:tsx|ts|jsx|js|mdx)$/.exec(file);
  if (!m) return null;
  const parts = (m[1] ?? "").split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  if (parts.some((s) => s.includes("[") || s.startsWith("@") || s.startsWith("_"))) return null;
  return `/${parts.join("/")}`;
}

/** Lines that are only a comment, removed, so a rule that was commented out is not counted as a promise. */
const withoutCommentLines = (text: string): string =>
  text
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join("\n");

async function roster(): Promise<RosterEntry[]> {
  const text = await read("content/marketing.ts");
  if (!text) return [];
  const code = withoutCommentLines(text);

  /* `import { aiVideo } from "./ai-video"` : which file a name comes from. */
  const from = new Map<string, string>();
  for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\/([^"]+)"/g)) {
    for (const name of (m[1] as string).split(",")) from.set(name.trim().split(/\s+as\s+/).pop() as string, m[2] as string);
  }

  const out: RosterEntry[] = [];
  for (const m of code.matchAll(/\{\s*title:\s*"([^"]*)",\s*href:\s*([^,]+),([^}]*)\}/g)) {
    const [, title = "", expr = "", rest = ""] = m;
    const of = /\bof:\s*"(service|segment)"/.exec(rest)?.[1] as "service" | "segment" | undefined;
    if (!of) continue;

    let href: string | null = /^"(\/[^"]*)"$/.exec(expr.trim())?.[1] ?? null;
    if (!href) {
      /* `commercial.marketed.href`: the address is written in that page's own content file. */
      const name = /^(\w+)\.marketed\.href$/.exec(expr.trim())?.[1];
      const file = name ? from.get(name) : undefined;
      const source = file ? await read(`content/${file}.ts`) : null;
      href = source ? (/marketed:\s*\{[^}]*?href:\s*"(\/[^"]*)"/.exec(withoutCommentLines(source))?.[1] ?? null) : null;
    }
    if (href) out.push({ path: href, of, written: !/\bwritten:\s*false\b/.test(rest), title });
  }
  return out;
}

async function redirects(): Promise<RedirectRule[]> {
  let text: string | null = null;
  for (const name of ["next.config.ts", "next.config.mjs", "next.config.js"]) {
    text = await read(name);
    if (text) break;
  }
  if (!text) return [];
  const at = text.indexOf("redirects()");
  if (at < 0) return [];
  const code = withoutCommentLines(text.slice(at));

  const rules: RedirectRule[] = [];
  /* The site writes its rules through a one-line helper: service("/old", "/new"), always permanent. */
  for (const m of code.matchAll(/\b\w+\(\s*"(\/[^"]*)"\s*,\s*"(\/[^"]*)"\s*\)/g)) {
    rules.push({ source: m[1] as string, destination: m[2] as string, permanent: true, by: "config" });
  }
  /* And the plain shape, should one ever be written out in full. */
  for (const m of code.matchAll(/source:\s*"(\/[^"]*)"\s*,\s*destination:\s*"([^"]*)"(?:\s*,\s*permanent:\s*(true|false))?/g)) {
    rules.push({ source: m[1] as string, destination: m[2] as string, permanent: m[3] !== "false", by: "config" });
  }
  rules.push(...(await deskRedirects(rules)));
  return rules;
}

/**
 * The redirects a person approved on the desk. next.config reads them from
 * content/desk/overrides.json at build time (its `deskRedirects()`), keeping
 * only a plain address to a plain address, never onto itself, the first rule
 * for an address winning. The same filter is applied here, so the desk
 * checks exactly the rules the build serves. No file, or one that will not
 * parse, is no rules: the build does the same.
 */
async function deskRedirects(before: RedirectRule[]): Promise<RedirectRule[]> {
  const text = await read("content/desk/overrides.json");
  if (!text) return [];
  let file: { redirects?: unknown };
  try {
    file = JSON.parse(text) as { redirects?: unknown };
  } catch {
    return [];
  }
  const plain = (v: unknown): v is string => typeof v === "string" && /^\/[a-z0-9][a-z0-9/_-]*$/i.test(v) && v.length <= 200;
  const seen = new Set(before.map((r) => r.source));
  const out: RedirectRule[] = [];
  for (const r of Array.isArray(file.redirects) ? file.redirects : []) {
    const { from, to } = (r ?? {}) as { from?: unknown; to?: unknown };
    if (!plain(from) || !(plain(to) || to === "/") || from === to || seen.has(from)) continue;
    seen.add(from);
    out.push({ source: from, destination: to, permanent: true, by: "desk" });
  }
  return out;
}

async function unlisted(): Promise<string[]> {
  const out: string[] = [];
  for (const f of await filesUnder("content/posts")) {
    if (!f.path.endsWith(".ts") || f.path.endsWith("/index.ts")) continue;
    const text = await read(f.path);
    if (!text || !/\blisted:\s*false\b/.test(text)) continue;
    const slug = /\bslug:\s*"([^"]+)"/.exec(text)?.[1] ?? f.path.split("/").pop()?.replace(/\.ts$/, "");
    if (slug) out.push(`/insights/${slug}`);
  }
  return out;
}

/* The cache key carries a version: when the readers above learn something
   new, the answer kept for the current commit is read again, not trusted. */
const KEY = "site:structure:2";

/**
 * The website's shape at the commit the desk has fetched. Null before the
 * first fetch, or when there is no read copy of the repository.
 */
export async function structure(): Promise<Structure | null> {
  const at = await head();
  if (!at) return null;
  const had = kept<Structure>(KEY);
  if (had && had.value.head === at) return had.value;

  const routes = (await filesUnder("app")).map((f) => routeOf(f.path)).filter((r): r is string => r !== null);
  const siteTs = await read("lib/site.ts");
  const value: Structure = {
    head: at,
    routes: [...new Set(routes)].sort(),
    unlisted: await unlisted(),
    roster: await roster(),
    redirects: await redirects(),
    defaultShare: siteTs ? (/\bogImage:\s*"(\/[^"]+)"/.exec(siteTs)?.[1] ?? null) : null,
  };
  keep(KEY, value);
  return value;
}
