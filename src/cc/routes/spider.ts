import { Hono } from "hono";
import { requireOwner, type Vars, me } from "../access.ts";
import { audit, GaveUp, Refused, TooMany } from "../site/audit.ts";
import { addExtractRule, contentDuplicates, deleteExtractRule, extractResults, extractRules, toggleExtractRule } from "../site/crawl.ts";
import { reading } from "../store.ts";
import type { ApiError, Reading } from "../../../web/src/contract/common.ts";
import type { ExtractKind, ExtractResults, ExtractRule, ExtractRuleInput, SpiderAudit, SpiderDuplicates } from "../../../web/src/contract/spider.ts";

/**
 * /api/v1/spider — the crawler's tools beyond its daily read.
 *
 *   GET    /extract              owner   the custom extraction rules
 *   POST   /extract              owner   add one { name, kind, expression, attribute?, scope? };
 *                                        400 with the reason when it is refused
 *   POST   /extract/:id/toggle   owner   { enabled?: boolean }; without it, the other way
 *   DELETE /extract/:id          owner   the rule and everything it found
 *   GET    /extract/:id/results  owner   what it found at the last crawl, page by page
 *   GET    /duplicates           anyone signed in: the duplicate-content findings
 *                                        of the last crawl as groups and pairs
 *   POST   /audit                anyone signed in: { url } one page of any public
 *                                        website, fetched and judged by the crawl's
 *                                        page rules (src/cc/site/audit.ts); 400 when
 *                                        the address may not be fetched, 429 when
 *                                        the hour's audits are spent (the desk's
 *                                        30, or this person's 10), 504 when it
 *                                        was given up after 90 seconds
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

routes.get("/extract/:id/results", requireOwner, (c) => {
  const id = idOf(c.req.param("id"));
  const found = id === null ? null : extractResults(id);
  if (!found) return c.json<ApiError>({ error: "There is no such rule." }, 404);
  return c.json<ExtractResults>(found);
});

routes.get("/duplicates", async (c) => c.json<Reading<SpiderDuplicates>>(await reading("crawl", () => contentDuplicates())));

routes.post("/audit", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
  if (typeof body?.url !== "string") return c.json<ApiError>({ error: 'Send { "url": "https://…" }.' }, 400);
  try {
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
