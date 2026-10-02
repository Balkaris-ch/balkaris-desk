import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { me, requireOwner, type Vars } from "../access.ts";
import { body, nav } from "../routes/seo/shared.ts";
import { ok, since, waiting } from "../store.ts";
import type { Reading } from "../../../web/src/contract/common.ts";
import type { NewAiCheck } from "../../../web/src/contract/seo/ai-search.ts";
import type { AuditAnswer, AuditRun, ImportAnswer, OpportunityAnswer, OwnerTaskAnswer, SeoNav } from "../../../web/src/contract/seo/common.ts";
import { addCheck, checkRefusal, IMPORT_KINDS, importManual, type ImportKind } from "./aisearch.ts";
import { auditRun, startAudit } from "./audit.ts";
import { markSubmitted } from "./engine.ts";
import { importAll } from "./import.ts";
import { clusters, setClusterPage } from "./keywords.ts";
import { markOwnerTask } from "./owner.ts";
import { siteView } from "./site.ts";

/**
 * The SEO engine's own addresses: what no single page of the section owns.
 * Mounted by src/cc/routes/seo.ts under /api/v1/seo, beside the pages.
 *
 *   GET  /nav                          the tab strip's and the sidebar's counts      → SeoNav
 *   GET  /audit                        the last full audit, while it runs and an hour after → { audit }
 *   POST /audit                        run the full audit (crawl, Search Console, snapshot,
 *                                      readiness, engine) through the scheduler      → AuditAnswer
 *   POST /owner-tasks/:id              { done, note? }  a person marks a task done or open → OwnerTaskAnswer
 *   POST /indexing/requested           { path, submitted }  the lead requested indexing by hand → OpportunityAnswer
 *   POST /clusters/:key/page           { path | null }  map a cluster to a page by hand → { ok, cluster }
 *   POST /ai-checks          OWNER     { checks: NewAiCheck[] }  record AI checks      → { ok, added, rows }
 *   POST /imports/:kind      OWNER     gsc-generative-ai | bing-ai-performance: { month, csv }
 *                                      audit: the audit's files on this machine (scripts/seo-import.ts)
 *                                                                                      → ImportAnswer
 *
 * RIGHTS. The server's gate (src/server.ts) has already made sure somebody is
 * signed in and that a change comes from the desk's own pages (the Origin
 * rule). Reading and changing a state is any signed-in person's; recording AI
 * checks and importing are the owner's (requireOwner). Nothing here changes
 * the live website: the one route that leads there, an opportunity's action,
 * queues an operator task whose proposals wait for a person's approval.
 */
export const engineApi = new Hono<Vars>();

const bad = (message: string): never => {
  throw new HTTPException(400, { message });
};

/* Before the opportunity engine's first run there is no count to give: a 0
   would tell the owner there is nothing to fix. The layout draws the chip
   only from an ok reading. */
engineApi.get("/nav", (c) =>
  c.json<Reading<SeoNav>>(since("seo.opps.open") ? ok(nav(), "desk", Date.now()) : waiting("desk", "The opportunity engine has not run yet.")),
);

engineApi.get("/audit", (c) => {
  let audit: AuditRun | null = null;
  try {
    audit = auditRun();
  } catch {
    audit = null;
  }
  return c.json<{ audit: AuditRun | null }>({ audit });
});

engineApi.post("/audit", (c) => {
  const audit = startAudit(me(c));
  return c.json<AuditAnswer>({ ok: true, audit });
});

engineApi.post("/owner-tasks/:id", async (c) => {
  const b = await body(c);
  if (typeof b.done !== "boolean") bad("done must be true or false.");
  if (b.note !== undefined && b.note !== null && (typeof b.note !== "string" || b.note.length > 500)) bad("note is at most 500 characters.");
  const task = markOwnerTask(c.req.param("id"), b.done as boolean, me(c).name, (b.note as string | null | undefined) ?? null);
  if (!task) throw new HTTPException(404, { message: `There is no owner task ${c.req.param("id")}.` });
  return c.json<OwnerTaskAnswer>({ ok: true, task });
});

engineApi.post("/indexing/requested", async (c) => {
  const b = await body(c);
  if (typeof b.path !== "string" || !b.path.startsWith("/") || b.path.length > 300) bad("path must be one of the site's addresses, starting with /.");
  if (typeof b.submitted !== "boolean") bad("submitted must be true or false.");
  const opportunity = markSubmitted(b.path as string, b.submitted as boolean, me(c));
  return c.json<OpportunityAnswer>({ ok: true, opportunity });
});

engineApi.post("/clusters/:key/page", async (c) => {
  const key = c.req.param("key");
  if (!clusters().some((x) => x.key === key)) throw new HTTPException(404, { message: `There is no cluster ${key}.` });
  const b = await body(c);
  const p = b.path;
  if (p !== null && (typeof p !== "string" || !p.startsWith("/") || p.length > 300)) bad("path must be one of the site's addresses (starting with /), or null to take the mapping away.");
  if (typeof p === "string" && !siteView().byPath.has(p)) bad(`The crawl knows no page at ${p}.`);
  const cluster = setClusterPage(key, (p as string | null) ?? null, me(c).name);
  return c.json({ ok: true as const, cluster });
});

engineApi.post("/ai-checks", requireOwner, async (c) => {
  const b = await body(c);
  const list = b.checks;
  if (!Array.isArray(list) || !list.length || list.length > 100) bad("checks must be a list of 1 to 100 checks.");
  const refused: string[] = [];
  for (const [i, raw] of (list as unknown[]).entries()) {
    const why = checkRefusal((raw ?? {}) as Partial<NewAiCheck>);
    if (why) refused.push(`check ${i + 1}: ${why}`);
  }
  if (refused.length) bad(refused.slice(0, 3).join(" "));
  let added = 0;
  for (const raw of list as NewAiCheck[]) if (addCheck(raw, me(c).name) === "added") added++;
  return c.json({ ok: true as const, added, rows: (list as unknown[]).length });
});

/** Where the audit's files are on this machine: work/seo-audit beside the repository. */
const AUDIT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../work/seo-audit");

engineApi.post("/imports/:kind", requireOwner, async (c) => {
  const kind = c.req.param("kind");
  if (kind === "audit") {
    const done = importAll(AUDIT_DIR);
    return c.json<ImportAnswer>({ ok: true, kind, lines: done.lines });
  }
  if (!IMPORT_KINDS.includes(kind as ImportKind)) throw new HTTPException(404, { message: `There is no import called ${kind}. The imports are ${[...IMPORT_KINDS, "audit"].join(", ")}.` });
  const b = await body(c);
  if (typeof b.month !== "string" || !/^\d{4}-\d\d$/.test(b.month)) bad('month must be "YYYY-MM": the month the export covers.');
  if (typeof b.csv !== "string" || !b.csv.trim()) bad("csv must be the exported file's text.");
  if ((b.csv as string).length > 5_000_000) bad("The CSV is larger than 5 MB.");
  let got: { result: string; rows: number };
  try {
    got = importManual(kind as ImportKind, b.month as string, b.csv as string, me(c).name);
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e));
  }
  return c.json<ImportAnswer>({ ok: true, kind, lines: [`${b.month}: ${got.rows.toLocaleString("en-GB")} row${got.rows === 1 ? "" : "s"}, ${got.result}`] });
});
