import { takeLink } from "../src/intake.ts";
import { db } from "../src/db.ts";
import { serviceName, TOPICS } from "../src/catalogue.ts";

/**
 * `npm run intake -- <url> [--dry]` — feed a link in by hand.
 *
 * The same path a Telegram message takes, minus Telegram: no chat, so nothing
 * is sent and nobody claims ownership of the bot. This is how the pipeline is
 * proved on the box without a person having to message it, and how a link
 * somebody sent by email gets in.
 *
 * `--dry` reads and matches and prints, and writes nothing.
 */

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const url = args.find((a) => !a.startsWith("--"));

if (!url) {
  console.error("usage: npm run intake -- <url> [--dry]");
  process.exit(1);
}

if (dry) {
  const { extract } = await import("../src/extract.ts");
  const { match } = await import("../src/match.ts");
  const piece = await extract(url);
  const m = match(piece.title, piece.text);
  console.log(`\n  ${piece.title}`);
  console.log(`  ${piece.site}${piece.author ? ` · ${piece.author}` : ""} · ${piece.words} words`);
  console.log(`  shelf   ${TOPICS.find((t) => t.id === m.topic)?.name ?? m.topic}`);
  for (const s of m.services) console.log(`  service ${s.name.padEnd(32)} ${s.score}   ${s.because.slice(0, 5).join(", ")}`);
  console.log(`\n  first 240 words:\n  ${piece.text.split(/\s+/).slice(0, 240).join(" ")}\n`);
  process.exit(0);
}

const got = await takeLink(url);
if (!got) {
  console.error("that is not a link");
  process.exit(1);
}

const row = db.prepare("SELECT * FROM links WHERE id = ?").get(got.id) as Record<string, unknown>;
const jobs = db.prepare("SELECT id, kind, state FROM jobs WHERE link_id = ?").all(got.id);

console.log(`\n  link ${got.id}${got.already ? " (already had it)" : ""}`);
console.log(`  ${row.title ?? row.url}`);
console.log(`  site ${row.site} · ${row.words} words · state ${row.state}`);
console.log(`  shelf ${TOPICS.find((t) => t.id === row.topic)?.name ?? row.topic}`);
console.log(`  services ${(JSON.parse((row.services as string) ?? "[]") as string[]).map(serviceName).join(", ") || "none"}`);
console.log(`  jobs ${JSON.stringify(jobs)}`);
if (row.error) console.log(`  error ${row.error}`);
console.log();
