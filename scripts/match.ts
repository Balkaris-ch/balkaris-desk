import { match, checkTable } from "../src/match.ts";
import { TOPICS } from "../src/catalogue.ts";

/**
 * `npm run match -- "<title>" ["<body>"]` — shows the table's working.
 *
 * With no arguments it runs the fixtures below, which are the cases the table
 * has already been wrong about. Add one every time a draft comes out attached
 * to the wrong service: this is the test suite, and it costs nothing to run.
 */

const FIXTURES: { title: string; body: string; expect: string[] }[] = [
  {
    title: "Google is putting AI overviews on Swiss search results",
    body: "The change pushes organic listings below a generated answer. Sites that ranked first for a keyword now report a lower click-through rate even where the ranking has not moved. Publishers are rewriting pages around search intent and schema markup to stay quotable.",
    expect: ["seo"],
  },
  {
    title: "We rebuilt a restaurant's booking flow and doubled the conversion rate",
    body: "The old form asked for fourteen fields. A/B test after A/B test showed the same friction at the checkout flow: people abandoned it on mobile. The new landing page asks for three, and the booking form posts straight to their CRM.",
    expect: ["conversion-rate-optimization"],
  },
  {
    title: "Runway, Kling and Veo: what AI video is actually good for in 2026",
    body: "Text to video is finally usable for establishing shots and product inserts. It is still bad at hands, continuity and anything a client will scrutinise frame by frame. We use generative video where a film crew would cost more than the shot is worth.",
    expect: ["ai-content-production"],
  },
  {
    title: "Why your Meta ads stopped working in month three",
    body: "Creative fatigue, not the algorithm. The ad set is fine; the audience has seen the same three videos forty times. Rotate the creative and the ROAS comes back, which is a content production problem dressed as a media buying one.",
    expect: ["meta-ads"],
  },
  {
    title: "A voice agent that books appointments over the phone",
    body: "Speech to text on the way in, a small model deciding what the caller wants, text to speech on the way out, and a write into the CRM. The hard part is not the voice ai, it is the handover to a human when the call goes sideways.",
    expect: ["voice-ai-development"],
  },
  {
    title: "The EU AI Act lands in August and most Swiss companies are not ready",
    body: "Transparency obligations, risk tiers and documentation. The rules apply to anyone selling into the EU market, which is most of the industry here. Adoption of large language models ran ahead of the governance for them.",
    expect: ["ai-development"],
  },
];

function show(title: string, body: string) {
  const r = match(title, body);
  const name = TOPICS.find((t) => t.id === r.topic)?.name ?? r.topic;
  console.log(`\n  ${title}`);
  console.log(`  shelf   ${name}  (${r.topicScore})`);
  if (!r.services.length) console.log("  services  — nothing over the floor");
  for (const s of r.services) {
    console.log(`  service ${s.name.padEnd(34)} ${String(s.score).padStart(6)}   ${s.because.slice(0, 6).join(", ")}`);
  }
  const rest = r.all.filter((h) => !r.services.some((s) => s.slug === h.slug)).slice(0, 4);
  if (rest.length) console.log(`  also    ${rest.map((h) => `${h.name} ${h.score}`).join(" · ")}`);
  return r;
}

const bad = checkTable();
if (bad.length) {
  console.error("\n  the table and the catalogue disagree:\n   " + bad.join("\n   "));
  process.exit(1);
}

const [title, body] = process.argv.slice(2);

if (title) {
  show(title, body ?? title);
} else {
  let failed = 0;
  for (const f of FIXTURES) {
    const r = show(f.title, f.body);
    const got = r.services.map((s) => s.slug);
    const missing = f.expect.filter((e) => !got.includes(e));
    if (missing.length) {
      failed += 1;
      console.log(`  [31mFAIL[0m expected ${missing.join(", ")}`);
    }
  }
  console.log(`\n  ${FIXTURES.length - failed}/${FIXTURES.length} fixtures matched\n`);
  if (failed) process.exit(1);
}
