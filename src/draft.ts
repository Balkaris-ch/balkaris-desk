import { askJson, WRITE_MODEL } from "./llm.ts";
import { CLOSING_JOBS, pick, pickClosing, template, type ClosingJob, type SourceFacts, type TemplateId } from "./templates.ts";
import { serviceName, TOPICS, type TopicId } from "./catalogue.ts";
import { countWords, howTo, proseOf, schemaFor, toPostBlocks, type PostBlock } from "./blocks.ts";

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
- Plain, direct sentences, mostly under 25 words — but VARY THEM. Eight short sentences in a row reads like a machine. Let a longer one carry a qualification.
- Specifics instead of adjectives: a number, a name, a date, a decision. Never "cutting-edge", "seamless", "robust", "game-changing", "leverage", "unlock", "in today's fast-paced world", "the landscape of".
- British spelling: optimise, analyse, colour, recognise.
- A position, stated. If something is oversold, say so. If the honest answer is "it depends", say what it depends on.
- Never "we are passionate about". Never a rhetorical question as a heading. Never an em-dash-heavy rhythm.
- Address the reader as "you". Refer to the company as "we".
- Nothing invented: no statistics, no client names, no case studies, no quotes. If you do not know a number, do not write one.
- Never paste a URL into the prose. Name the publication; the link is attached afterwards.`;

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
  /**
   * What to call the source in the prose, GIVEN rather than derived.
   *
   * publicationName() turns a hostname into the name a writer would use, which
   * is right for an article and nonsense for a social post: the runner hands
   * the writer a made-up site string like "nomadatoast on tiktok" and it came
   * back title-cased as "Nomadatoast on tiktok". For a video or a carousel the
   * credit is the handle and the platform, so the caller says so.
   */
  publication?: string;
  /**
   * The one word the credit guard must find in the finished prose. For a
   * social post that is the handle — the model will write "@nomadatoast" or
   * "nomadatoast", never the whole phrase. Derived from `publication` when
   * absent.
   */
  credit?: string;
}

export type Block = PostBlock;

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
  /** Blocks the model sent that did not survive validation, and why. */
  dropped: string[];
  /** Which of the five jobs the last paragraph was given, and why. */
  closing: { job: ClosingJob; because: string };
}

/**
 * The name a writer would actually use. `en.wikipedia.org` is Wikipedia, not
 * "en.wikipedia.org" — and the first draft off this pipeline wrote the
 * hostname into the prose four times, which is the single clearest tell that
 * a machine produced it.
 *
 * Subdomains that are plumbing go (www, blog, news, en, m, developers); what
 * is left is title-cased, with the few names that are not a plain word given
 * by hand. It is a heuristic and it is allowed to be: the worst case is the
 * hostname, which is where it started.
 */
const KNOWN: Record<string, string> = {
  "wikipedia.org": "Wikipedia",
  "google.com": "Google",
  "theverge.com": "The Verge",
  "nytimes.com": "The New York Times",
  "ft.com": "the Financial Times",
  "nzz.ch": "the NZZ",
  "srf.ch": "SRF",
  "techcrunch.com": "TechCrunch",
  "arstechnica.com": "Ars Technica",
  "searchengineland.com": "Search Engine Land",
  "github.com": "GitHub",
  "openai.com": "OpenAI",
  "anthropic.com": "Anthropic",
};

export function publicationName(site: string): string {
  const host = site.toLowerCase().replace(/^www\./, "");
  for (const [domain, name] of Object.entries(KNOWN)) {
    if (host === domain || host.endsWith(`.${domain}`)) return name;
  }
  const bare = host.replace(/^(blog|news|en|m|developers|dev|about|help|support)\./, "");
  const word = bare.split(".")[0];
  return word.charAt(0).toUpperCase() + word.slice(1);
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

  const publication = input.publication ?? publicationName(input.site);

  const context = `THE SOURCE
Title: ${input.title}
Publication: ${publication}${input.author ? `\nAuthor: ${input.author}` : ""}

${window(input.text)}

--- end of source ---

THIS ARTICLE
Shelf: ${shelf}
Balkaris services it touches: ${sold.length ? sold.join(", ") : "none directly"}
Shape: ${tpl.name}

THE RULE THAT MATTERS MOST
You are writing Balkaris's own article ABOUT this source, not a version of it.
The source is summarised once, in the opening, attributed to ${publication} by name.
Everywhere else you write our argument, in our words. Never reproduce more than
one short quoted phrase from the source, and put it in quotation marks if you do.`;

  /* ---- the beats, one call each ---- */
  const body: Block[] = [];
  const dropped: string[] = [];

  /**
   * One sentence: the claim this piece actually landed on.
   *
   * Written just before the closing beat and given to it INSTEAD of the
   * source, the preceding paragraphs or a window of anything. Blinding the
   * close to everything specific removed the summary and bought a worse
   * problem: the advice became true of the shelf rather than of the article,
   * so every marketing piece would end the same shape and the journal would
   * grow a tell. A single sentence is too small a surface to pad back into a
   * summary, and big enough for the closing action to follow from THIS
   * argument.
   */
  let thesis = "";
  let closing: { job: ClosingJob; because: string } = { job: "action", because: "not decided yet" };

  for (const beat of tpl.beats) {
    const lo = Math.round(beat.words * 0.6);
    const hi = Math.round(beat.words * 1.4);
    const allow = beat.allow ?? [];

    /* A `blind` beat is written without the article's own words in front of
       it — see the note on the last beat in templates.ts. Proximity is the
       whole problem: what is in context is what gets echoed. */
    const so_far = beat.blind
      ? ""
      : body
          .filter((b): b is string => typeof b === "string")
          .slice(-2)
          .join("\n\n");

    /* A `blind` beat is given the ARTICLE's own thesis and NOTHING else — not
       the source, not the preceding paragraphs, not a window of either.
       Blinding it to the paragraphs alone was not enough: the source window
       was still in context and the model still opened on "Wikipedia
       defines…". Proximity does not care which part of the prompt the text
       came from. */
    /* The last beat's JOB is chosen here, from what the article actually
       turned out to be — not fixed in the template, because one job produces
       one habit. See the note above pickClosing in templates.ts. */
    if (beat.blind) {
      closing = pickClosing({
        template: tpl.id,
        topic: input.topic,
        services: input.services.length,
        ageDays: input.published ? (Date.now() - Date.parse(input.published)) / 86_400_000 : null,
        hasSteps: body.some((b) => typeof b !== "string" && "steps" in b),
        hasList: body.some((b) => typeof b !== "string" && "list" in b),
      });
    }

    if (beat.blind && !thesis) {
      const { value } = await askJson(
        `Here is a Balkaris article:

${proseOf(body)}

In ONE sentence, what does it argue? The claim itself, not a description of the article. Under 30 words.`,
        { type: "object", properties: { thesis: { type: "string" } }, required: ["thesis"] },
        (v) => {
          const got = String((v as { thesis?: unknown })?.thesis ?? "").trim();
          if (!got) throw new Error("thesis is empty");
          return got;
        },
        { model, system: VOICE, temperature: 0.3 },
      );
      thesis = value;
    }

    const brief_context = beat.blind
      ? `You are writing the last paragraph of a Balkaris article.

What the article argues: ${thesis}

Everything else about it is already on the page above this paragraph. Do not
describe the article, do not name where its subject came from, and do not give
advice that would fit equally well on any other article about ${shelf.toLowerCase()} — it
has to follow from the claim above.`
      : context;

    const { value } = await askJson(
      `${brief_context}

${so_far ? `WHAT YOU HAVE WRITTEN SO FAR (do not repeat it):\n${so_far}\n\n` : ""}WRITE THIS SECTION${beat.heading ? ` — it appears under the heading "${beat.heading}"` : " — it is the opening, with no heading"}:
${beat.blind ? CLOSING_JOBS[closing.job].brief : beat.brief}

About ${beat.words} words. Do not write the heading itself.

Answer as JSON: {"blocks": [ ... ]}, where every block is ONE of these shapes:
${howTo(allow)}

Open the section on a paragraph. Never a list or a table first, and never a
shape that is not in the list above.`,
      schemaFor(allow),
      (v) => {
        const got = toPostBlocks(v, allow);
        if (!got.blocks.length) throw new Error("nothing usable came back");
        if (typeof got.blocks[0] !== "string") throw new Error("a section opens on a paragraph, not on a list or a table");
        if (beat.single && got.blocks.length !== 1) {
          throw new Error(`this section is exactly one paragraph and you wrote ${got.blocks.length}`);
        }
        /* The doctrine everywhere else here: make the wrong answer impossible
           to submit rather than ask for it not to be given. A blind beat that
           names the source has summarised it, whatever else it also did. */
        if (beat.blind) {
          const said = proseOf(got.blocks).toLowerCase();
          const name = publication.toLowerCase().replace(/^the /, "").replace(/^@/, "");
          if (name.length > 2 && said.includes(name)) {
            throw new Error(`do not mention ${publication} in this paragraph — it belongs to the opening, not the close`);
          }
        }
        const n = countWords(got.blocks);
        if (n < lo) throw new Error(`that is ${n} words and the section needs about ${beat.words}`);
        if (n > hi) throw new Error(`that is ${n} words, which is too long — the section needs about ${beat.words}`);
        return got;
      },
      { model, system: VOICE, temperature: 0.55 },
    );

    if (beat.heading) body.push({ h: beat.heading });
    body.push(...value.blocks);
    dropped.push(...value.dropped);
  }

  /* ---- the title, standfirst and excerpt, written from the finished piece ---- */
  const written = proseOf(body);

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
    readingTime: Math.max(2, Math.round(countWords(body) / 200)),
    body,
    takeaways: top.takeaways,
    source: { url: input.url, site: input.site, title: input.title, author: input.author },
  };

  guard(post, input);
  return { post, template: tpl.id, because: chosen.because, model, ms: Date.now() - started, dropped, closing };
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
  const ours = proseOf(post.body).toLowerCase();

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

  /* The same run check, turned inward: does the piece end by repeating how it
     began? A BACKSTOP, not the fix — it catches literal repetition and not a
     paraphrase, and the real answer was giving the last beat a job that has no
     summary-shaped completion (templates.ts). Eight words rather than twelve,
     because a writer echoing themselves reuses shorter phrases than a writer
     lifting from a source. */
  const paras = post.body.filter((b): b is string => typeof b === "string");
  const first = (paras[0] ?? "").toLowerCase().replace(/\s+/g, " ");
  const last = (paras.at(-1) ?? "").toLowerCase().replace(/\s+/g, " ").split(" ");
  for (let i = 0; i + 8 <= last.length; i++) {
    const run = last.slice(i, i + 8).join(" ");
    if (run.length > 28 && first.includes(run)) {
      throw new Error(`the last paragraph repeats the first: "${run}"`);
    }
  }

  /* The source has to be named. A piece that quietly uses somebody's reporting
     without saying so is the exact thing this pipeline must not produce.
     Checked against the PUBLICATION name, not the hostname: the prose says
     "Wikipedia" now, and `site.split(".")[0]` was "en", which matches almost
     any English sentence and so checked nothing at all. */
  const named = input.publication ?? publicationName(input.site);
  const token = (input.credit ?? named).toLowerCase().replace(/^the /, "").replace(/^@/, "");
  if (!ours.includes(token) && !ours.includes(input.site.toLowerCase())) {
    throw new Error(`the draft never names ${named}, so the source is not credited`);
  }
}
