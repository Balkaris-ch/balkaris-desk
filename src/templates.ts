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
  /**
   * Exactly one paragraph, and nothing else. A beat with no room to ramble
   * cannot ramble.
   */
  single?: boolean;
  /**
   * Write this one WITHOUT the preceding paragraphs in the prompt.
   *
   * Proximity is the whole problem: if the opening is in context when the
   * closing is generated, the model reaches for it, because that is what
   * proximity does. A beat that must not echo the piece is given the argument
   * and the source, not the piece's own words.
   */
  blind?: boolean;
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
  /*
   * THE LAST BEAT IS NOT A CONCLUSION, AND THAT IS DELIBERATE.
   *
   * It used to be "close the piece", and it drifted into re-summarising the
   * source every time — including in capitals, told not to. A capitalised
   * prohibition always loses to a job whose most probable completion IS the
   * thing prohibited. So the job changed rather than the emphasis: name the
   * one thing to do differently this week, or the question the source left
   * open. Neither has a summary-shaped answer to fall into.
   *
   * Forty words, one paragraph, and written WITHOUT the rest of the article in
   * context, so there is nothing nearby to echo.
   */
  {
    heading: null,
    brief:
      "End on one of two things and nothing else: the single thing a reader should do differently this week, or the question the source leaves unanswered and that nobody has answered yet. Be specific enough to act on. Do not recap the article, do not mention the source, do not write a conclusion.",
    words: 40,
    single: true,
    blind: true,
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

/* ---------- how a piece ends -------------------------------------------------

   FIVE JOBS AND A RULE, for the same reason there are three templates and a
   rule. One job produces one habit: every article was given "the one thing to
   do differently this week", and "Stop X. Audit your last N Y." is what that
   job reaches for. Giving the close the article's own thesis fixed the CONTENT
   of the sentence and could not touch its bones, because the bones come from
   the job.

   Five jobs do not make convergence impossible. They make it five times
   slower and far more visible when it happens, because then two closings that
   share a skeleton are two closings doing the SAME job — which is a habit —
   rather than two doing different ones, which is nearly impossible.

   The rule is deterministic and reads real facts, never a coin toss: a journal
   that varies unpredictably is as strange to a reader as one that repeats. */

export type ClosingJob = "action" | "question" | "caution" | "contrast" | "prediction";

export const CLOSING_JOBS: Record<ClosingJob, { name: string; brief: string }> = {
  action: {
    name: "The one thing to do",
    brief:
      "End on the single thing a reader should do differently this week. Specific enough to act on before Friday. Not a list, not a plan — one move.",
  },
  question: {
    name: "The open question",
    brief:
      "End on the question the source leaves unanswered and that nobody has answered yet. State it plainly and say why it is still open. Do not answer it yourself.",
  },
  caution: {
    name: "How it goes wrong",
    brief:
      "End on the way this most often fails for the people who try it — the specific mistake, and what it costs them. Not a warning in general terms; the actual failure.",
  },
  contrast: {
    name: "What the good ones do",
    brief:
      "End on what the people who get this right do differently from everybody else. One concrete difference in how they work, not a quality they possess.",
  },
  prediction: {
    name: "Where this goes",
    brief:
      "End on what is likely to be different about this within a year, and say what would have to be true for that to happen. Commit to a view. Never hedge it into nothing.",
  },
};

export interface ClosingFacts {
  template: TemplateId;
  topic: TopicId;
  /** How many Balkaris services the matcher found. Zero changes the ending. */
  services: number;
  /** Days since the source was published, when it said. */
  ageDays: number | null;
  /** Did "What we would do" actually produce a steps block? */
  hasSteps: boolean;
  /** Did any earlier section produce a list? */
  hasList: boolean;
}

/**
 * Which of the five, and why.
 *
 * WRITTEN TWICE. The first version made `hasSteps` the second rule, and
 * `hasSteps` is true of nearly every article — the "What we would do" section
 * asks for steps and the model obliges. Three marketing pieces in a row came
 * back "ends on question", which is the original bug one level down: five jobs
 * collapsed to one, and I had swapped a habit for a habit.
 *
 * So `hasSteps` no longer SELECTS a job. It removes one — you cannot end on
 * "do this one thing" when the things to do are already set out as steps
 * immediately above — and the choice is made among what is left, by facts
 * that genuinely differ between articles of the same shelf and template.
 */
export function pickClosing(f: ClosingFacts): { job: ClosingJob; because: string } {
  /* Nothing we sell. "What we would do" was thin, so do not end on doing. */
  if (f.services === 0) {
    return { job: "contrast", because: "no service matched — we cannot end on what we would do" };
  }

  /* Something changed and a reader wants to know where it goes. */
  if (f.topic === "industry-trends") {
    return { job: "prediction", because: "shelved under Industry Trends" };
  }
  if (f.ageDays !== null && f.ageDays >= 0 && f.ageDays <= 45) {
    return { job: "prediction", because: `the source is ${Math.round(f.ageDays)} days old` };
  }

  /* No steps above means nothing on the page has told the reader what to do,
     so the close is the only place left for it. */
  if (!f.hasSteps) {
    return { job: "action", because: "nothing above tells the reader what to do" };
  }

  /* From here the actions are already on the page and "action" is out. What
     remains is decided by how crowded the subject turned out to be, which is
     a real difference between two pieces on the same shelf.
     `caution` is not offered to an explainer or a practice piece: both already
     carry a section about how it goes wrong, and ending on the same thing
     twice is the duplication we are trying to avoid. */
  if (f.services >= 3) {
    return { job: "contrast", because: "three services matched — a crowded subject, so end on what the good ones do" };
  }

  if (f.template === "commentary") {
    return { job: "caution", because: "a news piece has no failure section of its own" };
  }

  return { job: "question", because: "the actions are already set out as steps above" };
}
