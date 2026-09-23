import { DatabaseSync } from "node:sqlite";
import { compose } from "../src/cover.ts";
import { look } from "../src/look.ts";
import { proseOf } from "../src/blocks.ts";

/**
 * Does the reading hold up?
 *
 * Two halves, both free — no card, no ComfyUI, no model:
 *
 *   FIXTURES  a dozen sentences whose shape is not in doubt, each with the
 *             motion it had better find. This is the part that fails loudly
 *             when somebody adds a term to the wrong bucket.
 *   THE REAL  every draft in the desk, read and composed, one line each. This
 *             is the part you look at. If two thirds of the journal comes out
 *             "layering / technical" the table is not reading, it is
 *             defaulting, and the spread at the bottom says so.
 *
 *   npm run check:covers
 */

interface Fixture {
  title: string;
  text: string;
  motion: string;
}

const FIXTURES: Fixture[] = [
  {
    title: "The bottleneck is not the model",
    text: "Every team we speak to is stuck at the same barrier. The work waits, the queue grows, and the constraint is never where they think it is.",
    motion: "blocked",
  },
  {
    title: "Small budgets compound faster than big ones",
    text: "Spend rises, returns rise with it, and the gain climbs month after month until the curve is steeper than anything a launch could buy.",
    motion: "rising",
  },
  {
    title: "Bring the enquiries into one place",
    text: "Six inboxes consolidate into a single source. Everything is brought together, aligned, and nothing is answered twice.",
    motion: "converging",
  },
  {
    title: "Paid search versus organic, honestly",
    text: "The difference between the two is not what agencies say it is. One buys attention; the other earns it. Choose between them rather than pretending they are the same.",
    motion: "splitting",
  },
  {
    title: "Fifty videos a month, the same way every time",
    text: "At volume the process matters more than the taste. A template, a batch, over and over, each week the same shape.",
    motion: "repeating",
  },
  {
    title: "What your CRM is built on",
    text: "The foundation is the data model. Everything else is built on top of it, layer after layer, and the structure beneath decides what you can do later.",
    motion: "layering",
  },
  {
    title: "Wiring the booking form to the calendar",
    text: "An integration is a hand off. The enquiry flows from the form, along the pipeline, end to end, and connects to the thing that actually books the meeting.",
    motion: "connecting",
  },
  {
    title: "Retention is a loop, not a campaign",
    text: "Customers come back. The feedback cycle turns, you iterate, and recurring revenue is what is left when the loop closes.",
    motion: "turning",
  },
];

let failed = 0;
console.log("fixtures");
for (const f of FIXTURES) {
  const got = look({ title: f.title, text: f.text, topic: "marketing", practices: [] });
  const ok = got.motion === f.motion;
  if (!ok) failed += 1;
  console.log(
    `  ${ok ? "ok  " : "NO  "}${got.motion.padEnd(11)} ${ok ? "" : `(wanted ${f.motion}) `}${f.title}`,
  );
  if (!ok) console.log(`        fired: ${got.because.motion.join(", ") || "nothing"}`);
}
console.log(`  ${FIXTURES.length - failed} of ${FIXTURES.length}\n`);

/* ---------- the real journal ---------------------------------------------- */

const path = process.env.DESK_DB;
if (!path) {
  console.log("DESK_DB is not set, so only the fixtures ran.");
  process.exit(failed ? 1 : 0);
}

const db = new DatabaseSync(path, { readOnly: true });
const rows = db
  .prepare("SELECT d.slug, d.post, l.topic FROM drafts d JOIN links l ON l.id = d.link_id ORDER BY d.id")
  .all() as { slug: string; post: string; topic: string }[];

const spread = { motion: new Map<string, number>(), palette: new Map<string, number>() };
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

console.log(`the journal (${rows.length})`);
for (const row of rows) {
  const post = JSON.parse(row.post) as {
    title: string;
    standfirst: string;
    excerpt: string;
    services?: string[];
    body?: never[];
  };
  const out = compose({
    title: post.title,
    text: [post.standfirst, post.excerpt, proseOf((post.body ?? []) as never)].filter(Boolean).join("\n\n"),
    topic: row.topic as never,
    services: post.services ?? [],
    slug: row.slug,
  });
  bump(spread.motion, out.read.motion);
  bump(spread.palette, out.palette.name);
  console.log(
    `  ${out.read.motion.padEnd(11)} ${out.read.mood.padEnd(10)} ${out.composition.name.padEnd(7)} ${out.palette.name.padEnd(7)} ${post.title.slice(0, 58)}`,
  );
  console.log(`      because: ${out.read.because.motion.join(", ") || "nothing fired"}`);
}

const show = (label: string, m: Map<string, number>) =>
  console.log(
    `\n${label}: ${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join("  ")}`,
  );
show("motions", spread.motion);
show("palettes", spread.palette);

process.exit(failed ? 1 : 0);
