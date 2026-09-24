import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Where a drawn cover lives between being drawn and being published.
 *
 * On disk, not in the database. A picture is a file, SQLite is holding a
 * queue, and a 50 KB blob per article would grow the one thing on this box
 * that has to stay quick to read. The words that go with it — the alt text
 * and the caption — are columns on the draft, because they are text about the
 * article rather than the picture itself.
 */

const DIR = process.env.DESK_COVERS ?? "/opt/balkaris-desk/covers";

const file = (slug: string) => path.join(DIR, `${slug.replace(/[^a-z0-9-]/gi, "")}.webp`);

export function saveCover(slug: string, webp: Buffer): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file(slug), webp);
}

export function coverPath(slug: string): Buffer | null {
  const f = file(slug);
  return existsSync(f) ? readFileSync(f) : null;
}

export const hasCover = (slug: string): boolean => existsSync(file(slug));

export function dropCover(slug: string): void {
  rmSync(file(slug), { force: true });
}

/* ---- the video's own excerpt ------------------------------------------------
 *
 * Same reasoning as the cover, same folder shape, different extension: a file
 * is a file and SQLite is holding a queue. Two of them per article — the
 * silent clip and its first frame — because a <video> with no poster is an
 * empty box for as long as the network takes.
 *
 * See src/social/preview.ts for why we serve our own excerpt at all rather
 * than the platform's player.
 */

const CLIPS = process.env.DESK_CLIPS ?? "/opt/balkaris-desk/clips";

const clean = (slug: string) => slug.replace(/[^a-z0-9-]/gi, "");
const clipFile = (slug: string) => path.join(CLIPS, `${clean(slug)}.mp4`);
const posterFile = (slug: string) => path.join(CLIPS, `${clean(slug)}.webp`);

/* A third tiny file beside the two: how many seconds are in the clip and
   whether that is all of the video. The caption on the site says which, and a
   JSON file is the smallest thing that can carry two facts without a
   migration. */
const factsFile = (slug: string) => path.join(CLIPS, `${clean(slug)}.json`);

export function saveClip(slug: string, clip: Buffer, poster: Buffer, facts?: { seconds: number; whole: boolean }): void {
  mkdirSync(CLIPS, { recursive: true });
  writeFileSync(clipFile(slug), clip);
  writeFileSync(posterFile(slug), poster);
  if (facts) writeFileSync(factsFile(slug), JSON.stringify(facts), "utf8");
}

export function clipFacts(slug: string): { seconds: number; whole: boolean } | null {
  const f = factsFile(slug);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as { seconds: number; whole: boolean };
  } catch {
    return null;
  }
}

export function clipPath(slug: string): { clip: Buffer; poster: Buffer } | null {
  const c = clipFile(slug);
  const p = posterFile(slug);
  if (!existsSync(c) || !existsSync(p)) return null;
  return { clip: readFileSync(c), poster: readFileSync(p) };
}

export const hasClip = (slug: string): boolean => existsSync(clipFile(slug));

export function dropClip(slug: string): void {
  rmSync(clipFile(slug), { force: true });
  rmSync(posterFile(slug), { force: true });
}
