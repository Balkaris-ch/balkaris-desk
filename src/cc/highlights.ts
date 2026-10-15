import { everyone, OWNER_EMAIL, type Person } from "../people.ts";
import { pages } from "./ga4.ts";
import { changeOverridesFile } from "./operator/apply.ts";
import { commitFiles, read } from "./site/repo.ts";
import type { Job } from "./scheduler.ts";
import { note, setState, state } from "./store.ts";

/**
 * PROJECT HIGHLIGHTS: which case studies the website puts first.
 *
 * Fini, 15 October 2026: "Needs to be intelligent and give us all the
 * options. It can also detect signals and push one page on highlight if it
 * gets views — or we pick, or the latest."
 *
 * Four places, each with its own way of choosing:
 *
 *   home      the one project the home page's "Selected work" shows
 *   digital   the projects listed first under Digital on /work and in the menu
 *   growth    the same under Growth
 *   studio    the same under Studio
 *
 * and three ways for each:
 *
 *   smart     the most-viewed project of the last 30 days (GA4), the newest
 *             breaking ties; with no views at all it is the newest
 *   latest    the most recently published project
 *   pick      the projects a person chose, in their order
 *
 * THE WEBSITE STAYS SIMPLE. The desk works the order out and writes only the
 * result into content/desk/overrides.json, under `highlights`:
 *
 *   { "home": "allumi", "featured": ["allumi", "metmee", "artcraft", ...] }
 *
 * The website reads it at build time (lib/desk.ts deskHighlights): the home
 * page shows `home`, and a project is featured, in that order, when it is in
 * `featured`. A slug the website does not know is ignored there.
 *
 * KEPT CURRENT. "smart" and "latest" change by themselves as views come in
 * and projects are published, so a daily job works the order out again and
 * commits only when it differs (each commit is a website deploy).
 */

export type Mode = "smart" | "latest" | "pick";
export type Place = "home" | "digital" | "growth" | "studio";
export const PLACES: readonly Place[] = ["home", "digital", "growth", "studio"];
export const PRACTICES: readonly Exclude<Place, "home">[] = ["digital", "growth", "studio"];

export interface PlaceSetting {
  mode: Mode;
  /** In "pick": the chosen projects, in order. Kept in the other modes too, so switching back restores them. */
  pick: string[];
}

export interface Settings {
  places: Record<Place, PlaceSetting>;
  /** How many projects each practice puts first. */
  perPractice: number;
}

export interface Project {
  slug: string;
  title: string;
  client: string;
  practice: Exclude<Place, "home">;
  href: string;
  cover: string | null;
  /** When it was first published: the first commit that brought its case file, or null when the history does not show it. */
  published: string | null;
  /** GA4, last 30 days. Null when GA4 did not answer. */
  views: number | null;
  /** The flag the website's own record carries, used when the desk has never chosen. */
  featuredInCode: boolean;
}

export interface Resolved {
  home: string | null;
  /** Per practice, in order. */
  byPractice: Record<Exclude<Place, "home">, string[]>;
  /** What is written to the website: every practice's list, Digital then Growth then Studio. */
  featured: string[];
  /** One sentence per place on why it came out this way. */
  why: Record<Place, string>;
}

const KEY = "highlights.settings";
const DEFAULTS: Settings = {
  places: { home: { mode: "smart", pick: [] }, digital: { mode: "smart", pick: [] }, growth: { mode: "smart", pick: [] }, studio: { mode: "smart", pick: [] } },
  perPractice: 2,
};

export function settings(): Settings {
  try {
    const s = JSON.parse(state(KEY) ?? "null") as Partial<Settings> | null;
    if (!s) return structuredClone(DEFAULTS);
    const places = {} as Record<Place, PlaceSetting>;
    for (const p of PLACES) {
      const g = s.places?.[p];
      places[p] = {
        mode: g && ["smart", "latest", "pick"].includes(g.mode) ? g.mode : DEFAULTS.places[p].mode,
        pick: Array.isArray(g?.pick) ? g!.pick.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]{1,80}$/.test(x)).slice(0, 12) : [],
      };
    }
    const n = Number(s.perPractice);
    return { places, perPractice: Number.isInteger(n) && n >= 1 && n <= 6 ? n : DEFAULTS.perPractice };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(next: Settings): void {
  setState(KEY, JSON.stringify(next));
}

/* ---------- the projects, as the website has them ---------------------------- */

/**
 * The live projects, read from the website's content/work.ts at the head of
 * its main branch (the desk's read copy). Each record is an object that
 * starts `slug: "…"`; only the plain fields this needs are read, and a record
 * whose `status` is "draft" is not a page, so it is left out.
 */
export async function projects(): Promise<{ list: Project[]; error: string | null }> {
  const src = await read("content/work.ts");
  if (src === null) return { list: [], error: "The desk could not read the website's content/work.ts yet (its read copy of the repository is made by the repository job)." };

  const str = (block: string, field: string): string | null => block.match(new RegExp(`\\b${field}:\\s*"([^"]*)"`))?.[1] ?? null;
  const records = src.split(/\n\s*\{\s*\n\s*slug:\s*/).slice(1).map((rest) => `slug: ${rest}`);

  /* When each case file first appeared on main: the oldest commit that names it. */
  const added = new Map<string, string>();
  for (const c of (await commitFiles(2000)).slice().reverse()) {
    for (const p of c.paths) {
      const m = /^content\/cases\/([a-z0-9-]+)\.ts$/.exec(p);
      if (m && !added.has(m[1])) added.set(m[1], c.at);
    }
  }

  const list: Project[] = [];
  for (const r of records) {
    const slug = str(r, "slug");
    const practice = str(r, "discipline");
    if (!slug || str(r, "status") === "draft" || !practice || !(PRACTICES as readonly string[]).includes(practice)) continue;
    list.push({
      slug,
      title: str(r, "title") ?? slug,
      client: str(r, "client") ?? slug,
      practice: practice as Project["practice"],
      href: `/case-study-${slug}`,
      cover: str(r, "cover"),
      published: added.get(slug) ?? null,
      views: null,
      featuredInCode: /\bfeatured:\s*true\b/.test(r.split(/\n\s*\},?\s*\n/)[0] ?? r),
    });
  }

  /* Views over the last 30 days, by the project's address. */
  try {
    const got = await pages("30d");
    if (got.data) {
      const by = new Map(got.data.rows.map((x) => [x.path.replace(/\/+$/, ""), x.views]));
      for (const p of list) p.views = by.get(p.href) ?? 0;
    }
  } catch {
    /* GA4 not answering: views stay unknown, and "smart" says so. */
  }
  return { list, error: null };
}

/* ---------- working the order out ---------------------------------------------- */

const newest = (a: Project, b: Project): number => (b.published ?? "").localeCompare(a.published ?? "");

function order(list: Project[], s: PlaceSetting): { order: Project[]; why: string } {
  if (s.mode === "pick") {
    const chosen = s.pick.map((slug) => list.find((p) => p.slug === slug)).filter((p): p is Project => !!p);
    if (chosen.length) return { order: [...chosen, ...list.filter((p) => !chosen.includes(p)).sort(newest)], why: "chosen by hand" };
    return { order: [...list].sort(newest), why: "nothing chosen yet, so the newest" };
  }
  if (s.mode === "latest") return { order: [...list].sort(newest), why: "the most recently published" };
  const known = list.some((p) => p.views !== null);
  const seen = list.some((p) => (p.views ?? 0) > 0);
  if (!known) return { order: [...list].sort(newest), why: "GA4 did not answer, so the newest" };
  if (!seen) return { order: [...list].sort(newest), why: "no views in 30 days yet, so the newest" };
  return { order: [...list].sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || newest(a, b)), why: "the most viewed in the last 30 days" };
}

export function resolve(list: Project[], s: Settings): Resolved {
  const byPractice = {} as Resolved["byPractice"];
  const why = {} as Resolved["why"];
  for (const p of PRACTICES) {
    const mine = list.filter((x) => x.practice === p);
    const o = order(mine, s.places[p]);
    byPractice[p] = o.order.slice(0, s.perPractice).map((x) => x.slug);
    why[p] = mine.length ? o.why : "no published project in this practice";
  }
  const home = order(list, s.places.home);
  why.home = list.length ? home.why : "no published project";
  return { home: home.order[0]?.slug ?? null, byPractice, featured: PRACTICES.flatMap((p) => byPractice[p]), why };
}

/* ---------- writing it to the website ------------------------------------------ */

/** What the website's file says now, as the desk last wrote it. */
export function written(): { home: string | null; featured: string[] } | null {
  try {
    return JSON.parse(state("highlights.written") ?? "null");
  } catch {
    return null;
  }
}

/**
 * Write the resolved highlights to the website if they differ from what is
 * there. Returns a sentence for a person or the job's line.
 */
export async function publishHighlights(r: Resolved, by: Person): Promise<{ changed: boolean; line: string }> {
  const want = { home: r.home, featured: r.featured };
  const out = await changeOverridesFile(
    (o) => {
      o.highlights = want;
    },
    "Desk: project highlights",
    `Home: ${r.home ?? "none"} (${r.why.home}).\n${PRACTICES.map((p) => `${p}: ${r.byPractice[p].join(", ") || "none"} (${r.why[p]})`).join("\n")}`,
    by,
  );
  setState("highlights.written", JSON.stringify(want));
  if (!out.changed) return { changed: false, line: "The website already shows these highlights; nothing was committed." };
  note("site", `Project highlights changed: home shows ${r.home ?? "nothing"}`, {
    tone: "good",
    actor: by.name,
    detail: PRACTICES.map((p) => `${p}: ${r.byPractice[p].join(", ") || "none"}`).join(" · "),
    href: "/content#highlights",
    dedupe: `highlights:${out.sha}`,
  });
  return { changed: true, line: `Committed (${out.sha.slice(0, 7)}): the website shows the new highlights after its next build, in about two minutes.` };
}

/** The person the daily job commits as: the owner, who can publish. */
function owner(): Person | null {
  return everyone().find((p) => p.email?.toLowerCase() === OWNER_EMAIL && p.email) ?? null;
}

/**
 * Daily: when any place is on "smart" or "latest", work the order out again
 * and commit only if it changed. "pick" alone never changes by itself.
 */
export const highlightsJob: Job = {
  name: "highlights",
  title: "Keep the project highlights current",
  every: 24 * 3600,
  delay: 600,
  run: async (): Promise<string> => {
    const s = settings();
    if (!state(KEY)) return "Not set up yet: nobody has chosen highlights on the desk.";
    if (PLACES.every((p) => s.places[p].mode === "pick")) return "Every place is chosen by hand: nothing to recompute.";
    const { list, error } = await projects();
    if (error) throw new Error(error);
    const by = owner();
    if (!by) throw new Error("No owner with an email on the desk to commit as.");
    const r = resolve(list, s);
    return (await publishHighlights(r, by)).line;
  },
};

/** For the collectors in cc/index.ts. */
export const jobs: Job[] = [highlightsJob];
