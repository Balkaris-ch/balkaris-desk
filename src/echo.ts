import { db } from "./db.ts";

/**
 * Is this article ending the way the last twenty ended?
 *
 * The guard in draft.ts catches an article repeating ITSELF. Nothing catches
 * the JOURNAL repeating itself, and that is the failure that is invisible for
 * a month and then obvious to a reader all at once — by which time thirty of
 * them are live and each one looked fine on its own.
 *
 * It FLAGS, it never rejects. Two pieces of marketing advice legitimately
 * overlap, and a rejection on a similarity score would throw away good
 * articles to prevent a pattern that only a person can judge. The flag goes
 * in front of whoever approves the draft, which is the right weight: we are
 * asking someone to notice something no single draft can show them.
 *
 * Two measures, because they catch different things:
 *
 *   runs     eight consecutive words shared with an earlier closing. Catches
 *            literal reuse — the same sentence with the nouns swapped.
 *   shape    how much of the closing's vocabulary an earlier closing already
 *            used.
 *   phrases  shared two-word phrases carrying a meaningful word, and whether
 *            both open on the same imperative.
 *
 * The third one exists because the first two MISSED THE FIRST REAL CASE, on
 * the day they were written. These two closings were written an hour apart:
 *
 *   "Stop producing content just to fill a calendar. Audit your last ten
 *    posts and delete the ones that failed to drive a specific action."
 *   "Stop your scheduled weekly newsletter for a moment. Instead, audit your
 *    last three automated flows to ensure every single trigger relies on a
 *    specific user action rather than a calendar date."
 *
 * No eight-word run, and 27% shared vocabulary — under the 40% threshold. Both
 * measures said "none" about two paragraphs with the same skeleton: same
 * imperative opener, "audit your last N", the same contrast against a
 * calendar. What repeats when a journal develops a tell is the SHAPE, and the
 * shape lives in short phrases, not in long runs or in a word count.
 */

/**
 * THE NUMBERS BELOW WERE FITTED, NOT MEASURED. Read that before defending them.
 *
 * 30%, two-shared-phrases and the opener rule were chosen by looking at the
 * five drafts they were then tested against, and "two flagged, three clean" is
 * the result they were tuned for. It says the detector can separate those
 * five. In six months these will look like measured constants; they are a
 * first guess made on 23 September 2026.
 *
 * AND THE SAMPLE IS SMALLER THAN THE DRAFT COUNT SUGGESTS. Since the
 * comparison became within-job, twelve drafts across five jobs means each
 * closing is checked against two or three others, not eleven. "No false
 * positives in twelve drafts" is really "none across a handful of within-job
 * pairs", which is five times weaker than it sounds and is the number to
 * quote. It will take a few dozen articles before these thresholds have been
 * tested rather than fitted.
 */
const LOOK_BACK = 20;
const RUN = 8;
const SHAPE_FLAG = 0.3;

/** Words worth comparing: no articles, no prepositions, no auxiliaries. */
const DULL = new Set(
  ("a an the and or but if then than that this these those of to in on at for with from by as is are was were be been " +
    "being do does did done have has had will would can could should may might must not no your you we our it its " +
    "one two three more most less least very just only also about into over under out up down so such each every")
    .split(" "),
);

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const meaningful = (s: string): Set<string> => new Set(words(s).filter((w) => w.length > 3 && !DULL.has(w)));

/**
 * Two-word phrases where at least one word carries meaning.
 *
 * "audit your" and "your last" both qualify; "of the" does not. This is the
 * measure that catches a journal developing a habit, because a habit is a
 * phrase somebody reaches for, not a vocabulary and not a long run.
 */
function bigrams(w: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < w.length; i++) {
    const a = w[i];
    const b = w[i + 1];
    const carries = (x: string) => x.length > 3 && !DULL.has(x);
    if (carries(a) || carries(b)) out.add(`${a} ${b}`);
  }
  return out;
}

export interface EchoFlag {
  /** The draft whose closing this one resembles. */
  against: number;
  slug: string;
  /** A literal run, when there is one. */
  run?: string;
  /** 0–1: how much of this closing's vocabulary that one already used. */
  shape: number;
  /** Two-word phrases both closings use, e.g. "audit your", "your last". */
  phrases: string[];
  /** Both open on the same word — usually the same imperative. */
  opener: string | null;
}

/**
 * Compare one closing against the closings already written. Returns the
 * worst match, or null when it is unlike all of them.
 */
export function closingEcho(linkId: number, closing: string, job?: string | null): EchoFlag | null {
  if (!closing.trim()) return null;

  /* COMPARED WITHIN A JOB, not across all of them.
     Since templates.ts started choosing one of five jobs for the last
     paragraph, two closings sharing a skeleton only means something when they
     were asked the same question. An "action" ending and a "question" ending
     sharing bones is nearly impossible, and comparing them dilutes the signal
     that matters. Drafts written before the jobs existed have no job and are
     compared against everything, which is the old behaviour and right for
     them. */
  const earlier = (
    job
      ? db
          .prepare("SELECT id, slug, post FROM drafts WHERE link_id != ? AND closing = ? ORDER BY id DESC LIMIT ?")
          .all(linkId, job, LOOK_BACK)
      : db
          .prepare("SELECT id, slug, post FROM drafts WHERE link_id != ? ORDER BY id DESC LIMIT ?")
          .all(linkId, LOOK_BACK)
  ) as { id: number; slug: string; post: string }[];

  const mine = words(closing);
  const myVocab = meaningful(closing);
  if (myVocab.size < 5) return null;
  const myPhrases = bigrams(mine);

  let worst: EchoFlag | null = null;

  for (const row of earlier) {
    let theirs: string;
    try {
      const body = (JSON.parse(row.post) as { body: unknown[] }).body;
      const paras = body.filter((b): b is string => typeof b === "string");
      theirs = paras.at(-1) ?? "";
    } catch {
      continue;
    }
    if (!theirs) continue;

    /* Literal reuse. */
    const flat = ` ${words(theirs).join(" ")} `;
    let run: string | undefined;
    for (let i = 0; i + RUN <= mine.length; i++) {
      const r = mine.slice(i, i + RUN).join(" ");
      if (flat.includes(` ${r} `)) {
        run = r;
        break;
      }
    }

    /* Sameness. How much of my vocabulary did they already use? */
    const theirVocab = meaningful(theirs);
    let shared = 0;
    for (const w of myVocab) if (theirVocab.has(w)) shared += 1;
    const shape = Number((shared / myVocab.size).toFixed(2));

    /* Shape. The phrases and the opener — what actually repeats. */
    const theirWords = words(theirs);
    const theirPhrases = bigrams(theirWords);
    const phrases = [...myPhrases].filter((p) => theirPhrases.has(p));
    const opener = mine[0] && mine[0] === theirWords[0] ? mine[0] : null;

    /* 0.3 rather than 0.4, and either two shared phrases or one alongside the
       same opener. Tuned against the real pair above, which scored 0.27. */
    const hit = !!run || shape >= SHAPE_FLAG || phrases.length >= 2 || (!!opener && phrases.length >= 1);
    if (hit) {
      const weight = shape + phrases.length * 0.15 + (opener ? 0.1 : 0);
      const worstWeight = worst ? worst.shape + worst.phrases.length * 0.15 + (worst.opener ? 0.1 : 0) : -1;
      if (!worst || weight > worstWeight || (run && !worst.run)) {
        worst = { against: row.id, slug: row.slug, shape, phrases, opener, ...(run ? { run } : {}) };
      }
    }
  }

  return worst;
}

/** What the person approving the draft is told, in words rather than a score. */
export function echoWords(flag: EchoFlag): string {
  if (flag.run) {
    return `It ends with the same eight words as "${flag.slug}" — "${flag.run}". Worth rewriting before this goes out.`;
  }
  const bits: string[] = [];
  if (flag.opener) bits.push(`both open on "${flag.opener}"`);
  if (flag.phrases.length) bits.push(`both use ${flag.phrases.map((p) => `"${p}"`).join(" and ")}`);
  if (flag.shape >= SHAPE_FLAG) bits.push(`${Math.round(flag.shape * 100)}% the same vocabulary`);

  return (
    `It ends the same shape as "${flag.slug}" — ${bits.join(", ")}. ` +
    `Two pieces of advice can legitimately overlap; a journal whose articles all END the same way reads like one machine wrote them.`
  );
}
