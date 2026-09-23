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
 *   runs   eight consecutive words shared with an earlier closing. Catches
 *          literal reuse — the same sentence with the nouns swapped.
 *   shape  how much of the closing's vocabulary is vocabulary an earlier
 *          closing already used. Catches the real problem, which is not
 *          repetition but SAMENESS: "audit your last ten posts" and "review
 *          your recent output" share almost no runs and are the same advice.
 */

const LOOK_BACK = 20;
const RUN = 8;

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

export interface EchoFlag {
  /** The draft whose closing this one resembles. */
  against: number;
  slug: string;
  /** A literal run, when there is one. */
  run?: string;
  /** 0–1: how much of this closing's vocabulary that one already used. */
  shape: number;
}

/**
 * Compare one closing against the closings already written. Returns the
 * worst match, or null when it is unlike all of them.
 */
export function closingEcho(linkId: number, closing: string): EchoFlag | null {
  if (!closing.trim()) return null;

  const earlier = db
    .prepare("SELECT id, slug, post FROM drafts WHERE link_id != ? ORDER BY id DESC LIMIT ?")
    .all(linkId, LOOK_BACK) as { id: number; slug: string; post: string }[];

  const mine = words(closing);
  const myVocab = meaningful(closing);
  if (myVocab.size < 5) return null;

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

    if (run || shape >= 0.4) {
      if (!worst || shape > worst.shape || (run && !worst.run)) {
        worst = { against: row.id, slug: row.slug, shape, ...(run ? { run } : {}) };
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
  const pct = Math.round(flag.shape * 100);
  return `It ends on ${pct}% the same vocabulary as "${flag.slug}". Two pieces of advice can legitimately overlap, but if the closings are becoming interchangeable the journal will start to read that way.`;
}
