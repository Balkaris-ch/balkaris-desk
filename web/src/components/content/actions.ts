"use server";

import { redirect } from "next/navigation";
import { askPost } from "@/lib/api";
import type { CrawlSaid } from "./view";

/**
 * "Run the crawl now": asks the desk server, from this app's server, to run
 * the crawl job ahead of its schedule (POST /api/v1/jobs/crawl/run: the
 * server takes it from edit on Automations, or from somebody who may change
 * something and sees an area the crawl feeds, src/grants.ts `mayRunJob`, and
 * refuses a second ask while one runs or within its floor). The answer comes back in the address as a short code stamped
 * with when it was asked (`crawl=recent.1759400000000`), never as the
 * server's own words, so a link cannot make the screen print anything: the
 * screen words each code itself (CrawlWatch).
 *
 *   asked    accepted; the screen watches the job and redraws when it ends
 *   recent   running, or started or asked for less than its floor ago (429)
 *   off      switched off by the owner, or what it reads is not connected (409)
 *   out      nobody is signed in any more (401)
 *   down     the desk server did not answer
 *   failed   anything else
 */
export async function runCrawl(form: FormData): Promise<void> {
  const back = String(form.get("back") ?? "/content");
  const a = await askPost("/api/v1/jobs/crawl/run");
  const said: CrawlSaid = a.ok ? "asked" : a.status === 429 ? "recent" : a.status === 409 ? "off" : a.kind === "signed-out" ? "out" : a.kind === "down" ? "down" : "failed";
  const target = new URL(back.startsWith("/content") ? back : "/content", "http://desk.local");
  target.searchParams.set("crawl", `${said}.${Date.now()}`);
  redirect(`${target.pathname}${target.search}#actions`);
}
