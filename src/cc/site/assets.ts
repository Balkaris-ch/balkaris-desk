import sharp from "sharp";
import type { Reading, Share } from "../../../web/src/contract/common.ts";
import { db } from "../../db.ts";
import type { Job } from "../scheduler.ts";
import { keep, kept, ok, setState, state, waiting } from "../store.ts";
import { abs, get, pathOf, pool } from "./http.ts";
import type { AltState, PageFacts } from "./parse.ts";
import { probeIfDue } from "./probes.ts";
import { blob, filesUnder, head, treeOf } from "./repo.ts";

/**
 * Every file the website ships in public/, and where the pages use it.
 *
 * TWO SOURCES, JOINED. The repository says which files exist, how many
 * bytes each is, and (through sharp, reading the bytes git hands over) how
 * many pixels a picture has and whether it has transparency. The crawl says
 * which page shows which file, with which alt text, and through what: the
 * file itself, or Next's image optimiser, which resizes and re-encodes on
 * the way out.
 *
 * MEASURED ONCE. A picture is measured when its blob id is new. The same
 * bytes always have the same id, so a file that did not change is never read
 * again, and the daily run after the first costs a directory listing.
 *
 * "NOT FOUND ON ANY PAGE" IS NOT "UNUSED". The crawl reads served HTML and
 * runs no scripts. A video whose source is set by client code, a scene
 * loaded on scroll, a picture only a share card embeds: none of those is in
 * the HTML, all of them are in use. So the flag says exactly what was
 * checked, and nobody should delete a file on its word alone.
 *
 * THE ALT RULE. alt="" is a statement: "this picture is decoration, skip
 * it", and it is correct for decoration. A MISSING alt attribute is a fault
 * every time, because a screen reader then reads out the file name. The two
 * are counted separately and only the second is flagged. A file whose every
 * use says alt="" is listed as "decorative everywhere" for a person to look
 * over: the desk cannot see a picture and so cannot say whether calling it
 * decoration is right.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_assets (
    /* Site-relative, as a page would ask for it: "/og/home.jpg". */
    path       TEXT PRIMARY KEY,
    bytes      INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    ext        TEXT NOT NULL,
    /* The first folder under public/ ("og"), or '' for a file at the root. */
    folder     TEXT NOT NULL,
    sha        TEXT NOT NULL,
    width      INTEGER,
    height     INTEGER,
    alpha      INTEGER,
    /* The blob id the three measures above belong to. */
    measured   TEXT,
    first_seen TEXT NOT NULL,
    last_seen  TEXT NOT NULL
  );
`);

export type AssetKind = "image" | "video" | "font" | "scene" | "audio" | "document" | "other";

const KINDS: Record<string, AssetKind> = {
  webp: "image", avif: "image", png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image", ico: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video",
  woff: "font", woff2: "font", ttf: "font", otf: "font",
  splinecode: "scene", glb: "scene", gltf: "scene", riv: "scene",
  mp3: "audio", wav: "audio",
  pdf: "document", txt: "document", md: "document", json: "document", xml: "document",
};

export const ASSET_KIND_LABEL: Record<AssetKind, string> = { image: "Images", video: "Video", font: "Fonts", scene: "3D scenes", audio: "Audio", document: "Documents", other: "Other" };

/**
 * THE THRESHOLDS, in one place. They are the desk's yardsticks, chosen to
 * catch what costs a reader time, and nothing here is a standard:
 *
 *   heavy       bytes above which a file is heavy FOR ITS KIND. A picture
 *               over 400 kB is larger than a full-width WebP needs to be; a
 *               video over 8 MB is more than a silent loop should weigh; a
 *               font over 150 kB has not been subset; a 3D scene over 3 MB
 *               holds up the page that waits for it.
 *   oversized   a picture shown directly (not through the optimiser) whose
 *               own width is more than twice the widest width any <img> tag
 *               declares for it. Twice, because a retina screen wants two
 *               device pixels per CSS pixel; beyond that the pixels are
 *               thrown away by the browser after being downloaded.
 *   legacy      PNG, JPG and GIF sent as they are to a reader's browser.
 *               WebP or AVIF carry the same picture in fewer bytes. Not
 *               flagged when the file only ever goes through the optimiser
 *               (which re-encodes it) or is only a share picture (the
 *               networks' fetchers want JPG, and no reader's browser loads it).
 */
export const ASSET_LIMITS = {
  heavy: { image: 400_000, video: 8_000_000, font: 150_000, scene: 3_000_000, audio: 2_000_000, document: 1_000_000, other: 1_000_000 } as Record<AssetKind, number>,
  oversizedTimes: 2,
  legacy: ["png", "jpg", "jpeg", "gif"],
} as const;

export type AssetFlagId =
  | "heavy"
  | "legacy-format"
  | "oversized"
  /** In the repository, in no page's HTML. Not the same as unused. */
  | "not-found"
  /** A reader's browser loads it from a folder served with no browser cache. */
  | "uncached-folder"
  /** Shown somewhere by an <img> with no alt attribute at all. */
  | "alt-absent";

export interface AssetFlag {
  id: AssetFlagId;
  /** One sentence with the measured value and the limit. */
  text: string;
  measured: number | string | null;
  limit: number | string | null;
}

/** One use of a file by a page. */
export interface AssetUse {
  page: string;
  /**
   * "img": an <img> tag. "video": a <video> or <source>. "poster": a video's
   * poster. "share": the page's og:image. "mention": named somewhere else in
   * the HTML (a preload, an inline style, the data Next ships for hydration).
   */
  how: "img" | "video" | "poster" | "share" | "mention";
  /** For "img": the file itself, or a copy made by the optimiser. */
  via?: "optimised" | "direct";
  alt?: AltState;
  altText?: string;
  /** The <img>'s width attribute. */
  width?: number | null;
  /** The <img>'s height attribute. */
  height?: number | null;
}

export interface AssetRow {
  /** Site-relative: "/og/home.jpg". */
  path: string;
  /** In the repository: "public/og/home.jpg". */
  repoPath: string;
  bytes: number;
  kind: AssetKind;
  ext: string;
  /** The first folder under public/, "" at the root. */
  folder: string;
  /** Pixels, for pictures sharp could read. Null otherwise. */
  width: number | null;
  height: number | null;
  /** Whether the picture has a transparency channel. Null when not measured. */
  alpha: boolean | null;
  /** Pages whose HTML uses or names the file. */
  pages: string[];
  uses: AssetUse[];
  /** How its <img> uses describe it: counted per use, not per file. */
  alt: { written: number; empty: number; absent: number };
  /** The distinct alt texts written for it. */
  altTexts: string[];
  /** Every <img> use says alt="": decoration everywhere. For a person to look over; not a fault. */
  decorativeEverywhere: boolean;
  /** Pages that share with this picture (their og:image). */
  sharePictureOf: string[];
  flags: AssetFlag[];
  firstSeen: string;
}

export interface FolderCache {
  /** The first folder under public/. */
  folder: string;
  files: number;
  bytes: number;
  /** The one file that was asked for, to read the folder's headers. */
  sample: string;
  /**
   * Its Cache-Control header, as sent with a 200. Null when the file did not
   * answer 200 or sent no such header: then NOTHING is known about the
   * folder's caching, and `maxAge` below means nothing.
   */
  cacheControl: string | null;
  /**
   * max-age in seconds, 0 when the header gives none above 0 (max-age=0,
   * no-cache, no-store, or no max-age at all: a browser may then still keep
   * the file by its own rule of thumb, but nothing promises it). READ `cacheControl`
   * FIRST: when it is null this is also 0, and that 0 is "not known", not
   * "uncached". (A `number | null` here would be the honest type; it waits
   * for the Assets route and its contract, which copy and sort this field.)
   */
  maxAge: number;
  /** What the sample file answered; 0 for nothing. */
  status: number;
}

interface Row {
  path: string;
  bytes: number;
  kind: AssetKind;
  ext: string;
  folder: string;
  sha: string;
  width: number | null;
  height: number | null;
  alpha: number | null;
  measured: string | null;
  first_seen: string;
  last_seen: string;
}

const mb = (bytes: number): string => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} kB`);

/* ---------- the job -------------------------------------------------------------- */

export interface AssetScan {
  at: string;
  files: number;
  bytes: number;
  /** Pictures measured in this run (new or changed bytes). */
  measured: number;
  /** Pictures sharp could not read. */
  unreadable: number;
  removed: number;
}

let scanning: Promise<AssetScan> | null = null;

/** List public/ from the fetched branch, measure what is new, and read each folder's cache header. */
export function scanAssets(progress: (done: number, of: number, what?: string) => void = () => {}): Promise<AssetScan> {
  scanning ??= doScan(progress).finally(() => {
    scanning = null;
  });
  return scanning;
}

async function doScan(progress: (done: number, of: number, what?: string) => void): Promise<AssetScan> {
  if (!(await head())) throw new Error("The website's repository has not been fetched yet; the assets are read from it. The repo job runs first.");
  const now = new Date().toISOString();
  /* Read before the listing: if a fetch moves the branch in between, the id
     stored is the older one and the repo job asks for another scan. */
  const tree = await treeOf("public");
  const files = await filesUnder("public");

  const upsert = db.prepare(`
    INSERT INTO cc_assets (path, bytes, kind, ext, folder, sha, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET bytes = excluded.bytes, kind = excluded.kind, ext = excluded.ext, folder = excluded.folder, sha = excluded.sha, last_seen = excluded.last_seen
  `);
  db.exec("BEGIN");
  try {
    for (const f of files) {
      const path = f.path.replace(/^public/, "");
      const ext = (/\.([A-Za-z0-9]+)$/.exec(path)?.[1] ?? "").toLowerCase();
      const parts = path.split("/");
      upsert.run(path, f.bytes, KINDS[ext] ?? "other", ext, parts.length > 2 ? (parts[1] as string) : "", f.sha, now, now);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const removed = Number(db.prepare("DELETE FROM cc_assets WHERE last_seen < ?").run(now).changes);

  /* Measure the pictures whose bytes are new. One at a time: a decoded
     picture is the largest thing this job ever holds. */
  const todo = db.prepare("SELECT path, sha, bytes FROM cc_assets WHERE kind = 'image' AND ext <> 'ico' AND (measured IS NULL OR measured <> sha)").all() as { path: string; sha: string; bytes: number }[];
  const save = db.prepare("UPDATE cc_assets SET width = ?, height = ?, alpha = ?, measured = ? WHERE path = ?");
  let measured = 0;
  let unreadable = 0;
  for (const [i, t] of todo.entries()) {
    try {
      if (t.bytes > 40_000_000) throw new Error("too large to open");
      /* metadata() reads the header only: no pixels are decoded. */
      const m = await sharp(await blob(t.sha)).metadata();
      save.run(m.width ?? null, m.height ?? null, m.hasAlpha ? 1 : 0, t.sha, t.path);
      measured++;
    } catch {
      /* Marked as looked at, with nothing known: unknown, not zero. */
      save.run(null, null, null, t.sha, t.path);
      unreadable++;
    }
    progress(i + 1, todo.length, t.path);
    if (i % 20 === 19) await probeIfDue();
  }

  /* One file per top-level folder says how the whole folder is cached: the
     site sets Cache-Control by folder (next.config.ts `headers()`). */
  const folders = db.prepare("SELECT folder, COUNT(*) AS files, SUM(bytes) AS bytes, MIN(bytes) AS smallest FROM cc_assets WHERE folder <> '' GROUP BY folder ORDER BY folder").all() as { folder: string; files: number; bytes: number; smallest: number }[];
  const caches = await pool(
    folders,
    2,
    async (f): Promise<FolderCache> => {
      const sample = (db.prepare("SELECT path FROM cc_assets WHERE folder = ? AND bytes = ? ORDER BY path LIMIT 1").get(f.folder, f.smallest) as { path: string }).path;
      const g = await get(abs(encodeURI(sample)), { method: "HEAD", accept: "*/*" });
      /* Only a 200 speaks for the folder: a 404 page's own Cache-Control is
         the error page's policy, not the files'. */
      const cc = g.status === 200 ? (g.headers["cache-control"] ?? null) : null;
      const age = /max-age=(\d+)/i.exec(cc ?? "");
      return { folder: f.folder, files: f.files, bytes: f.bytes, sample, cacheControl: cc, maxAge: cc !== null && age && !/no-cache|no-store/i.test(cc) ? Number(age[1]) : 0, status: g.status };
    },
    200,
  );
  keep("site:asset-folders", caches);

  const total = db.prepare("SELECT COUNT(*) AS n, SUM(bytes) AS b FROM cc_assets").get() as { n: number; b: number | null };
  const scan: AssetScan = { at: now, files: total.n, bytes: total.b ?? 0, measured, unreadable, removed };
  keep("site:assets", scan);
  setState("site:assets:scanned", now);
  /* What this scan measured: the repo job compares it with the branch's
     public/ after every fetch and asks for a scan when they differ. */
  if (tree) setState("site:assets:tree", tree);
  return scan;
}

export const assetsJob: Job = {
  name: "assets",
  title: "Measure the website's files",
  every: 24 * 3600,
  delay: 150,
  run: async ({ progress }) => {
    const s = await scanAssets(progress);
    return `${s.files} files, ${mb(s.bytes)}; ${s.measured} measured${s.unreadable ? `, ${s.unreadable} unreadable` : ""}${s.removed ? `, ${s.removed} gone` : ""}`;
  },
};

/* ---------- joining with the crawl --------------------------------------------------- */

interface Usage {
  /** Uses by file path. */
  byFile: Map<string, AssetUse[]>;
  /** Pictures from other hosts, by URL. */
  remote: Map<string, { url: string; host: string; pages: Set<string>; uses: number; alt: { written: number; empty: number; absent: number }; optimised: boolean }>;
  /** Each page's og:image: a file in public/, a route the site generates, or another host's URL. */
  share: { page: string; picture: string | null; file: string | null }[];
}

let joined: { key: string; usage: Usage } | null = null;

/** Which page uses which file, from the crawl's stored facts. Rebuilt only when a crawl has finished since. */
function usage(): Usage {
  const key = state("site:crawl:finished") ?? "";
  if (joined && joined.key === key) return joined.usage;

  const byFile = new Map<string, AssetUse[]>();
  const remote: Usage["remote"] = new Map();
  const share: Usage["share"] = [];
  const add = (file: string, use: AssetUse) => {
    const list = byFile.get(file) ?? [];
    list.push(use);
    byFile.set(file, list);
  };

  for (const r of db.prepare("SELECT path, facts FROM cc_pages WHERE facts IS NOT NULL").all() as { path: string; facts: string }[]) {
    let f: PageFacts;
    try {
      f = JSON.parse(r.facts) as PageFacts;
    } catch {
      continue;
    }
    const seen = new Set<string>();
    for (const i of f.images) {
      if (i.file) {
        seen.add(i.file);
        add(i.file, { page: r.path, how: "img", via: i.via, alt: i.alt, ...(i.altText ? { altText: i.altText } : {}), width: i.width, height: i.height });
      } else if (i.remote) {
        const url = i.remoteUrl ?? `https://${i.remote}`;
        const hit = remote.get(url) ?? { url, host: i.remote, pages: new Set<string>(), uses: 0, alt: { written: 0, empty: 0, absent: 0 }, optimised: false };
        hit.pages.add(r.path);
        hit.uses++;
        hit.alt[i.alt]++;
        if (i.via === "optimised") hit.optimised = true;
        remote.set(url, hit);
      }
    }
    for (const v of f.videos) {
      if (v.file) {
        seen.add(v.file);
        add(v.file, { page: r.path, how: "video" });
      }
      if (v.poster) {
        seen.add(v.poster);
        add(v.poster, { page: r.path, how: "poster" });
      }
    }
    const og = f.og.image;
    const ogFile = og ? pathOf(og) : null;
    share.push({ page: r.path, picture: og, file: ogFile });
    if (ogFile) {
      seen.add(ogFile);
      add(ogFile, { page: r.path, how: "share" });
    }
    for (const m of f.mentions) if (!seen.has(m)) add(m, { page: r.path, how: "mention" });
  }

  joined = { key, usage: { byFile, remote, share } };
  return joined.usage;
}

const NOT_YET = "The website's files have not been measured yet. That happens a few minutes after the desk starts, once the repository has been fetched.";

/** Files at the root of public/ that are fetched by convention, never linked: not being on a page is what they are for. */
const BY_CONVENTION = (r: Row): boolean => r.folder === "" || r.ext === "md";

function build(r: Row, u: Usage, folderCache: Map<string, FolderCache>, crawled: boolean): AssetRow {
  const uses = u.byFile.get(r.path) ?? [];
  const imgs = uses.filter((x) => x.how === "img");
  const alt = { written: 0, empty: 0, absent: 0 };
  for (const i of imgs) if (i.alt) alt[i.alt]++;
  /* Where a reader's browser certainly fetches the file itself: an <img>
     that names it, a video, a poster. A bare mention of a PICTURE is not
     certain (client code may hand it to the optimiser); a mention of
     anything else is, because only pictures have an optimiser. */
  const loaded = uses.filter((x) => (x.how === "img" && x.via === "direct") || x.how === "video" || x.how === "poster");
  const direct = [...loaded, ...uses.filter((x) => x.how === "mention" && r.kind !== "image")];
  const flags: AssetFlag[] = [];

  const heavy = ASSET_LIMITS.heavy[r.kind];
  if (r.bytes > heavy) {
    const softened = imgs.length && !loaded.length ? " Readers get a smaller copy from the optimiser; the source is still what it has to chew through." : "";
    flags.push({ id: "heavy", text: `${mb(r.bytes)}; over ${mb(heavy)} is heavy for ${r.kind === "image" ? "a picture" : r.kind === "scene" ? "a 3D scene" : `a ${r.kind} file`}.${softened}`, measured: r.bytes, limit: heavy });
  }
  if ((ASSET_LIMITS.legacy as readonly string[]).includes(r.ext) && loaded.length) {
    flags.push({ id: "legacy-format", text: `Sent to readers as .${r.ext} on ${new Set(loaded.map((d) => d.page)).size} page(s); WebP or AVIF carry the same picture in fewer bytes.`, measured: r.ext, limit: "webp or avif" });
  }
  const declared = imgs.filter((i) => i.via === "direct" && i.width).map((i) => i.width as number);
  if (r.width && declared.length && declared.length === imgs.filter((i) => i.via === "direct").length) {
    const widest = Math.max(...declared);
    if (r.width > widest * ASSET_LIMITS.oversizedTimes) {
      flags.push({ id: "oversized", text: `The file is ${r.width} px wide; the widest <img> that shows it declares ${widest} px. Over ${ASSET_LIMITS.oversizedTimes}× is downloaded and thrown away.`, measured: r.width, limit: widest * ASSET_LIMITS.oversizedTimes });
    }
  }
  if (crawled && !uses.length && !BY_CONVENTION(r)) {
    flags.push({ id: "not-found", text: "Not found in the HTML of any page the desk reads. Client code may still load it later, so this is not proof it is unused.", measured: 0, limit: 1 });
  }
  const fc = folderCache.get(r.folder);
  if (fc && fc.cacheControl !== null && fc.maxAge === 0 && direct.length) {
    flags.push({ id: "uncached-folder", text: `Loaded by readers' browsers from /${r.folder}/, which is served "${fc.cacheControl}": every visit asks for it again.`, measured: fc.cacheControl, limit: "a max-age above 0" });
  }
  if (alt.absent) {
    flags.push({ id: "alt-absent", text: `${alt.absent} <img> tag(s) show it with no alt attribute at all. alt="" would say “decoration”; none makes a screen reader read the file name.`, measured: alt.absent, limit: 0 });
  }

  return {
    path: r.path,
    repoPath: `public${r.path}`,
    bytes: r.bytes,
    kind: r.kind,
    ext: r.ext,
    folder: r.folder,
    width: r.width,
    height: r.height,
    alpha: r.alpha == null ? null : Boolean(r.alpha),
    pages: [...new Set(uses.map((x) => x.page))].sort(),
    uses,
    alt,
    altTexts: [...new Set(imgs.map((i) => i.altText).filter((t): t is string => Boolean(t)))].slice(0, 8),
    decorativeEverywhere: imgs.length > 0 && alt.empty === imgs.length,
    sharePictureOf: uses.filter((x) => x.how === "share").map((x) => x.page),
    flags,
    firstSeen: r.first_seen,
  };
}

function all(): AssetRow[] {
  const u = usage();
  const folderCache = new Map((kept<FolderCache[]>("site:asset-folders")?.value ?? []).map((f) => [f.folder, f]));
  const crawled = Boolean(state("site:crawl:finished"));
  return (db.prepare("SELECT * FROM cc_assets ORDER BY path").all() as unknown as Row[]).map((r) => build(r, u, folderCache, crawled));
}

const scannedAt = (): string | null => state("site:assets:scanned");

const read = <T>(make: () => T, noteText?: string): Reading<T> => {
  const at = scannedAt();
  return at ? ok(make(), "repo", at, noteText) : waiting("repo", NOT_YET);
};

const JOIN_NOTE = "Files from the website's repository; which page uses which comes from the crawl of the served HTML, which runs no scripts.";

/** Every file in public/, with its measures, its uses and its flags. Filter by folder, kind or flag. */
export const assets = (filter: { folder?: string; kind?: AssetKind; flag?: AssetFlagId } = {}): Reading<AssetRow[]> =>
  read(() => all().filter((a) => (filter.folder === undefined || a.folder === filter.folder) && (!filter.kind || a.kind === filter.kind) && (!filter.flag || a.flags.some((f) => f.id === filter.flag))), JOIN_NOTE);

/** One file, by its site-relative path. `off` when there is no such file in the repository. */
export function asset(path: string): Reading<AssetRow> {
  const at = scannedAt();
  if (!at) return waiting("repo", NOT_YET);
  const hit = all().find((a) => a.path === path);
  return hit ? ok(hit, "repo", at, JOIN_NOTE) : { state: "off", source: "repo", reason: `There is no file public${path} on the website's branch.` };
}

export interface AssetTotals {
  files: number;
  bytes: number;
  /** `value` is the number of files; `bytes` their weight. */
  byKind: (Share & { bytes: number })[];
  byFolder: (Share & { bytes: number })[];
  /** How many files carry each flag. */
  flagged: Record<AssetFlagId, number>;
  /** Over every <img> use on the site of a file in public/. */
  alt: { written: number; empty: number; absent: number };
  /** Files whose every <img> use says alt="": for a person to look over, not a fault. */
  decorativeEverywhere: number;
}

/** The totals: by kind, by folder, by flag, and the alt-text picture. */
export const assetTotals = (): Reading<AssetTotals> =>
  read(() => {
    const rows = all();
    const group = (key: (a: AssetRow) => string, label: (k: string) => string) => {
      const by = new Map<string, { n: number; bytes: number }>();
      for (const a of rows) {
        const g = by.get(key(a)) ?? { n: 0, bytes: 0 };
        g.n++;
        g.bytes += a.bytes;
        by.set(key(a), g);
      }
      return [...by].map(([k, g]) => ({ key: k, label: label(k), value: g.n, bytes: g.bytes })).sort((a, b) => b.bytes - a.bytes);
    };
    const flagged: Record<AssetFlagId, number> = { heavy: 0, "legacy-format": 0, oversized: 0, "not-found": 0, "uncached-folder": 0, "alt-absent": 0 };
    const alt = { written: 0, empty: 0, absent: 0 };
    for (const a of rows) {
      for (const f of a.flags) flagged[f.id]++;
      alt.written += a.alt.written;
      alt.empty += a.alt.empty;
      alt.absent += a.alt.absent;
    }
    return {
      files: rows.length,
      bytes: rows.reduce((s, a) => s + a.bytes, 0),
      byKind: group((a) => a.kind, (k) => ASSET_KIND_LABEL[k as AssetKind] ?? k),
      byFolder: group((a) => a.folder || "(root)", (k) => (k === "(root)" ? "public/" : `public/${k}/`)),
      flagged,
      alt,
      decorativeEverywhere: rows.filter((a) => a.decorativeEverywhere).length,
    };
  }, JOIN_NOTE);

/** How each top-level folder of public/ is cached, from one file asked per folder at the last scan. */
export function folders(): Reading<FolderCache[]> {
  const had = kept<FolderCache[]>("site:asset-folders");
  return had
    ? ok(had.value, "crawl", had.at, "One file per folder was asked for its headers; the site sets Cache-Control by folder. A folder whose cacheControl is null did not answer 200 with one: its caching is not known, and its maxAge of 0 means nothing.")
    : waiting("repo", NOT_YET);
}

export interface RemoteImage {
  /** The picture's address on the other host, without its query. */
  url: string;
  host: string;
  pages: string[];
  uses: number;
  alt: { written: number; empty: number; absent: number };
  /** Whether the site's optimiser fetches and re-serves it (then the reader's browser never talks to that host). */
  optimised: boolean;
}

/** Pictures the pages load from other hosts: outside public/, outside the repository, and somebody else's to take down. */
export function remoteImages(): Reading<RemoteImage[]> {
  const at = state("site:crawl:finished");
  if (!at) return waiting("crawl", "The first crawl has not finished yet.");
  return ok(
    [...usage().remote.values()].map((r) => ({ url: r.url, host: r.host, pages: [...r.pages].sort(), uses: r.uses, alt: r.alt, optimised: r.optimised })).sort((a, b) => b.uses - a.uses),
    "crawl",
    at,
  );
}

export interface SharePicture {
  page: string;
  /** The og:image as the page writes it, or null when it has none. */
  picture: string | null;
  /** The file in public/ it is, when it is one. */
  file: string | null;
  /** "file": in public/. "generated": an address on the site with no file behind it (an article's card, drawn at build time). "remote": another host. "none". */
  origin: "file" | "generated" | "remote" | "none";
  /** Pixels, when it is a file that was measured. Share pictures are meant to be 1200 × 630. */
  width: number | null;
  height: number | null;
  bytes: number | null;
  /** How many pages share with this same picture. More than one usually means the site's default. */
  sharedBy: number;
}

/** The share picture of every page the crawl read. */
export function sharePictures(): Reading<SharePicture[]> {
  const at = state("site:crawl:finished");
  if (!at) return waiting("crawl", "The first crawl has not finished yet.");
  const u = usage();
  const files = new Map((db.prepare("SELECT path, bytes, width, height FROM cc_assets WHERE kind = 'image'").all() as { path: string; bytes: number; width: number | null; height: number | null }[]).map((r) => [r.path, r]));
  const count = new Map<string, number>();
  for (const s of u.share) if (s.picture) count.set(s.picture, (count.get(s.picture) ?? 0) + 1);
  return ok(
    u.share
      .map((s): SharePicture => {
        const f = s.file ? files.get(s.file) : undefined;
        return {
          page: s.page,
          picture: s.picture,
          file: f ? s.file : null,
          origin: !s.picture ? "none" : f ? "file" : s.file ? "generated" : "remote",
          width: f?.width ?? null,
          height: f?.height ?? null,
          bytes: f?.bytes ?? null,
          sharedBy: s.picture ? (count.get(s.picture) ?? 1) : 0,
        };
      })
      .sort((a, b) => a.page.localeCompare(b.page)),
    "crawl",
    at,
    scannedAt() ? undefined : "The files have not been measured yet, so no picture has a size.",
  );
}

/** Files whose path contains `q`, or that carry an alt text containing it. For the top bar's search and the Assets filter. */
export function findAssets(q: string, limit = 20): AssetRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle || !scannedAt()) return [];
  return all()
    .filter((a) => a.path.toLowerCase().includes(needle) || a.altTexts.some((t) => t.toLowerCase().includes(needle)))
    .sort((a, b) => a.path.length - b.path.length)
    .slice(0, limit);
}
