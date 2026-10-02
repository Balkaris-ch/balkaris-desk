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

/*
 * SIX SHAPES NOW, IN TWO FAMILIES.
 *
 * Fini, 2 October 2026, looking at ten published pieces: *"Like the format of
 * the blogs - right now is the same - it has kinda the same structure. Like 4
 * sections and a faq at the end. But maybe we want another section where is
 * longer and another one that explains the tech side. Maybe even another one
 * that is focused to be readable by a 5 yo and shorter."*
 *
 * He is right about the first three: they differ in what their sections are
 * called and are the same length, the same depth and the same register, so
 * on the page they read as one. The three below them differ in the things a
 * reader actually notices — how long it is, who it is written for, how hard
 * the words are:
 *
 *   deep        about twice the length, with the mechanism and the failures
 *   technical   how it works underneath, for whoever has to build or run it
 *   simple      short, and plain enough for a child to follow
 *
 * THE RULE STILL PICKS AMONG THE FIRST THREE AND ONLY THEM. The second family
 * is ASKED FOR — in Telegram, by a button or a word beside the link
 * (`FORMATS`, `formatIn`) — because whether a piece should be long, technical
 * or plain is a decision about its reader, and the person who shared the link
 * is the one who knows who that is. Nothing here guesses it.
 */
export type TemplateId = "commentary" | "explainer" | "practice" | "deep" | "technical" | "simple";

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
  /**
   * Who it is written for, where that is not the journal's usual reader.
   * Added to the house voice for every call the piece makes — the sections,
   * the title, the questions — so a plain piece is not given a clever title.
   */
  register?: string;
  /** How many questions it answers under the piece. Three unless it says. */
  questions?: number;
  /**
   * The fewest words a finished piece of this shape may have before the
   * guard throws it away as too thin. 320 unless it says: the short shape is
   * short on purpose and the long one must not pass at half its length.
   */
  floor?: number;
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

/** The paragraph every piece ends on. Its job is chosen later: `pickClosing`. */
const last = (words: number): Beat => ({
  heading: null,
  brief:
    "End on one of two things and nothing else: the single thing a reader should do differently this week, or the question the source leaves unanswered and that nobody has answered yet. Be specific enough to act on. Do not recap the article, do not mention the source, do not write a conclusion.",
  words,
  single: true,
  blind: true,
});

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
  last(40),
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

  /* ---- asked for, never picked: see the note above TemplateId ------------- */

  /* The long one. Seven sections where the others have four, about a thousand
     words where they have five hundred. It is long by having more to say —
     the mechanism, the failures, who it is for — never by saying the same
     four things at length, which is why every added section has its own job
     and none of the old ones grew. */
  deep: {
    id: "deep",
    name: "The long read",
    note: "Asked for: about twice the length, with how it works and where it goes wrong",
    standfirst: "One sentence that states the whole argument of the piece as a claim. Never 'you will learn', never 'this article'.",
    questions: 4,
    floor: 560,
    beats: [
      {
        heading: null,
        brief:
          "Open with what happened or what is being claimed, in three or four sentences, attributed to the source by name and linked. This is the ONLY place the source is summarised. Facts only — dates, numbers, names as the source gives them. End the paragraph on the position this article takes about it, in one sentence.",
        words: 95,
      },
      {
        heading: "Why it matters",
        brief:
          "Balkaris's own reading: why this is worth a business owner's attention, or why the coverage is overstating it. Take a position and argue it. Do not repeat the source.",
        words: 150,
        allow: ["quote"],
      },
      {
        heading: "How it actually works",
        brief:
          "The mechanism behind it, for a reader who is not a specialist: what the moving parts are and what each one does, in the order they happen. A paragraph, then the parts as steps. Reference the source by name where a fact comes from it. If the source does not say how a part works, say that rather than filling it in.",
        words: 180,
        allow: ["steps"],
      },
      {
        heading: "What it changes in practice",
        brief:
          "The concrete consequences for a company like the ones we work for — small and mid-sized, mostly Swiss. What is different on Monday. A paragraph, then the consequences as a list. If the honest answer for most of them is 'nothing yet', say that, and say for whom it is not nothing.",
        words: 150,
        allow: ["list"],
      },
      {
        heading: "Where it goes wrong",
        brief:
          "The failure modes — what people get wrong about this, and what it costs them. This is the section that proves the piece was written by someone who has done it. A paragraph, then the mistakes themselves as a list.",
        words: 140,
        allow: ["list"],
      },
      {
        heading: "Who should act, and who should wait",
        brief:
          "Which companies this is for now, and which should leave it alone for the moment — described by their situation, not by their size. Be direct, and never hedge it into 'it depends' without saying on what. One aside is allowed if there is a caveat worth setting apart.",
        words: 120,
        allow: ["note"],
      },
      ...CLOSE,
    ],
  },

  /* The same subject for the person who has to build it or keep it running.
     What makes it technical is the register and the questions it answers —
     what goes in, what each part does, what it needs, where it breaks — not
     jargon sprinkled on the standard piece. The register is strict about
     invention because this is the shape where a made-up limit or a made-up
     library name is most plausible and does the most damage. */
  technical: {
    id: "technical",
    name: "The technical side",
    note: "Asked for: how it works underneath, for whoever has to build or run it",
    standfirst: "One sentence naming what it is and the one technical fact about it that matters most.",
    register: `THIS PIECE IS FOR A TECHNICAL READER — a developer, an engineer, a CTO.
- Name the parts: the components, the data that moves between them, the formats and protocols, in the words a practitioner uses. Do not explain a term an engineer already knows.
- Say HOW, in order. Never an analogy in place of the mechanism.
- Only what the source states, or what is general engineering knowledge. No invented version numbers, limits, benchmarks, model names or library names. Where the source does not say how a part works, write that it does not say.
- No code samples.`,
    floor: 400,
    beats: [
      {
        heading: null,
        brief:
          "Say what the thing is, and what is technically new or different about it, in two or three sentences, attributed to the source by name and linked. This is the ONLY place the source is summarised.",
        words: 80,
      },
      {
        heading: "How it works",
        brief:
          "The mechanism, part by part, in the order the parts act: what goes in, what each component does with it, what comes out. A paragraph, then the parts as steps — each step a named component or stage, and one sentence on what it does. Reference the source by name where a fact comes from it.",
        words: 190,
        allow: ["steps"],
      },
      {
        heading: "What it takes to run",
        brief:
          "What has to exist around it before it works in a real company: the systems it must connect to, the data it needs and in what state, who has to maintain it. A paragraph, then the requirements as a list. Only what follows from the source or from ordinary engineering practice.",
        words: 140,
        allow: ["list"],
      },
      {
        heading: "Where it breaks",
        brief:
          "The technical limits and failure modes: what it cannot do, what goes wrong at the edges, what fails without saying so. Be direct — this is the section an engineer trusts the piece for. A paragraph, then the failure modes as a list. One aside is allowed if there is a caveat worth setting apart.",
        words: 140,
        allow: ["list", "note"],
      },
      {
        heading: "How we would build it",
        brief:
          "How Balkaris would approach this in a client's own systems. Lead with one paragraph, then the engineering decisions as steps: a named decision and one sentence on why it is made that way. Name the decision, not the service. No sales language.",
        words: 130,
        allow: ["steps"],
      },
      last(40),
    ],
  },

  /* Short, and plain. "Readable by a five-year-old" is the brief as he gave
     it; what the register asks for is the thing that phrase means in a
     business journal — sentences a child could follow, about something that
     is still exactly true. It is the shape for a reader who will give a piece
     one minute, and for a subject whose usual coverage is unreadable.
     Half the length of the standard piece, two questions under it, and the
     same rule about the source as every other shape. */
  simple: {
    id: "simple",
    name: "In plain words",
    note: "Asked for: short, and plain enough for a child to follow",
    standfirst: "One short sentence that a child could repeat to somebody else.",
    register: `THIS PIECE IS WRITTEN SO THAT A CHILD COULD FOLLOW IT.
- Short sentences: twelve words or fewer, one idea in each.
- Everyday words only. A word a ten-year-old would not know is replaced by what it means, or explained once with a comparison from ordinary life — a shop, a kitchen, a school, a road.
- No abbreviations unless they are spelled out the first time. No jargon at all.
- Simple is not vague. The names, and what actually happened, stay exactly as they are.
- The title, the line under it and the questions are written the same way.`,
    questions: 2,
    floor: 160,
    beats: [
      {
        heading: null,
        brief:
          "Say what happened in three or four short sentences, attributed to the source by name. This is the ONLY place the source is summarised.",
        words: 55,
      },
      {
        heading: "What it means",
        brief:
          "Explain the idea with ONE comparison from everyday life, and stay with that one comparison. Then say, in one sentence, what is really going on.",
        words: 75,
      },
      {
        heading: "Why it matters to you",
        brief:
          "Why somebody who runs a small business should care. One short paragraph, then two or three plain consequences as a list.",
        words: 65,
        allow: ["list"],
      },
      {
        heading: "What to do",
        brief:
          "What Balkaris would do about it, in the plainest words there are. One short paragraph, then two or three things to do as steps: the thing to do, and one short sentence on why.",
        words: 65,
        allow: ["steps"],
      },
      last(28),
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

/* ---------- how it was asked to be written ---------------------------------

   Fini, 2 October 2026: *"I need the Telegram to give me options on how to
   write the articles."* These are the options. `standard` is the rule above,
   unchanged; each of the others is one of the three asked-for shapes.

   THE WORDS ARE CHOSEN TO BE TYPED BESIDE A LINK ON A PHONE, the way "text
   only" already is (intake.ts): one of them anywhere in the message is the
   answer, and the bot does not ask. Without one it offers the four as buttons
   and waits a minute and a half before writing the standard way, so a link
   shared and forgotten is still written. */

export type Format = "standard" | "deep" | "technical" | "simple";

export const FORMATS: Record<Format, { button: string; as: string; word: RegExp | null }> = {
  standard: { button: "Standard", as: "the standard way", word: /\b(standard|normal|usual)\b/i },
  deep: { button: "Long read", as: "as a long read", word: /\b(long|longer|long[ -]?read|in[ -]depth|deep(er)?( dive)?|detailed)\b/i },
  technical: { button: "Technical", as: "from the technical side", word: /\b(tech|technical|for (devs|developers|engineers))\b/i },
  simple: { button: "In plain words", as: "short and in plain words", word: /\b(simple|simpler|plain|short|shorter|eli5|for (a )?(kid|child|5[ -]?(yo|year[ -]old)))\b/i },
};

export const isFormat = (v: unknown): v is Format => typeof v === "string" && v in FORMATS;

/**
 * Did the message say how to write it?
 *
 * Only what the person typed is read, never the link: a url with "simple" or
 * "long" in its path is somebody else's word. The first format whose word is
 * there wins, in an order that puts the rarer intentions first — "a short
 * technical piece" is a technical piece.
 */
export function formatIn(typed: string): Format | null {
  const words = typed.replace(/https?:\/\/\S+/gi, " ");
  for (const f of ["technical", "simple", "deep", "standard"] as const) {
    if (FORMATS[f].word?.test(words)) return f;
  }
  return null;
}

/** The shape a piece is written in: the one asked for, or the rule's. */
export function shapeFor(format: Format | null | undefined, s: SourceFacts): { id: TemplateId; because: string } {
  if (format && format !== "standard") return { id: format, because: "asked for when the link was shared" };
  return pick(s);
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

  if (f.template === "commentary" || f.template === "simple") {
    return {
      job: "caution",
      because: f.template === "simple" ? "the plain piece has no failure section of its own" : "a news piece has no failure section of its own",
    };
  }

  return { job: "question", because: "the actions are already set out as steps above" };
}
