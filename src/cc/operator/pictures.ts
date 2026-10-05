import { createHash } from "node:crypto";
import sharp from "sharp";
import { HTTPException } from "hono/http-exception";
import { db } from "../../db.ts";
import type { Person } from "../../people.ts";
import type { UploadedPicture } from "../../../web/src/contract/operator.ts";
import { pictureFacts, pictureProblem, UPLOAD_MOST } from "./rules.ts";
import { now, uploadedPicture } from "./tables.ts";

/**
 * A share picture a person uploads for a page.
 *
 * Made ready here, once, so what is approved is exactly what is committed:
 * upright (the website reads the stored frame and ignores EXIF orientation,
 * so a phone photo would otherwise show on its side), 1200 by 630 when it is
 * larger (the size of every other share picture on the site, and what the
 * networks crop to), re-encoded in its own format (which also drops the
 * camera's metadata). Then checked by the website's own five rules.
 *
 * Its name is the page's slug and a hash of the final bytes: a new picture is
 * always a new file name, which the site asks for (networks cache a share
 * picture by its address for days), and the same picture uploaded twice is
 * one file.
 */

const fail = (message: string): never => {
  throw new HTTPException(400, { message });
};

const EXT = { png: "png", jpeg: "jpg", webp: "webp" } as const;

/** "/" is "home"; "/insights/what-to-measure" is "insights-what-to-measure". */
export const slugOf = (address: string): string => (address === "/" ? "home" : address.slice(1).replace(/\//g, "-").slice(0, 80).replace(/-+$/, "")) || "page";

export async function takeUpload(address: string, base64: string, by: Person): Promise<UploadedPicture> {
  const clean = base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || !clean) fail("The picture did not arrive as a file: choose it again.");
  const raw = Buffer.from(clean, "base64");
  if (raw.length > UPLOAD_MOST) fail(`The picture is ${Math.round(raw.length / 1024)} KB; the desk takes at most ${UPLOAD_MOST / 1024} KB. Save it smaller (1200 by 630 as a JPEG is plenty).`);
  const facts = pictureFacts(raw) ?? fail("That file is not a PNG, JPEG or WebP picture.");

  let img = sharp(raw, { failOn: "error" }).rotate();
  const meta = (await sharp(raw).metadata().catch(() => null)) ?? fail("The picture could not be read: it may be damaged.");
  /* Orientations 5 to 8 turn the picture a quarter: its upright width is the stored height. */
  const turned = (meta.orientation ?? 1) >= 5;
  const w = turned ? (meta.height ?? 0) : (meta.width ?? 0);
  const h = turned ? (meta.width ?? 0) : (meta.height ?? 0);
  if (w < 600 || h < 315) fail(`The picture is ${w} by ${h} pixels; a share picture needs at least 600 by 315 (1200 by 630 is best).`);
  if (w > 1200 || h > 630) img = img.resize(1200, 630, { fit: "cover", position: "centre" });
  const out =
    facts.format === "png" ? await img.png({ compressionLevel: 9 }).toBuffer() : facts.format === "webp" ? await img.webp({ quality: 85 }).toBuffer() : await img.jpeg({ quality: 85, mozjpeg: true }).toBuffer();

  const name = `${slugOf(address)}-${createHash("sha256").update(out).digest("hex").slice(0, 8)}.${EXT[facts.format]}`;
  const sitePath = `/desk/og/${name}`;
  const problem = pictureProblem(sitePath, out);
  if (problem) fail(problem);
  const f = pictureFacts(out)!;
  db.prepare("INSERT OR IGNORE INTO cc_op_pictures (name, address, format, width, height, bytes, data, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    name,
    address,
    f.format,
    f.width,
    f.height,
    out.length,
    out,
    by.name,
    now(),
  );
  return uploadedPicture(sitePath)!;
}

/** The bytes of an uploaded picture, and its type, for the desk to show and to commit. */
export function pictureBytes(name: string): { data: Buffer; type: string } | null {
  const r = db.prepare("SELECT data, format FROM cc_op_pictures WHERE name = ?").get(name) as { data: Uint8Array; format: string } | undefined;
  return r ? { data: Buffer.from(r.data), type: `image/${r.format}` } : null;
}
