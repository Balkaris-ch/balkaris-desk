import { Hono } from "hono";
import { db } from "../../db.ts";
import { requireOwner, type Vars, me } from "../access.ts";
import { audit, AUDIT, fetchGuarded, GaveUp, guardUrl, Refused, TooMany } from "../site/audit.ts";
import { addExtractRule, contentDuplicates, deleteExtractRule, extractResults, extractRules, toggleExtractRule } from "../site/crawl.ts";
import { parseWithRules, trialRule, validateRule } from "../site/extract.ts";
import { abs, pathOf as sitePath } from "../site/http.ts";
import { reading } from "../store.ts";
import type { ApiError, Reading } from "../../../web/src/contract/common.ts";
import type { ExtractKind, ExtractResults, ExtractRule, ExtractRuleInput, ExtractTry, SpiderAudit, SpiderAuditListed, SpiderDuplicates } from "../../../web/src/contract/spider.ts";

/**
 * /api/v1/spider — the crawler's tools beyond its daily read.
 *
 *   GET    /extract              owner   the custom extraction rules
 *   POST   /extract              owner   add one { name, kind, expression, attribute?, scope? };
 *                                        400 with the reason when it is refused
 *   POST   /extract/:id/toggle   owner   { enabled?: boolean }; without it, the other way
 *   DELETE /extract/:id          owner   the rule and everything it found
 *   GET    /extract/:id/results  owner   what it found at the last crawl, page by page
 *   POST   /extract/try          owner   { kind, expression, attribute?, path? } a rule
 *                                        tried NOW on one page of the site (the home
 *                                        page when no path), nothing kept; 400 the
 *                                        rule refused, 409 the page did not answer 200
 *   GET    /duplicates           anyone signed in: the duplicate-content findings
 *                                        of the last crawl as groups and pairs
 *   POST   /audit                anyone signed in: { url, fresh? } one page of any public
 *                                        website, fetched and judged by the crawl's
 *                                        page rules (src/cc/site/audit.ts); 400 when
 *                                        the address may not be fetched, 429 when
 *                                        the hour's audits are spent (the desk's
 *                                        30, or this person's 10), 504 when it
 *                                        was given up after 90 seconds. `fresh: true`
 *                                        fetches again instead of answering from the
 *                                        audit kept for the day (and counts against
 *                                        the hour like any fetch)
 *   GET    /audits               anyone signed in: the audits kept (a day), newest
 *                                        first; ?url= one of them whole (404 when
 *                                        none is kept), so an answer outlives the tab
 *
 * The rules change what every crawl does, so only the owner keeps them. A
 * rule added now runs from the next crawl. The server's gate already holds a
 * POST or DELETE that did not come from the desk's own pages (src/server.ts).
 * Types: web/src/contract/spider.ts.
 */
export const routes = new Hono<Vars>();

const KINDS: readonly ExtractKind[] = ["css", "regex", "xpath"];

const idOf = (raw: string): number | null => (/^\d{1,9}$/.test(raw) ? Number(raw) : null);

routes.get("/extract", requireOwner, (c) => c.json<ExtractRule[]>(extractRules()));

routes.post("/extract", requireOwner, async (c) => {
  const body = (await c.req.json().catch(() => null)) as Partial<Record<keyof ExtractRuleInput, unknown>> | null;
  if (!body || typeof body !== "object") return c.json<ApiError>({ error: 'Send { "name", "kind": "css" | "regex" | "xpath", "expression", "attribute"?, "scope"? }.' }, 400);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const kind = str(body.kind);
  if (!kind || !KINDS.includes(kind as ExtractKind)) return c.json<ApiError>({ error: 'The kind is "css", "regex" or "xpath".' }, 400);
  if (str(body.name) === null || str(body.expression) === null) return c.json<ApiError>({ error: "A rule needs a name and an expression, both text." }, 400);
  for (const k of ["attribute", "scope"] as const) {
    if (body[k] !== undefined && body[k] !== null && typeof body[k] !== "string") return c.json<ApiError>({ error: `"${k}" is text or null.` }, 400);
  }
  /* Checked, then timed on the desk's test page in the extraction thread (never in this one), then kept. */
  const added = await addExtractRule(
    { name: str(body.name) as string, kind: kind as ExtractKind, expression: str(body.expression) as string, attribute: str(body.attribute), scope: str(body.scope) },
    me(c).name,
  );
  if (!added.ok) return c.json<ApiError>({ error: added.reason }, 400);
  return c.json<ExtractRule>(added.rule, 201);
});

routes.post("/extract/:id/toggle", requireOwner, async (c) => {
  const id = idOf(c.req.param("id"));
  if (id === null) return c.json<ApiError>({ error: "There is no such rule." }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: unknown } | null;
  if (body?.enabled !== undefined && typeof body.enabled !== "boolean") return c.json<ApiError>({ error: 'Send { "enabled": true } or { "enabled": false }, or nothing to switch it the other way.' }, 400);
  const done = toggleExtractRule(id, body?.enabled as boolean | undefined);
  if (!done) return c.json<ApiError>({ error: "There is no such rule." }, 404);
  if (!done.ok) return c.json<ApiError>({ error: done.reason }, 409);
  return c.json<ExtractRule>(done.rule);
});

routes.delete("/extract/:id", requireOwner, (c) => {
  const id = idOf(c.req.param("id"));
  if (id === null || !deleteExtractRule(id)) return c.json<ApiError>({ error: "There is no such rule." }, 404);
  return c.json({ ok: true as const });
});

/**
 * How "Try it now" reads one of the site's pages: the audit's polite, guarded
 * fetch (one request a host every two seconds, 15 s, 2 MB). A check replaces it.
 */
export const tryWire = {
  fetch: (url: string): Promise<{ status: number; body: string | null; error: string | null; url: string }> => fetchGuarded(url),
};

/**
 * Try a rule on one page of the site NOW, before keeping it: the same checks
 * as adding one (its form, then its time on the desk's test page), then the
 * live page read once and the rule run on it alone. Nothing is kept.
 */
routes.post("/extract/try", requireOwner, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { kind?: unknown; expression?: unknown; attribute?: unknown; path?: unknown } | null;
  const kind = typeof body?.kind === "string" && KINDS.includes(body.kind as ExtractKind) ? (body.kind as ExtractKind) : null;
  if (!kind || typeof body?.expression !== "string") return c.json<ApiError>({ error: 'Send { "kind": "css" | "regex" | "xpath", "expression", "attribute"?, "path" }.' }, 400);
  if (body.attribute !== undefined && body.attribute !== null && typeof body.attribute !== "string") return c.json<ApiError>({ error: '"attribute" is text or null.' }, 400);
  const path = sitePath(typeof body.path === "string" && body.path.trim() ? body.path.trim() : "/");
  if (!path) return c.json<ApiError>({ error: "A rule is tried on one of the website's own pages: a path starting with /." }, 400);

  const valid = validateRule({ name: "Try", kind, expression: body.expression, attribute: (body.attribute as string | null | undefined) ?? null });
  if (!valid.ok) return c.json<ApiError>({ error: valid.reason }, 400);
  const timed = await trialRule({ kind: valid.rule.kind, expression: valid.rule.expression });
  if (!timed.ok) return c.json<ApiError>({ error: timed.reason }, 400);

  const url = abs(path);
  const got = await tryWire.fetch(url);
  if (got.status !== 200 || got.body === null) {
    return c.json<ApiError>({ error: `${path} ${got.status ? `answered ${got.status}` : "did not answer"}${got.error ? ` (${got.error})` : ""}, so there was nothing to try the rule on.` }, 409);
  }
  const ran = await parseWithRules(got.body, got.url, [{ id: 0, kind: valid.rule.kind, expression: valid.rule.expression, attribute: valid.rule.attribute }], new URL(url).host);
  const found = ran.found[0] ?? { rule: 0, matches: [], count: 0 };
  return c.json<ExtractTry>({ path, at: new Date().toISOString(), matches: found.matches, count: found.count, error: found.error ?? null, ms: found.ms ?? null });
});

routes.get("/extract/:id/results", requireOwner, (c) => {
  const id = idOf(c.req.param("id"));
  const found = id === null ? null : extractResults(id);
  if (!found) return c.json<ApiError>({ error: "There is no such rule." }, 404);
  return c.json<ExtractResults>(found);
});

routes.get("/duplicates", async (c) => c.json<Reading<SpiderDuplicates>>(await reading("crawl", () => contentDuplicates())));

/** Where src/cc/site/audit.ts keeps an audit for a day: "spider:audit:" and the tidied address. */
const KEPT = "spider:audit:";

/** The audits kept, newest first: what was asked, where it ended, what it answered and scored. */
function keptAudits(): SpiderAuditListed[] {
  const rows = db.prepare("SELECT json, at FROM cc_cache WHERE key LIKE ? AND at >= ? ORDER BY at DESC LIMIT 30").all(`${KEPT}%`, Date.now() - AUDIT.keepMs) as { json: string; at: number }[];
  const out: SpiderAuditListed[] = [];
  for (const r of rows) {
    try {
      const a = JSON.parse(r.json) as SpiderAudit;
      out.push({ url: a.url, finalUrl: a.finalUrl, at: a.at, status: a.status, score: a.score, issues: a.issues.length, error: a.error });
    } catch {
      /* a row that cannot be read is left out, never shown half */
    }
  }
  return out;
}

routes.get("/audits", (c) => {
  const asked = c.req.query("url");
  if (asked === undefined) return c.json<SpiderAuditListed[]>(keptAudits());
  let url: string;
  try {
    url = guardUrl(asked).toString();
  } catch (e) {
    return c.json<ApiError>({ error: e instanceof Error ? e.message : "That is not an address the desk audits." }, 400);
  }
  const row = db.prepare("SELECT json, at FROM cc_cache WHERE key = ? AND at >= ?").get(`${KEPT}${url}`, Date.now() - AUDIT.keepMs) as { json: string; at: number } | undefined;
  if (!row) return c.json<ApiError>({ error: "No audit of that address is kept: audits are kept for a day. Audit it again." }, 404);
  try {
    return c.json<SpiderAudit>({ ...(JSON.parse(row.json) as SpiderAudit), cached: true });
  } catch {
    return c.json<ApiError>({ error: "The kept audit of that address could not be read. Audit it again." }, 404);
  }
});

routes.post("/audit", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { url?: unknown; fresh?: unknown } | null;
  if (typeof body?.url !== "string") return c.json<ApiError>({ error: 'Send { "url": "https://…" }, and "fresh": true to fetch it again.' }, 400);
  try {
    /* "Audit again": the kept answer goes first, so audit() fetches; a refused address throws here, before anything is dropped. */
    if (body.fresh === true) db.prepare("DELETE FROM cc_cache WHERE key = ?").run(`${KEPT}${guardUrl(body.url).toString()}`);
    /* Each person's share of the hour is counted by their Telegram id, the one identity the desk can prove. */
    return c.json<SpiderAudit>(await audit(body.url, { who: `person:${me(c).telegram}` }));
  } catch (e) {
    if (e instanceof Refused) return c.json<ApiError>({ error: e.message }, 400);
    if (e instanceof TooMany) {
      c.header("retry-after", String(e.retryAfter));
      return c.json<ApiError>({ error: e.message }, 429);
    }
    if (e instanceof GaveUp) return c.json<ApiError>({ error: e.message }, 504);
    throw e;
  }
});
