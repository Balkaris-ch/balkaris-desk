"use server";

import { redirect } from "next/navigation";
import { askPost } from "@/lib/api";
import type { CrawlCode } from "./crawl-said";

/**
 * "Scan for orphan pages" and "Run crawl for the site": asks the desk server
 * to run the crawl job now (POST /api/v1/jobs/crawl/run, the same door as the
 * Automations screen's "Run now"). The crawl reads every page of the website
 * again with GET requests and counts the links, which is what finds an
 * orphan. What the server answered comes back in the address as a code
 * (`crawl=`, crawl-said.ts), never as words, so the screen says it beside the
 * button in a sentence of its own.
 */
export async function runCrawl(form: FormData): Promise<void> {
  const asked = String(form.get("back") ?? "/pages");
  /* Only back to this screen or one page's detail: never an address the form was given from elsewhere. */
  const back = /^\/pages(\/view)?(\?[^#]*)?$/.test(asked) ? asked : "/pages";
  const a = await askPost("/api/v1/jobs/crawl/run");
  /* src/cc/api.ts, POST /jobs/:name/run: 202 asked for; 429 running now, or asked for a moment ago; 409 not ready or switched off. */
  const code: CrawlCode = a.ok ? "started" : a.status === 429 ? (/running now/i.test(a.message) ? "running" : "wait") : a.status === 409 ? "off" : "failed";
  const url = new URL(back, "http://desk.local");
  url.searchParams.set("crawl", code);
  redirect(`${url.pathname}${url.search}#dk-pages-actions`);
}
