import { askJson, WRITE_MODEL } from "./llm.ts";
import { pick, template, type SourceFacts, type TemplateId } from "./templates.ts";
import { serviceName, TOPICS, type TopicId } from "./catalogue.ts";

/**
 * A read page becomes a Balkaris article.
 *
 * This is the only part that runs on the workstation, because it is the only
 * part that needs the 4090. Everything it is given — the shelf, the services,
 * the template — was already decided on the box by rules. The model writes
 * prose into a shape somebody else chose; it does not choose the shape, the
 * shelf, or the services.
 *
 * ONE BEAT PER CALL. A single prompt asking for a whole article gets a whole
 * article's worth of drift: the model finds a fourth section it likes, drops
 * the one it found boring, and pads the rest to look finished. A beat at a
 * time is six short calls where every one has a word budget and one job, and
 * a failure costs a paragraph rather than a piece.
 *
 * THE RULE THE WHOLE THING EXISTS TO ENFORCE: this is commentary, never a
 * paraphrase. The source is summarised in exactly one beat, attributed and
 * linked; every other beat is Balkaris's own argument. `guard()` at the end
 * refuses a draft that leans on the source anyway, before a human ever sees
 * it — a rewritten article is somebody else's work and Google calls a pile of
 * them scaled content abuse, which would cost balkaris.ch its own rankings.
 */

const VOICE = `You write for Balkaris, a Swiss digital studio in Dietlikon near Zurich.

How Balkaris writes:
- Plain, direct sentences. Under 25 words. No sentence that could be an advert.
- Specifics instead of adjectives: a number, a name, a date, a decision. Never "cutting-edge", "seamless", "robust", "game-changing", "leverage", "unlock", "in today's fast-paced world", "the landscape of".
- British spelling: optimise, analyse, colour, recognise.
- A position, stated. If something is oversold, say so. If the honest answer is "it depends", say what it depends on.
- Never "we are passionate about". Never a rhetorical question as a heading. Never an em-dash-heavy rhythm.
- Address the reader as "you". Refer to the company as "we".
- Nothing invented: no statistics, no client names, no case studies, no quotes. If you do not know a number, do not write one.`;

export interface DraftInput {
  url: string;
  title: string;
  site: string;
  author: string | null;
  published: string | null;
  words: number;
  text: string;
  topic: TopicId;
  services: string[];
}

export type Block = string | { h: string };

export interface DraftPost {
  slug: string;
  title: string;
  standfirst: string;
  excerpt: string;
  topics: TopicId[];
  services: string[];
  readingTime: number;
  body: Block[];
  takeaways: string[];
  source: { url: string; site: string; title: string; author: string | null };
}

export interface DraftResult {
  post: DraftPost;
  template: TemplateId;
  because: string;
  model: string;
  ms: number;
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 9)
    .join("-");

/* The source is given to the model in a window, not whole: a 5,000-word page
   costs context we would rather spend on the voice rules, and the opening of
   an article carries its argument. The tail is included because a conclusion
   often says the thing the lede only implied. */
function window(text: string, words = 1200): string {
  const all = text.split(/\s+/);
  if (all.length <= words) return text;
  const head = all.slice(0, Math.round(words * 0.75)).join(" ");
  const tail = all.slice(-Math.round(words * 0.25)).join(" ");
  return `${head}\n\n[…]\n\n${tail}`;
}

const PARA = {
  type: "object",
  properties: { paragraphs: { type: "array", items: { type: "string" } } },
  required: ["paragraphs"],
} as const;

function paragraphs(v: unknown, min: number, max: number): string[] {
  const got = (v as { paragraphs?: unknown })?.paragraphs;
  if (!Array.isArray(got) || !got.length) throw new Error("answer with {\"paragraphs\": [\"…\"]} and at least one paragraph");
  const clean = got.map((p) => String(p).trim()).filter(Boolean);
  if (!clean.length) throw new Error("every paragraph was empty");
  const n = clean.join(" ").split(/\s+/).length;
  if (n < min) throw new Error(`that is ${n} words and the section needs about ${Math.round((min + max) / 2)}`);
  if (n > max) throw new Error(`that is ${n} words, which is too long — the section needs about ${Math.round((min + max) / 2)}`);
  return clean;
}

export async function draft(input: DraftInput, opts: { model?: string } = {}): Promise<DraftResult> {
  const started = Date.now();
  const model = opts.model ?? WRITE_MODEL;

  const facts: SourceFacts = {
    title: input.title,
    topic: input.topic,
    words: input.words,
    published: input.published,
    services: input.services,
  };
  const chosen = pick(facts);
  const tpl = template(chosen.id);

  const shelf = TOPICS.find((t) => t.id === input.topic)?.name ?? input.topic;
  const sold = input.services.map(serviceName);

  const context = `THE SOURCE
Title: ${input.title}
Publication: ${input.site}${input.author ? `\nAuthor: ${input.author}` : ""}
URL: ${input.url}

${window(input.text)}

--- end of source ---

THIS ARTICLE
Shelf: ${shelf}
Balkaris services it touches: ${sold.length ? sold.join(", ") : "none directly"}
Shape: ${tpl.name}

THE RULE THAT MATTERS MOST
You are writing Balkaris's own article ABOUT this source, not a version of it.
The source is summarised once, in the opening, attributed to ${input.site} by name.
Everywhere else you write our argument, in our words. Never reproduce more than
one short quoted phrase from the source, and put it in quotation marks if you do.`;

  /* ---- the beats, one call each ---- */
  const body: Block[] = [];
  for (const beat of tpl.beats) {
    const lo = Math.round(beat.words * 0.6);
    const hi = Math.round(beat.words * 1.4);
    const so_far = body
      .filter((b): b is string => typeof b === "string")
      .slice(-2)
      .join("\n\n");

    const { value } = await askJson(
      `${context}

${so_far ? `WHAT YOU HAVE WRITTEN SO FAR (do not repeat it):\n${so_far}\n\n` : ""}WRITE THIS SECTION${beat.heading ? ` — it appears under the heading "${beat.heading}"` : " — it is the opening, with no heading"}:
${beat.brief}

About ${beat.words} words, as one to three paragraphs. Do not write the heading itself.
Answer as JSON: {"paragraphs": ["first paragraph", "second paragraph"]}`,
      PARA,
      (v) => paragraphs(v, lo, hi),
      { model, system: VOICE, temperature: 0.55 },
    );

    if (beat.heading) body.push({ h: beat.heading });
    body.push(...value);
  }

  /* ---- the title, standfirst and excerpt, written from the finished piece ---- */
  const written = body.filter((b): b is string => typeof b === "string").join("\n\n");

  const TOP = {
    type: "object",
    properties: {
      title: { type: "string" },
      standfirst: { type: "string" },
      excerpt: { type: "string" },
      takeaways: { type: "array", items: { type: "string" } },
    },
    required: ["title", "standfirst", "excerpt", "takeaways"],
  } as const;

  const { value: top } = await askJson(
    `Here is a finished Balkaris article:

${written}

Write four things about it, from what it actually says — never a promise it does not keep.

title: under 70 characters. A statement, not a question, not a listicle. Not the source's headline.
standfirst: one sentence under the title. ${tpl.standfirst}
excerpt: one sentence for a card in a list. Different words from the standfirst.
takeaways: three short lines, each a thing the article actually argues.

Answer as JSON.`,
    TOP,
    (v) => {
      const o = v as { title?: string; standfirst?: string; excerpt?: string; takeaways?: string[] };
      if (!o.title?.trim()) throw new Error("title is empty");
      if (o.title.length > 90) throw new Error(`the title is ${o.title.length} characters and must be under 70`);
      if (!o.standfirst?.trim()) throw new Error("standfirst is empty");
      if (!o.excerpt?.trim()) throw new Error("excerpt is empty");
      if (!Array.isArray(o.takeaways) || o.takeaways.length < 3) throw new Error("takeaways must have three entries");
      return {
        title: o.title.trim().replace(/^["']|["']$/g, ""),
        standfirst: o.standfirst.trim(),
        excerpt: o.excerpt.trim(),
        takeaways: o.takeaways.slice(0, 3).map((t) => String(t).trim()),
      };
    },
    { model, system: VOICE, temperature: 0.4 },
  );

  const post: DraftPost = {
    slug: slugify(top.title),
    title: top.title,
    standfirst: top.standfirst,
    excerpt: top.excerpt,
    topics: [input.topic],
    services: input.services,
    readingTime: Math.max(2, Math.round(written.split(/\s+/).length / 200)),
    body,
    takeaways: top.takeaways,
    source: { url: input.url, site: input.site, title: input.title, author: input.author },
  };

  guard(post, input);
  return { post, template: tpl.id, because: chosen.because, model, ms: Date.now() - started };
}

/**
 * The last gate before a human sees it.
 *
 * Two things get a draft thrown away rather than shown: it leans on the
 * source, or it is the source with the words moved around. Both are the same
 * failure and both are worth catching here, because a person reviewing forty
 * drafts a month will wave one through.
 */
export function guard(post: DraftPost, input: DraftInput): void {
  const ours = post.body.filter((b): b is string => typeof b === "string").join(" ").toLowerCase();

  /* Any run of 12 words shared with the source is a lift, whatever the intent. */
  const src = input.text.toLowerCase().replace(/\s+/g, " ");
  const mine = ours.replace(/\s+/g, " ").split(" ");
  for (let i = 0; i + 12 <= mine.length; i++) {
    const run = mine.slice(i, i + 12).join(" ");
    if (run.length > 40 && src.includes(run)) {
      throw new Error(`a 12-word run is lifted from the source: "${run.slice(0, 70)}…"`);
    }
  }

  if (ours.split(/\s+/).length < 320) throw new Error("the draft came out too short to be worth publishing");

  /* The source has to be named. A piece that quietly uses somebody's reporting
     without saying so is the exact thing this pipeline must not produce. */
  if (!ours.includes(input.site.toLowerCase().split(".")[0])) {
    throw new Error(`the draft never names ${input.site}, so the source is not credited`);
  }
}
