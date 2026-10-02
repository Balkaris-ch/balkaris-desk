import { writeFileSync } from "node:fs";
import { extract } from "../src/extract.ts";
import { match } from "../src/match.ts";
import { draft } from "../src/draft.ts";
import { countWords } from "../src/blocks.ts";
import { allTemplates, FORMATS, formatIn, isFormat, template, type Format } from "../src/templates.ts";
import { TOPICS } from "../src/catalogue.ts";

/**
 * `npm run draft -- <url> [standard|deep|technical|simple] [--json out.json]`
 *
 * Write one article on this machine and print it, touching nothing else: no
 * database, no queue, no Telegram, no site. It is how a format is read before
 * anybody is sent one — the shapes in templates.ts are prompts, and a prompt
 * is only proved by what comes back.
 *
 * With no url it prints the shapes themselves: every section, its budget, and
 * whether the shortest piece the budgets allow still clears the shape's floor.
 * And `npm run draft -- --words "<a message>"` shows which format the bot
 * would read out of what somebody typed beside a link.
 *
 * Needs Ollama and the writing model, like the runner. An article page only:
 * a TikTok needs the whole ingest, which is the runner's job.
 */

const args = process.argv.slice(2);

if (args[0] === "--words") {
  const typed = args.slice(1).join(" ");
  const f = formatIn(typed);
  console.log(f ? `"${typed}" → ${f} (${FORMATS[f].as})` : `"${typed}" → nothing said, so the bot asks`);
  process.exit(0);
}

const url = args.find((a) => /^https?:\/\//.test(a));

if (!url) {
  for (const t of allTemplates()) {
    const total = t.beats.reduce((n, b) => n + b.words, 0);
    const least = t.beats.reduce((n, b) => n + Math.round(b.words * 0.6), 0);
    const floor = t.floor ?? 320;
    console.log(`\n${t.id.padEnd(10)} ${t.name} — ${t.note}`);
    for (const b of t.beats) {
      console.log(`  ${String(b.words).padStart(4)}  ${(b.heading ?? (b.blind ? "(the last paragraph)" : "(the opening)")).padEnd(38)} ${(b.allow ?? []).join(", ")}`);
    }
    console.log(
      `  ${String(total).padStart(4)}  words asked for; ${least} at the least; floor ${floor}${least < floor ? "  ← a piece at its minimum is thrown away" : ""}; ${t.questions ?? 3} questions`,
    );
  }
  console.log();
  process.exit(0);
}

const named = args.find((a) => isFormat(a));
const format: Format = isFormat(named) ? named : "standard";
const jsonAt = args.indexOf("--json");
const out = jsonAt >= 0 ? args[jsonAt + 1] : null;

console.log(`reading ${url}`);
const piece = await extract(url);
const m = match(piece.title, piece.text);
console.log(`  ${piece.title} — ${piece.site}, ${piece.words} words`);
console.log(`  shelf ${TOPICS.find((t) => t.id === m.topic)?.name ?? m.topic}; services ${m.services.map((s) => s.slug).join(", ") || "none"}`);
console.log(`writing it ${FORMATS[format].as}…\n`);

const got = await draft(
  {
    url,
    title: piece.title,
    site: piece.site,
    author: piece.author,
    published: piece.published,
    words: piece.words,
    text: piece.text,
    topic: m.topic,
    services: m.services.map((s) => s.slug),
  },
  { format },
);

const p = got.post;
console.log("=".repeat(78));
console.log(p.title);
console.log(p.standfirst);
console.log("=".repeat(78));
for (const b of p.body) {
  if (typeof b === "string") console.log(`\n${b}`);
  else if ("h" in b) console.log(`\n\n## ${b.h}`);
  else if ("list" in b) console.log(`\n${b.list.map((x) => `  • ${x}`).join("\n")}`);
  else if ("steps" in b) console.log(`\n${b.steps.map((x, i) => `  ${i + 1}. ${x.term} — ${x.text}`).join("\n")}`);
  else if ("note" in b) console.log(`\n  [aside] ${b.note}`);
  else if ("quote" in b) console.log(`\n  “${b.quote}”${b.who ? ` — ${b.who}` : ""}`);
  else if ("table" in b) console.log(`\n  ${b.table.head.join(" | ")}\n${b.table.rows.map((r) => `  ${r.join(" | ")}`).join("\n")}`);
}
console.log("\n\n-- what to take away");
for (const t of p.takeaways) console.log(`  • ${t}`);
console.log("\n-- questions");
for (const f of p.faq) console.log(`  Q ${f.q}\n  A ${f.a}`);

const sentences = p.body.filter((b): b is string => typeof b === "string").join(" ").split(/(?<=[.!?])\s+/).filter(Boolean);
const perSentence = sentences.length ? Math.round(sentences.join(" ").split(/\s+/).length / sentences.length) : 0;
console.log(`\n${"-".repeat(78)}`);
console.log(`shape      ${got.template} (${template(got.template).name}) — ${got.because}`);
console.log(`ends on    ${got.closing.job} — ${got.closing.because}`);
console.log(`length     ${countWords(p.body)} words, ${p.readingTime} min read, about ${perSentence} words a sentence`);
console.log(`excerpt    ${p.excerpt}`);
console.log(`slug       ${p.slug}`);
console.log(`took       ${Math.round(got.ms / 1000)}s with ${got.model}${got.dropped.length ? `; dropped: ${got.dropped.join("; ")}` : ""}`);

if (out) {
  writeFileSync(out, JSON.stringify({ ...got, post: p }, null, 1));
  console.log(`saved      ${out}`);
}
