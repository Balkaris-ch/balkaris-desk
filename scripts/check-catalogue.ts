import { readFileSync } from "node:fs";
import { SERVICES, TOPICS } from "../src/catalogue.ts";
import { checkTable } from "../src/match.ts";

/**
 * `npm run check:catalogue` — does src/catalogue.ts still describe the site?
 *
 * The desk keeps its own copy of the thirty services and six shelves so it
 * never has to import out of the website's repo. A copy goes stale, and a
 * stale slug here is a published article linking to a 404. So this reads the
 * real files and shouts. It is a check and never a writer: the fix is a line
 * in catalogue.ts and, usually, a line in match.ts beside it.
 */

const SITE = process.env.SITE_SOURCE ?? "E:/Balkaris/Code/balkaris-web-infrastructure";

function slugsFrom(file: string, re: RegExp): string[] {
  const text = readFileSync(`${SITE}/${file}`, "utf8");
  return [...text.matchAll(re)].map((m) => m[1]);
}

let bad = 0;

try {
  /* The hubs (digital-services, growth-marketing, creative-studio) are
     sections of the site, not capabilities, so they are not in the desk's
     list and are not missing from it. */
  const HUBS = new Set(["digital-services", "growth-marketing", "creative-studio"]);
  const live = slugsFrom("content/disciplines.ts", /^\s{4}slug: "([a-z0-9-]+)"/gm).filter((s) => !HUBS.has(s));
  const mine = new Set(SERVICES.map((s) => s.slug));

  for (const s of live) if (!mine.has(s)) { console.error(`  the site has a service the desk does not know: ${s}`); bad++; }
  for (const s of mine) if (!live.includes(s)) { console.error(`  the desk lists a service the site no longer has: ${s}`); bad++; }

  const topics = slugsFrom("content/journal.ts", /^\s{4}id: "([a-z-]+)"/gm);
  const myTopics = new Set(TOPICS.map((t) => t.id));
  for (const t of topics) if (!myTopics.has(t as never)) { console.error(`  the journal has a shelf the desk does not know: ${t}`); bad++; }
} catch (e) {
  console.error(`  could not read the site at ${SITE} — set SITE_SOURCE if it lives elsewhere.\n  ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}

for (const line of checkTable()) { console.error(`  match.ts: ${line}`); bad++; }

console.log(bad ? `\n  ${bad} problem(s).\n` : `  ${SERVICES.length} services, ${TOPICS.length} shelves — the desk and the site agree.`);
process.exit(bad ? 1 : 0);
