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
