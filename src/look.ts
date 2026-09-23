import { count } from "./match.ts";
import type { TopicId } from "./catalogue.ts";

/**
 * What the article is SHAPED like, and what it FEELS like.
 *
 * Fini, 23 September 2026: *"I like the geometric of it but try maybe to
 * create a system where it takes and investigates what it is so it can create
 * some geometric abstract image."*
 *
 * The covers were varied — eight compositions picked from a hash of the slug —
 * and the variety meant nothing. An article about a bottleneck was as likely
 * to get a rising staircase as an article about growth, because a hash does
 * not read. This is the reading.
 *
 * It produces two things and only two:
 *
 *   · MOTION — the shape of the argument. Eight of them. Does the piece say
 *     things go up, come together, come apart, repeat, pile up, get stuck,
 *     join to each other, or come back around? That decides the composition.
 *   · MOOD — the register. Four of them: technical, growth, human, urgent.
 *     That decides the palette.
 *
 * HARD-CODED, for the same reason match.ts is (Fini, 22 September: *"we need
 * to hard-code this at the end of the day"*). A model asked "what does this
 * article feel like" answers fluently and differently every time, and two
 * runs of the same article would give two different covers. A table is wrong
 * in a way you can read, argue with and fix in one line — and this one is
 * tested with fixtures, like the matcher.
 *
 * It also runs for nothing, on the box or the workstation, with no model
 * loaded. That matters more than it sounds: the cover job runs with ComfyUI
 * holding about 19 GB of the card, so a model call at that moment would mean
 * handing the card back and forth twice for one picture.
 */

export type Motion =
  | "rising"
  | "converging"
  | "splitting"
  | "repeating"
  | "layering"
  | "blocked"
  | "connecting"
  | "turning";

export type Mood = "technical" | "growth" | "human" | "urgent";

/**
 * The terms, in two strengths. `strong` is the word doing the arguing;
 * `weak` is the neighbourhood it usually sits in.
 *
 * Each term lives in exactly ONE motion. A term in three buckets scores all
 * three and decides nothing, which is how the first draft of this table
 * returned "repeating" for every article that contained the word "every".
 */
const MOTION_TERMS: Record<Motion, { strong: string[]; weak: string[] }> = {
  rising: {
    strong: ["grow", "growth", "rise", "increase", "scale up", "compound", "climb", "double", "triple", "surge"],
    weak: ["more", "faster", "higher", "gain", "boost", "lift", "momentum", "traction", "upward", "expand"],
  },
  converging: {
    strong: ["consolidate", "converge", "bring together", "in one place", "single source", "unify", "merge", "centralise", "centralize"],
    weak: ["together", "combine", "align", "one place", "funnel", "narrow", "focus", "collapse into"],
  },
  splitting: {
    strong: ["versus", "instead of", "the difference between", "two kinds", "split", "diverge", "fork", "either"],
    weak: ["rather than", "apart", "separate", "distinct", "unlike", "whereas", "opposite", "choose between", "trade-off"],
  },
  repeating: {
    strong: ["every time", "again and again", "repeatable", "at volume", "batch", "template", "over and over", "each week", "each month"],
    weak: ["routine", "consistent", "standard", "dozen", "hundred", "thousand", "recurring", "same way", "day after day"],
  },
  layering: {
    strong: ["foundation", "on top of", "underneath", "built on", "layer", "stack", "groundwork", "beneath"],
    weak: ["structure", "architecture", "base", "depth", "stage", "tier", "build up", "assembled"],
  },
  blocked: {
    strong: ["bottleneck", "stuck", "blocked", "barrier", "friction", "constraint", "dead end", "wall", "held up"],
    /* "cannot" was in here and it is grammar, not meaning: three of the
       first sixteen articles came out blocked on the strength of one
       negation. A term has to name the obstacle, not deny something. */
    weak: ["slow", "delay", "wait", "struggle", "limit", "obstacle", "backlog", "stall", "grind"],
  },
  connecting: {
    strong: ["integrate", "integration", "hand off", "handover", "pipeline", "end to end", "bridge", "connect", "wired together"],
    /* "between" was in here. It is a preposition before it is a claim about
       connection, and it put six of the first sixteen articles on the same
       motion. */
    weak: ["link", "chain", "flow", "route", "path", "thread", "relay", "joined", "feed into"],
  },
  turning: {
    strong: ["loop", "cycle", "feedback", "iterate", "come back", "circle back", "retention", "recurring revenue", "flywheel"],
    weak: ["return", "again later", "revisit", "pivot", "shift", "turn", "round", "renew", "repeat business"],
  },
};

/**
 * The registers. `urgent` has no shelf of its own and no practice behind it —
 * it is a thing the WRITING does, so it is the one mood that can only be
 * earned from the words.
 */
const MOOD_TERMS: Record<Mood, { strong: string[]; weak: string[] }> = {
  technical: {
    strong: ["api", "algorithm", "model", "schema", "infrastructure", "automation", "latency", "protocol", "codebase", "crawler"],
    weak: ["system", "engine", "data", "server", "index", "software", "technical", "machine", "compute", "query"],
  },
  growth: {
    strong: ["conversion", "lead", "enquiry", "revenue", "ranking", "pipeline value", "cost per", "return on"],
    weak: ["traffic", "audience", "reach", "market", "demand", "customer acquisition", "sales", "funnel", "budget", "spend"],
  },
  human: {
    strong: ["craft", "trust", "relationship", "conversation", "story", "voice", "taste", "judgement", "judgment"],
    weak: ["client", "team", "people", "staff", "brand", "care", "experience", "service", "audience feel", "human"],
  },
  urgent: {
    strong: ["losing", "lose", "fall behind", "too late", "replaced", "disappear", "at risk", "quietly", "before it"],
    weak: ["risk", "threat", "waste", "mistake", "expensive", "fail", "miss", "deadline", "shrinking", "eroding"],
  },
};

/** A shelf is a weak opinion about register, and the practice behind it. */
const TOPIC_MOOD: Record<TopicId, Mood> = {
  technology: "technical",
  "ai-automation": "technical",
  marketing: "growth",
  "creative-content": "human",
  "industry-trends": "urgent",
  "behind-the-scenes": "human",
};

/** A matched service's practice says the same thing, more reliably. */
const PRACTICE_MOOD: Record<string, Mood> = {
  digital: "technical",
  growth: "growth",
  studio: "human",
};

/**
 * When the words argue no shape at all, the register picks one.
 *
 * Not one default for everything: a piece with no shape still has a subject,
 * and "a growth piece with nothing else to say is about things going up" is a
 * real claim rather than a shrug.
 */
const FALLBACK_MOTION: Record<Mood, Motion> = {
  technical: "layering",
  growth: "rising",
  human: "connecting",
  urgent: "blocked",
};

export interface Look {
  motion: Motion;
  mood: Mood;
  /** The terms that decided it, for the log and for arguing with. */
  because: { motion: string[]; mood: string[] };
}

/**
 * The title counts three times over.
 *
 * Heavier than the matcher's double, on purpose: a cover is one picture of
 * one claim, and the claim is the title. A word in paragraph nine should
 * nudge the composition, not choose it.
 */
const TITLE_WEIGHT = 3;

function tally<K extends string>(
  terms: Record<K, { strong: string[]; weak: string[] }>,
  title: string,
  body: string,
): { winner: K; because: string[]; argued: boolean; scores: Record<string, number> } {
  const scores = {} as Record<string, number>;
  const reasons = {} as Record<string, string[]>;
  const argued = {} as Record<string, boolean>;

  for (const key of Object.keys(terms) as K[]) {
    let score = 0;
    const because: string[] = [];
    for (const [strength, weight] of [
      ["strong", 4],
      ["weak", 1],
    ] as const) {
      for (const term of terms[key][strength]) {
        const n = count(body, term) + TITLE_WEIGHT * count(title, term);
        if (!n) continue;
        /* Diminishing, exactly as match.ts does it: ten mentions of "stuck"
           do not make a piece ten times more about being stuck. */
        score += weight * (1 + Math.log2(Math.min(n, 8)));
        because.push(term);
        if (strength === "strong") argued[key] = true;
      }
    }
    scores[key] = Math.round(score * 10) / 10;
    reasons[key] = because;
  }

  const winner = (Object.keys(scores) as K[]).reduce((a, b) => (scores[b] > scores[a] ? b : a));
  return { winner, because: reasons[winner] ?? [], argued: argued[winner] ?? false, scores };
}

/**
 * Read the article.
 *
 * `text` is the whole piece — title, standfirst and every paragraph — because
 * the argument's shape is in the argument, not in its headline alone.
 */
export function look(article: {
  title: string;
  text: string;
  topic: TopicId;
  /** Matched service slugs, with the practice each belongs to. */
  practices?: string[];
}): Look {
  const title = ` ${article.title} `;
  const body = ` ${article.title} ${article.text} `;

  const m = tally(MOTION_TERMS, title, body);
  const d = tally(MOOD_TERMS, title, body);

  /* The shelf and the matched practices vote too, but quietly: they are worth
     about one weak term each, so a piece whose words all say "urgent" is
     urgent even when it sits on the technology shelf. */
  const votes = { ...d.scores } as Record<string, number>;
  votes[TOPIC_MOOD[article.topic] ?? "technical"] += 1.5;
  for (const practice of article.practices ?? []) {
    const mood = PRACTICE_MOOD[practice];
    if (mood) votes[mood] += 1.5;
  }
  const mood = (Object.keys(votes) as Mood[]).reduce((a, b) => (votes[b] > votes[a] ? b : a));

  /* THE MOTION HAS TO BE ARGUED. A winner made only of weak terms is not a
     reading, it is a coincidence of vocabulary: "Landing pages require
     specific intent to function" won `connecting` on the strength of the
     words "link" and "path", and got a picture of a route across the frame
     for an article that is not about routes at all.
     When nothing strong fired, the register decides instead — which is a
     smaller claim, honestly made, and still a great deal better than a hash. */
  const motion: Motion = m.argued ? (m.winner as Motion) : FALLBACK_MOTION[mood];

  return {
    motion,
    mood,
    because: {
      motion: m.argued ? m.because.slice(0, 4) : [`nothing argued, so: ${mood}`],
      mood: (d.because.length ? d.because : [article.topic]).slice(0, 4),
    },
  };
}
