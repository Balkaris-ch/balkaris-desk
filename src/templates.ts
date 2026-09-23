import type { BlockKind } from "./blocks.ts";
import type { TopicId } from "./catalogue.ts";

/**
 * Three shapes an article can take, and the rule that picks one.
 *
 * Fini, 22 September 2026: *"we should not use AI for that. The blogs could
 * be the same, maybe we have two three templates."* So the shape is decided
 * here, by `pick()`, from facts about the source — not by a model, and not
 * differently every time. Thirty articles that share three skeletons read as
 * a journal. Thirty that each invent their own read as a content farm.
 *
 * A template is a list of BEATS. Each beat is a section of the finished
 * article: its heading, what belongs under it, and how long. The writer in
 * draft.ts turns each beat into one JSON object and nothing else — the model
 * never decides what sections exist, only what goes in them.
 *
 * Every template ends on the same two beats, because every piece here is
 * ultimately an argument that somebody should talk to us, and because a piece
 * that stops without saying what to do is a summary of somebody else's work.
 */

export type TemplateId = "commentary" | "explainer" | "practice";

export interface Beat {
  /** The `##` in the finished article. `null` means it runs on from the last. */
  heading: string | null;
  /** What the writer is told to put here. Written at the model, not the reader. */
  brief: string;
  /** Roughly how many words. The writer is held to ±40%. */
  words: number;
  /**
   * The block shapes this section may use, beyond plain paragraphs.
   *
   * THIS IS THE FORMATTING, AND IT IS HARD-CODED. The schema handed to the
   * model is built from this list, so a section that may not use a list
   * cannot produce one. Every article of a given shape therefore lays out the
   * same way — which is the difference between a journal and thirty pages
   * that each invented their own furniture.
   */
  allow?: BlockKind[];
}

export interface Template {
  id: TemplateId;
  name: string;
  /** One line for the console, so a person can see why this shape was chosen. */
  note: string;
  /** How the standfirst under the title should read. */
  standfirst: string;
  beats: Beat[];
}

/* ---------- the source's own facts, as the rule sees them ------------------ */

export interface SourceFacts {
  title: string;
  topic: TopicId;
  words: number;
  /** ISO date off the page's metadata, if it carried one. */
  published: string | null;
  /** Did the matcher find anything we sell? A piece about nothing we do is a trend piece. */
  services: string[];
}

const CLOSE: Beat[] = [
  {
    heading: "What we would do",
    brief:
      "What Balkaris would actually do about this for a client. Lead with one paragraph, then give the concrete moves as steps: a named decision and one sentence on what it means. Name the decision, not the service. No sales language, no 'we are passionate', no 'get in touch today'.",
    words: 130,
    allow: ["steps"],
  },
  {
    heading: null,
    brief:
      "One closing paragraph, and it is OURS. The single sentence a reader should leave with, plus an honest note on what is still unknown or still to be proved. Do NOT mention the source here, do not summarise it again, do not restate what the article already said. Never a promise.",
    words: 55,
  },
];

const TEMPLATES: Record<TemplateId, Template> = {
  /* Something happened. Most shared links are this. */
  commentary: {
    id: "commentary",
    name: "What happened, and what it means",
    note: "Recent, and about something that changed",
    standfirst: "One sentence on what changed and who it changes things for.",
    beats: [
      {
        heading: null,
        brief:
          "Open with what happened, in two or three sentences, attributed to the source by name and linked. This is the ONLY place the source is summarised. Facts only — dates, numbers, names as the source gives them.",
        words: 75,
      },
      {
        heading: "Why it matters",
        brief:
          "Balkaris's own reading: why this is worth a business owner's attention, or why the coverage is overstating it. Take a position. Do not repeat the source.",
        words: 130,
        allow: ["quote"],
      },
      {
        heading: "What it changes in practice",
        brief:
          "The concrete consequence for a company like the ones we work for — small and mid-sized, mostly Swiss. What is different on Monday, if anything. If the honest answer is 'nothing yet', say that.",
        words: 130,
        allow: ["list"],
      },
      ...CLOSE,
    ],
  },

  /* A question with an answer. Evergreen, and the best kind for search. */
  explainer: {
    id: "explainer",
    name: "The question, answered",
    note: "Evergreen, undated, or a long reference piece",
    standfirst: "The short answer, before the long one.",
    beats: [
      {
        heading: null,
        brief:
          "State the question the piece answers, then answer it in two sentences. The reader who stops here should already have what they came for.",
        words: 70,
      },
      {
        heading: "The longer answer",
        brief:
          "The detail behind the short answer: how it actually works, what the moving parts are. Concrete. Reference the source by name where a fact comes from it. If it has named parts, set them out as steps rather than describing them in a row of sentences.",
        words: 170,
        allow: ["steps"],
      },
      {
        heading: "Where it goes wrong",
        brief:
          "The failure modes — what people get wrong about this, and what it costs them. This is the section that proves the piece was written by someone who has done it. A paragraph, then the mistakes themselves as a list.",
        words: 140,
        allow: ["list"],
      },
      ...CLOSE,
    ],
  },

  /* A tool, a tactic, a claim. We have an opinion because we have used it. */
  practice: {
    id: "practice",
    name: "What we would actually do",
    note: "About a tool or a tactic we have a view on",
    standfirst: "A view from having done it, not from having read about it.",
    beats: [
      {
        heading: null,
        brief:
          "The claim being made — by the source, or by the industry generally — in two or three sentences, attributed and linked.",
        words: 70,
      },
      {
        heading: "Where it holds up",
        brief:
          "Where this genuinely works, and under what conditions. Specific situations, not categories — the conditions themselves belong in a list.",
        words: 130,
        allow: ["list"],
      },
      {
        heading: "Where it does not",
        brief:
          "Where it fails or is oversold. Be direct — this is the section a reader trusts the piece for. Never hedge it into nothing. One aside is allowed if there is a caveat worth setting apart.",
        words: 130,
        allow: ["note"],
      },
      ...CLOSE,
    ],
  },
};

export const template = (id: TemplateId): Template => TEMPLATES[id];
export const allTemplates = (): Template[] => Object.values(TEMPLATES);

/**
 * Which shape. Hard-coded, in this order, and the first rule that fires wins.
 *
 * The order matters more than the rules do: news beats evergreen, because a
 * dated piece written as a timeless explainer reads as if nobody noticed it
 * was news.
 */
export function pick(s: SourceFacts): { id: TemplateId; because: string } {
  const age = s.published ? (Date.now() - Date.parse(s.published)) / 86_400_000 : null;

  /* 1. Genuinely recent, and something happened. */
  if (age !== null && age >= 0 && age <= 45) {
    return { id: "commentary", because: `published ${Math.round(age)} days ago` };
  }

  /* 2. Industry-trends is commentary whatever its date — the shelf exists for
        pieces about something changing. */
  if (s.topic === "industry-trends") {
    return { id: "commentary", because: "shelved under Industry Trends" };
  }

  /* 3. A long reference piece is an explainer. The length is the signal: a
        4,000-word article is documentation, not an opinion. */
  if (s.words >= 2500) {
    return { id: "explainer", because: `${s.words} words — a reference piece` };
  }

  /* 4. Something we actually sell, and therefore have done. */
  if (s.services.length >= 2) {
    return { id: "practice", because: `matched ${s.services.length} of our services` };
  }

  /* 5. Everything else answers a question. */
  return { id: "explainer", because: "no stronger signal — treated as a question to answer" };
}
