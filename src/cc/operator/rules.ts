import type { DeskJsonLdBlock, DeskJsonLdType } from "../../../web/src/contract/operator.ts";

/**
 * The website's own rules for content/desk/overrides.json, version 2, written
 * out here so the desk refuses what the site would ignore.
 *
 * WHY THE DESK CHECKS AT ALL. The site (balkaris-web-infrastructure,
 * lib/desk.ts) checks every field on its own and ignores one that breaks a
 * rule WITHOUT A WORD, keeping the fields beside it. A person who approved a
 * share picture the site then dropped would believe it was live. So every
 * rule of work/audit/OVERRIDES-V2.md is here, and stricter where the desk can
 * afford to be: it is asked before a person is asked to approve, and again on
 * the file exactly as it will be committed.
 */

/** "/" or "/" followed by lower-case segments, no trailing slash, no dots: what a page's own canonical says. */
export const ADDRESS = /^(?:\/[a-z0-9][a-z0-9_-]*)+$/;
export const isAddress = (a: string): boolean => a === "/" || (ADDRESS.test(a) && a.length <= 200);

/** A share picture's path as the site accepts it: site-relative, lower case, png/jpg/jpeg/webp. */
export const OG_IMAGE = /^(?:\/[a-z0-9][a-z0-9._-]*)+\.(?:png|jpe?g|webp)$/;

export const JSONLD_TYPES: readonly DeskJsonLdType[] = ["FAQPage", "Service", "BreadcrumbList", "Article", "HowTo", "LocalBusiness", "Organization", "Product", "VideoObject", "WebPage"];

/** The site's own limits (lib/desk.ts), and the most it prints of the desk's blocks. */
export const LIMIT = { title: 110, description: 300, path: 200, block: 8192, blocks: 4, picture: 5_242_880 } as const;

/** What the desk lets a person upload: the site takes 5 MiB, a share picture never needs more than this. */
export const UPLOAD_MOST = 600 * 1024;

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Why a text field would be ignored by the site or refused by the desk, or null. Length is counted as written, before trimming, as the site counts it. */
export function textProblem(label: string, v: unknown, most: number): string | null {
  if (typeof v !== "string") return `${label} must be text.`;
  if (!v.trim()) return `${label} is empty.`;
  if (v.length > most) return `${label} is ${v.length} characters; the website takes at most ${most} and ignores a longer one.`;
  if (/[\r\n]/.test(v)) return `${label} may not hold a line break.`;
  if (/[<>]/.test(v)) return `${label} may not hold < or >.`;
  if (v !== v.trim()) return `${label} starts or ends with a space.`;
  return null;
}

/* ---------- pictures --------------------------------------------------------------- */

export interface PictureFacts {
  format: "png" | "jpeg" | "webp";
  width: number;
  height: number;
}

/**
 * The format and pixel size a picture's own header states, read the way the
 * website reads it: a PNG signature and IHDR; a JPEG's frame header (SOF); a
 * RIFF/WEBP whose first chunk is VP8, VP8L or VP8X. Null when it is none of
 * them. The stored frame is read; EXIF orientation is not (the site ignores it too).
 */
export function pictureFacts(b: Uint8Array): PictureFacts | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a && buf.toString("latin1", 12, 16) === "IHDR") {
    return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let at = 2;
    while (at + 4 <= buf.length) {
      if (buf[at] !== 0xff) return null;
      const m = buf[at + 1]!;
      if (m === 0xff) {
        at++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        at += 2;
        continue;
      }
      if (m === 0xd9 || m === 0xda) return null;
      const len = buf.readUInt16BE(at + 2);
      const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
      if (sof) return at + 9 <= buf.length ? { format: "jpeg", height: buf.readUInt16BE(at + 5), width: buf.readUInt16BE(at + 7) } : null;
      at += 2 + len;
    }
    return null;
  }
  if (buf.length >= 30 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
    const chunk = buf.toString("latin1", 12, 16);
    if (chunk === "VP8 " && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) return { format: "webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L" && buf[20] === 0x2f) {
      const bits = buf.readUInt32LE(21);
      return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { format: "webp", width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    return null;
  }
  return null;
}

const EXT_FORMAT: Record<string, PictureFacts["format"]> = { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp" };

/** Why the site would refuse this picture at this path, or null: the five rules of section 2. */
export function pictureProblem(sitePath: string, bytes: Uint8Array): string | null {
  if (sitePath.length > LIMIT.path || !OG_IMAGE.test(sitePath)) return `"${sitePath}" is not a picture address the website accepts: lower case, starting with /, ending in .png, .jpg, .jpeg or .webp.`;
  if (bytes.byteLength < 1 || bytes.byteLength > LIMIT.picture) return `The picture is ${bytes.byteLength} bytes; the website takes 1 byte to 5 MiB.`;
  const f = pictureFacts(bytes);
  if (!f) return "The file is not a PNG, JPEG or WebP picture the website can read.";
  const ext = /\.([a-z]+)$/.exec(sitePath)![1]!;
  if (EXT_FORMAT[ext] !== f.format) return `The file is a ${f.format.toUpperCase()} but its name ends in .${ext}: the website refuses it.`;
  if (f.width < 600 || f.width > 4096 || f.height < 315 || f.height > 4096) return `The picture is ${f.width} by ${f.height} pixels; the website takes 600 to 4096 wide and 315 to 4096 high.`;
  return null;
}

/* ---------- structured data ------------------------------------------------------- */

/** Plain JSON only: what survives a round trip through JSON unchanged. */
const plainJson = (v: unknown): boolean => {
  try {
    return JSON.stringify(JSON.parse(JSON.stringify(v))) === JSON.stringify(v);
  } catch {
    return false;
  }
};

/** Why the site would skip this block, or null. */
export function blockProblem(v: unknown): string | null {
  if (!isPlain(v)) return "A structured-data block must be one JSON object.";
  if (v["@context"] !== "https://schema.org") return 'Its "@context" must be exactly "https://schema.org".';
  const t = v["@type"];
  if (typeof t !== "string" || !(JSONLD_TYPES as readonly string[]).includes(t)) return `Its "@type" must be one of ${JSONLD_TYPES.join(", ")}.`;
  if (!plainJson(v)) return "It holds values that are not plain JSON.";
  const size = Buffer.byteLength(JSON.stringify(v), "utf8");
  if (size > LIMIT.block) return `It is ${size} bytes as compact JSON; the website takes at most ${LIMIT.block}.`;
  return null;
}

/** Every string a block holds, keys and machine values (@context, @type, @id, addresses) left out: what is checked against the page's own words. */
export function blockWords(v: unknown): string[] {
  const out: string[] = [];
  const walk = (x: unknown, key: string) => {
    if (typeof x === "string") {
      if (!["@context", "@type", "@id", "url", "sameAs", "image", "logo", "inLanguage"].includes(key) && !/^https?:\/\//i.test(x)) out.push(x);
    } else if (Array.isArray(x)) for (const y of x) walk(y, key);
    else if (isPlain(x)) for (const [k, y] of Object.entries(x)) walk(y, k);
    else if (typeof x === "number") out.push(String(x));
  };
  walk(v, "");
  return out;
}

/** Addresses in a block that are not the site's own: a block describes this site, never another's. */
export function foreignLinks(v: unknown): string[] {
  const out = new Set<string>();
  const walk = (x: unknown, key: string) => {
    if (key === "@context") return;
    if (typeof x === "string" && /^https?:\/\//i.test(x) && !/^https:\/\/www\.balkaris\.ch(?:[/#?]|$)/.test(x)) out.add(x);
    else if (Array.isArray(x)) for (const y of x) walk(y, key);
    else if (isPlain(x)) for (const [k, y] of Object.entries(x)) walk(y, k);
  };
  walk(v, "");
  return [...out];
}

/* ---------- the file as it will be written ---------------------------------------- */

export interface OverridesFile {
  meta: Record<string, Record<string, unknown>>;
  redirects: { from: string; to: string }[];
  [other: string]: unknown;
}

/**
 * Why the entry for `address` would be ignored, in whole or in part, by the
 * website, in the file as it will be written; empty when every field applies.
 * The canonical rules look at the target's entry too: a chain applies only its
 * last link, and two pages pointing at each other cancel out.
 */
export function entryProblems(address: string, file: OverridesFile): string[] {
  const e = file.meta[address];
  if (e === undefined) return [];
  if (!isPlain(e)) return [`The entry for ${address} is not a JSON object.`];
  const out: string[] = [];
  if (!isAddress(address)) out.push(`"${address}" is not a page address the website matches (lower case, no trailing slash).`);
  for (const [k, most] of [
    ["title", LIMIT.title],
    ["ogTitle", LIMIT.title],
    ["description", LIMIT.description],
    ["ogDescription", LIMIT.description],
  ] as const) {
    if (e[k] !== undefined) {
      const p = textProblem(k, e[k], most);
      if (p) out.push(p);
    }
  }
  if (e.ogImage !== undefined && (typeof e.ogImage !== "string" || e.ogImage.length > LIMIT.path || !OG_IMAGE.test(e.ogImage))) out.push("ogImage is not a picture address the website accepts.");
  if (e.noindex !== undefined && e.noindex !== true) out.push("noindex may only be true; to put a page back in search the field is removed.");
  if (e.noindex === true && address === "/") out.push("The home page can never be taken out of search.");
  if (e.canonical !== undefined) {
    const c = e.canonical;
    if (typeof c !== "string" || !isAddress(c)) out.push("canonical is not an address of this site the website accepts.");
    else if (c === address) out.push("A page cannot name itself as its canonical.");
    else if (address === "/") out.push("The home page can never be given a canonical.");
    else if (e.noindex === true) out.push("A page cannot carry noindex and a canonical: the website applies noindex and ignores the canonical.");
    else {
      const t = file.meta[c];
      if (isPlain(t) && t.noindex === true) out.push(`${c} is out of search (noindex): a canonical pointing there would be ignored.`);
      if (isPlain(t) && typeof t.canonical === "string" && isAddress(t.canonical)) out.push(`${c} has a canonical of its own: the website applies only the last link of a chain.`);
    }
  }
  for (const [other, oe] of Object.entries(file.meta)) {
    if (other !== address && isPlain(oe) && oe.canonical === address && (e.noindex === true || (typeof e.canonical === "string" && isAddress(e.canonical)))) {
      out.push(`${other} names ${address} as its canonical, which then stops applying.`);
    }
  }
  if (e.jsonLd !== undefined) {
    if (!Array.isArray(e.jsonLd) || !e.jsonLd.length) out.push("jsonLd must be a list of one to four blocks.");
    else {
      if (e.jsonLd.length > LIMIT.blocks) out.push(`jsonLd holds ${e.jsonLd.length} blocks; the website prints only the first ${LIMIT.blocks}.`);
      e.jsonLd.forEach((b, i) => {
        const p = blockProblem(b);
        if (p) out.push(`Block ${i + 1}: ${p}`);
      });
    }
  }
  return out;
}

/** The file must survive JSON exactly: the one mistake that stops the website's build. */
export function serialise(file: OverridesFile): string {
  const text = `${JSON.stringify(file, null, 2)}\n`;
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(file)) throw new Error("the overrides file does not survive a round trip through JSON");
  return text;
}

export const asBlock = (v: unknown): DeskJsonLdBlock | null => (blockProblem(v) === null ? (v as DeskJsonLdBlock) : null);
