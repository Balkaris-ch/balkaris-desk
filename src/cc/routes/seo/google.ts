import { Hono } from "hono";
import type { Context } from "hono";
import { me, type Vars } from "../../access.ts";
import type { ApiError, Reading } from "../../../../web/src/contract/common.ts";
import type { GoogleAnswer, GooglePanel, IndexNowAnswer, InspectAnswer, InspectNow, LinkCheck } from "../../../../web/src/contract/seo/google.ts";
import { announce, Cannot, inspectNow, lastAsked, linkCheck, markRequested, panel, refreshSitemaps, submitSitemap } from "../../seo/google-actions.ts";
import { body } from "./shared.ts";

/**
 * /api/v1/seo/google — what the desk can do at Google and the other search
 * engines (src/cc/seo/google-actions.ts). Not a page of its own: SEO ›
 * Technical draws it as a panel, and Search Console and Pages use its buttons,
 * so src/grants.ts lists this prefix under all three (a change needs edit on
 * one of them; the server's gate decides that before a request arrives here).
 *
 *   GET  /                    the panel: sitemaps, the Request indexing queue, IndexNow   → GooglePanel
 *   GET  /inspect?path=       the last answer a person asked for about an address, kept  → Reading<InspectNow>
 *   GET  /links?path=         is the page linked from pages Google already has           → Reading<LinkCheck>
 *   POST /inspect             { path }               ask Google about one address now     → InspectAnswer
 *   POST /sitemaps/submit     { path }               submit, or submit again, a sitemap   → GoogleAnswer
 *   POST /sitemaps/refresh    {}                     Search Console's list, asked again   → GoogleAnswer
 *   POST /requested           { path, requested }    "I pressed Request indexing"         → GoogleAnswer
 *   POST /indexnow            { paths } | { changed: true }   tell the other engines      → IndexNowAnswer
 *
 * A GET asks nobody outside the desk. Each POST is one person's press: it is
 * written to the activity feed by the library with their name, and here to
 * the owner's record of the team (`did`).
 *
 * This file is found by src/cc/routes/seo.ts by its name alone (any file in
 * this folder that exports `routes` answers under /api/v1/seo/<name>).
 */
export const routes = new Hono<Vars>();

const HREF = "/seo/technical#google";

/** A refusal the library put into words keeps its status; anything else is this file's bug and says so plainly. */
function refused(c: Context<Vars>, e: unknown): Response {
  if (e instanceof Cannot) return c.json<ApiError>({ error: e.message }, e.status);
  throw e;
}

const pathOf = (v: unknown): string | null => (typeof v === "string" && v.trim() && v.length <= 500 ? v.trim() : null);

routes.get("/", async (c) => c.json<GooglePanel>(await panel()));

routes.get("/inspect", (c) => {
  const path = pathOf(c.req.query("path"));
  if (!path) return c.json<ApiError>({ error: "Say which address: ?path=/a-page-of-the-site." }, 400);
  return c.json<Reading<InspectNow>>(lastAsked(path));
});

routes.get("/links", (c) => {
  const path = pathOf(c.req.query("path"));
  if (!path) return c.json<ApiError>({ error: "Say which address: ?path=/a-page-of-the-site." }, 400);
  return c.json<Reading<LinkCheck>>(linkCheck(path));
});

routes.post("/inspect", async (c) => {
  const b = await body(c);
  const path = pathOf(b.path);
  if (!path) return c.json<ApiError>({ error: 'Send { "path": "/a-page-of-the-site" }.' }, 400);
  try {
    const done = await inspectNow(path, me(c));
    c.set("did", { text: `Asked Google about ${done.inspection.path}`, href: HREF });
    return c.json<InspectAnswer>({ ok: true, line: done.line, inspection: done.inspection, quota: done.quota });
  } catch (e) {
    return refused(c, e);
  }
});

routes.post("/sitemaps/submit", async (c) => {
  const b = await body(c);
  const path = pathOf(b.path);
  if (!path) return c.json<ApiError>({ error: 'Send { "path": "/sitemap.xml" }: one of the website\'s own sitemaps.' }, 400);
  try {
    const line = await submitSitemap(path, me(c));
    c.set("did", { text: `Submitted the sitemap ${path} to Google`, href: HREF });
    return c.json<GoogleAnswer>({ ok: true, line });
  } catch (e) {
    return refused(c, e);
  }
});

routes.post("/sitemaps/refresh", async (c) => {
  try {
    const n = await refreshSitemaps();
    /* A read, asked for by a person: nothing changed anywhere, so nothing for the record of the team. */
    c.set("did", null);
    return c.json<GoogleAnswer>({ ok: true, line: n ? `Search Console lists ${n} sitemap${n === 1 ? "" : "s"} for the property; read just now.` : "Search Console lists no sitemap for the property yet." });
  } catch (e) {
    return refused(c, e);
  }
});

routes.post("/requested", async (c) => {
  const b = await body(c);
  const path = pathOf(b.path);
  if (!path || typeof b.requested !== "boolean") return c.json<ApiError>({ error: 'Send { "path": "/a-page", "requested": true } (false takes the mark back).' }, 400);
  try {
    const done = markRequested(path, b.requested, me(c));
    c.set("did", done.changed ? { text: b.requested ? `Requested indexing in Search Console: ${path}` : `Took back the Request-indexing mark: ${path}`, href: HREF } : null);
    return c.json<GoogleAnswer>({ ok: true, line: done.line });
  } catch (e) {
    return refused(c, e);
  }
});

routes.post("/indexnow", async (c) => {
  const b = await body(c);
  const changed = b.changed === true;
  const paths = Array.isArray(b.paths) ? b.paths.filter((p): p is string => typeof p === "string") : null;
  if (!changed && (!paths || !paths.length || (Array.isArray(b.paths) && paths.length !== b.paths.length))) {
    return c.json<ApiError>({ error: 'Send { "paths": ["/a-page"] } for the addresses to announce, or { "changed": true } for everything that changed since the last announcement.' }, 400);
  }
  try {
    const done = await announce(changed ? { changed: true } : { paths: paths ?? [] }, me(c));
    c.set("did", { text: `Told the search engines about ${done.addresses} address${done.addresses === 1 ? "" : "es"} (IndexNow)`, href: HREF });
    return c.json<IndexNowAnswer>({ ok: true, line: done.line, addresses: done.addresses, answers: done.answers });
  } catch (e) {
    return refused(c, e);
  }
});
