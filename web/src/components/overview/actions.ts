"use server";

import { redirect } from "next/navigation";
import { askPost } from "@/lib/api";

/**
 * "Run SEO audit": asks the desk to run its crawl now (POST
 * /api/v1/jobs/crawl/run). The desk answers 202 when it is queued, 429 when
 * it is running or ran a moment ago, 409 when it may not run. What came back
 * returns to the Command Center in the address as a fixed code and the
 * moment of the press (`audit=busy.1759400000000`, see audit.ts), beside the
 * range the person was looking at. Never the desk's words: the page prints a
 * sentence of its own for each code, so an address cannot make the desk
 * appear to say anything.
 */
export async function runAudit(form: FormData): Promise<void> {
  const range = String(form.get("range") ?? "");
  const answer = await askPost("/api/v1/jobs/crawl/run");
  const code = answer.ok ? "started" : answer.kind === "down" ? "down" : answer.status === 429 ? "busy" : answer.status === 409 ? "off" : "failed";
  const q = new URLSearchParams();
  if (range === "7d" || range === "90d" || range === "1y") q.set("range", range);
  if (form.get("specimen") === "1") q.set("specimen", "1");
  q.set("audit", `${code}.${Date.now()}`);
  redirect(`/?${q.toString()}#quick-actions`);
}
