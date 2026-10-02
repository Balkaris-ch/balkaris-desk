import type { Reading, Share } from "./common";

/**
 * GET /api/v1/assets — the Assets screen in one answer.
 *
 * Every file the website ships in its public/ folder (read from the site's
 * repository), joined with the desk's crawl of the served HTML: which page
 * shows which file, with which alt text, through what. Nothing here is a
 * range: the files are what is on the branch now, so the screen has no
 * period switch.
 *
 * The query the screen sends, all optional:
 *
 *   tab      all | images | video | share | other | attention
 *   q        a file name, a folder, an alt text or a page address
 *   folder   one top-level folder of public/ ("og"), or "(root)"
 *   format   a file extension ("jpg")
 *   flag     a check that fails or warns (CheckId)
 *   sort     heaviest (default) | lightest | name | pages | issues
 *   page     1-based
 *   per      rows per page: 8 (default, as the board draws), 25, 50, 100
 *   file     one file opened beside the list ("/og/home.jpg")
 *
 * Types only: the server imports this file with `import type`.
 */

export type AssetTab = "all" | "images" | "video" | "share" | "other" | "attention";
export type AssetSort = "heaviest" | "lightest" | "name" | "pages" | "issues";
export type AssetKind = "image" | "video" | "font" | "scene" | "audio" | "document" | "other";

/** The rules a file is checked against for search and speed. Each is stated in its chip's `text`. */
export type CheckId =
  /** A descriptive file name, not a camera, screenshot, hash or bare number. */
  | "name"
  /** WebP, AVIF or SVG for a picture sent to readers; WOFF2 for a font; MP4 or WebM for a film. */
  | "format"
  /** Bytes under the desk's limit for the kind of file. */
  | "weight"
  /** Pixels not far above the widest place an <img> shows it. */
  | "pixels"
  /** An alt attribute on every <img> that shows it. */
  | "alt"
  /** width and height in the markup of every <img> that shows it. */
  | "size"
  /** Served with a browser cache. */
  | "cache"
  /** Named in the HTML of at least one page. */
  | "found";

/**
 *   pass  the rule holds
 *   warn  worth a look: it may cost search or speed, or the desk cannot see enough to call it a fault
 *   fail  the rule is broken
 *   note  a fact the rule does not judge (decoration, a picture the optimiser re-encodes)
 */
export type CheckState = "pass" | "warn" | "fail" | "note";

export interface AssetCheck {
  id: CheckId;
  state: CheckState;
  /** The chip's words: "WebP", "1.2 MB", "No browser cache". */
  label: string;
  /** One sentence: what was measured, against which limit, and why it matters. */
  text: string;
  /** The measured value as printed, or null where the rule measures nothing. */
  measured: string | null;
  /** The limit as printed, or null. */
  limit: string | null;
}

/** One way one page uses a file. */
export interface AssetPageUse {
  page: string;
  /** img: an <img>. video: a <video> or <source>. poster: a video's poster. share: the page's og:image. mention: named elsewhere in the HTML. */
  how: "img" | "video" | "poster" | "share" | "mention";
  /** For an <img>: the file itself, or a copy made by the site's image optimiser. */
  via?: "optimised" | "direct";
  alt?: "written" | "empty" | "absent";
  altText?: string;
  width?: number | null;
  height?: number | null;
}

/** One file in public/, as a row of the table. */
export interface AssetItem {
  /** Site-relative: "/og/home.jpg". */
  path: string;
  /** "home.jpg" */
  name: string;
  /** The first folder under public/, "" at the root. */
  folder: string;
  ext: string;
  kind: AssetKind;
  bytes: number;
  /** Pixels, for pictures the desk could measure. Null otherwise (films and fonts are not measured). */
  width: number | null;
  height: number | null;
  /** Every page whose HTML uses or names it, sorted. */
  pages: string[];
  /** How its <img> uses describe it, counted per use. */
  alt: { written: number; empty: number; absent: number };
  altTexts: string[];
  /** Every <img> use says alt="": decoration, on purpose. Not a fault. */
  decorativeEverywhere: boolean;
  /** How many pages name it as their share picture. */
  shareOf: number;
  /**
   * For a film: the poster picture a page gives it (a file in public/, from
   * the crawl), drawn as its thumbnail. Null for everything else, or when no
   * page gives it one.
   */
  poster: string | null;
  checks: AssetCheck[];
}

/** One file opened beside the list. */
export interface AssetDetail extends AssetItem {
  /** "public/og/home.jpg" */
  repoPath: string;
  /** Whether the picture has a transparency channel; null when not measured. */
  alpha: boolean | null;
  uses: AssetPageUse[];
  /** When the desk first listed the file (not when it was added to the site). */
  firstSeen: string;
  /** Page titles from the crawl, for the pages it is used on. */
  titles: Record<string, string | null>;
}

export interface AssetList {
  rows: AssetItem[];
  /** Rows that match the tab, search and filters, over all pages. */
  total: number;
  page: number;
  per: number;
}

/** A page's share picture (og:image) and how it stands. */
export interface ShareRow {
  page: string;
  title: string | null;
  /** The og:image as the page writes it, or null. */
  picture: string | null;
  /** The file in public/, when it is one. */
  file: string | null;
  /** file: in public/. generated: an address the site draws at build time. remote: another host. none. */
  origin: "file" | "generated" | "remote" | "none";
  /**
   * own: no other page uses the same picture. default: the site's fallback
   * picture, as the website's repository names it (lib/site.ts `ogImage`):
   * the page has none of its own. shared: shared with other pages, and not
   * the fallback (or the fallback could not be read). none: the page names
   * no share picture.
   */
  status: "own" | "default" | "shared" | "none";
  sharedBy: number;
  width: number | null;
  height: number | null;
  bytes: number | null;
}

export interface ShareList {
  rows: ShareRow[];
  total: number;
  page: number;
  per: number;
}

export interface ShareSummary {
  /** Pages the crawl read. */
  pages: number;
  own: number;
  onDefault: number;
  shared: number;
  none: number;
  /** Own pictures drawn by the site (an article's card), not files in public/. */
  generated: number;
  /**
   * The site's fallback share picture as its repository names it (lib/site.ts
   * `ogImage`), site-relative. Null when it could not be read: no page is then
   * called "on the default", and pages sharing a picture count as shared.
   */
  defaultPicture: string | null;
  /** The pages on it, sorted. */
  defaultPages: string[];
  /** Measured share pictures that are not 1200 × 630. */
  offSize: number;
  /** Files in public/og/, and how many of them no page names as its share picture. */
  ogFiles: number;
  ogUnnamed: number;
}

/** One headline figure of the tile row. */
export interface AssetFigure {
  value: number;
  unit: "count" | "bytes";
  /** "/ 490" beside a part of a whole. */
  of?: number;
  /** A true second line ("in 15 folders"). */
  sub?: string;
  /** What the figure is made of, drawn as a thin bar under it. Empty draws none. */
  parts: Share[];
  partsUnit: "count" | "bytes";
}

export interface AssetTiles {
  files: Reading<AssetFigure>;
  weight: Reading<AssetFigure>;
  images: Reading<AssetFigure>;
  videos: Reading<AssetFigure>;
  missingAlt: Reading<AssetFigure>;
  notFound: Reading<AssetFigure>;
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

export interface KindWeight {
  key: "image" | "video" | "font" | "other";
  label: string;
  bytes: number;
  files: number;
  /** What "other" holds, in words: "1 3D scene, 10 documents". */
  detail?: string;
}

export interface FolderWeight {
  /** "og", or "" for the root of public/. */
  folder: string;
  label: string;
  bytes: number;
  files: number;
}

export interface FormatRow {
  ext: string;
  label: string;
  kind: AssetKind;
  files: number;
  bytes: number;
}

export interface FormatSummary {
  /** Every format of picture, film and font, heaviest first. */
  formats: FormatRow[];
  /** PNG, JPG or GIF sent to readers' browsers as they are: these could be WebP or AVIF. */
  toReaders: { files: number; bytes: number };
  /** PNG, JPG or GIF that only reach readers through the optimiser, or are only share pictures, or were not found on a page. */
  elsewhere: { files: number; bytes: number };
}

export interface FolderCacheRow {
  folder: string;
  files: number;
  bytes: number;
  /** The Cache-Control header the folder's sample file answered with, as sent. */
  cacheControl: string | null;
  /** Seconds; 0 when a browser must ask again on every visit. */
  maxAge: number;
  /** The file that was asked for. */
  sample: string;
  /** Files in it that readers' browsers load themselves. */
  loaded: number;
}

export interface CachingSummary {
  folders: FolderCacheRow[];
  /** Folders asked, and how many answered without a browser cache. */
  checked: number;
  uncached: number;
  /** Files in uncached folders that readers' browsers load themselves. */
  uncachedLoaded: number;
  uncachedLoadedBytes: number;
}

export interface RemoteHost {
  host: string;
  /** Distinct pictures. */
  pictures: number;
  /** <img> tags showing them. */
  uses: number;
  pages: number;
  /** Pictures the site's optimiser fetches and re-serves (the reader never talks to the host). */
  optimised: number;
}

export interface RemotePage {
  page: string;
  pictures: number;
  hosts: string[];
}

export interface RemoteSummary {
  pictures: number;
  uses: number;
  hosts: RemoteHost[];
  /** Pages showing pictures from elsewhere, most first. */
  pages: RemotePage[];
  /** <img> uses of them with no alt attribute. */
  altAbsent: number;
}

/** The asset job, as the screen's Rescan needs it. */
export interface ScanStatus {
  /** When the files were last measured, and when the crawl last finished. */
  scannedAt: string | null;
  crawledAt: string | null;
  running: boolean;
  progress: { done: number; of: number; what?: string } | null;
  lastOk: boolean | null;
  lastNote: string | null;
  lastStart: string | null;
  lastEnd: string | null;
  enabled: boolean;
}

export interface AssetsQuery {
  tab: AssetTab;
  q: string;
  folder: string | null;
  format: string | null;
  flag: CheckId | null;
  sort: AssetSort;
  page: number;
  per: number;
  file: string | null;
}

export interface AssetsPayload {
  /** The query as the server understood it: anything unknown is dropped. */
  query: AssetsQuery;
  /** The website's address, for thumbnails and "open the file": "https://www.balkaris.ch". */
  site: string;
  scan: ScanStatus;
  tiles: AssetTiles;
  /** How many rows each tab holds under the current search and filters. Share pictures is null until the crawl has read the pages. */
  tabs: Reading<Record<AssetTab, number | null>>;
  /** What the filters offer, with counts over every file. */
  filters: { folders: FilterOption[]; formats: FilterOption[]; flags: FilterOption[] };
  /** The table, for every tab but `share`. */
  list: Reading<AssetList>;
  /** The table of the `share` tab; null on the others. */
  shares: Reading<ShareList> | null;
  /** The opened file, when `file` was asked for. */
  open: Reading<AssetDetail> | null;
  byKind: Reading<KindWeight[]>;
  byFolder: Reading<FolderWeight[]>;
  formats: Reading<FormatSummary>;
  caching: Reading<CachingSummary>;
  remote: Reading<RemoteSummary>;
  sharePictures: Reading<ShareSummary>;
}
