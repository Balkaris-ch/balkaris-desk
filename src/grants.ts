import { db } from "./db.ts";

/**
 * WHO SEES WHAT: the desk's areas, and what each person may do in each.
 *
 * Fini, 3 October 2026: *"Need to add the possibility to give access to users
 * — and same thing we developed with the engine — be able to select to what I
 * give them access, and also see their activity."*
 *
 * So this is the engine's model (balkaris-engine, src/access.ts), fitted to
 * the desk, and deliberately as small:
 *
 *   AN AREA is a row of the sidebar: Command Center, Insights, SEO… It owns
 *   the pages that show it AND the API prefixes that serve them, so granting
 *   "Traffic" grants the screen and the routes behind it, and forgetting a
 *   route cannot quietly open a door.
 *
 *   A LEVEL is none, view or edit. A GET needs view; anything that changes
 *   something needs edit. An area where nobody but the owner changes anything
 *   (Leads, Settings, Team) offers none and view only.
 *
 *   GRANTS narrow it. A person with no grants (NULL in `people.grants`) keeps
 *   everything the desk gave everybody before this existed: which is every
 *   person on the desk today, so this ships changing nothing. The moment
 *   somebody HAS grants they are an allow-list: only the areas named are
 *   reachable, everything else is 403 and missing from their sidebar.
 *
 *   A PAGE can override its area, for the areas that have several (SEO's
 *   eleven): `page:seo/keywords` = none hides one page and refuses its API.
 *
 * NOTHING HERE CAN RAISE ANYBODY. The owner-only doors (requireOwner) and the
 * enquiry right (`seesLeads`) are checked where they always were; a grant only
 * takes away. And the owner is never restricted: a row of grants for the owner would
 * be a row of switches that do nothing, and a way to lock the only person who
 * can undo it out of the page that undoes it.
 *
 * THE UNMAPPED ROUTE. A path that belongs to no area (who am I, the top bar's
 * light, the search box, a refresh) is open to anybody who may see at least
 * one area; a refresh, which is a change, to anybody who may change one.
 * Somebody with nothing yet (a newcomer waiting for the owner) gets /me and
 * nothing else. When you add a screen, add its area here in the same commit.
 */

export type Level = "none" | "view" | "edit";
export const LEVELS: readonly Level[] = ["none", "view", "edit"];
const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2 };

export interface Page {
  /** The address without its leading slash: "traffic", "seo/keywords"; the Command Center is "overview". */
  key: string;
  label: string;
  /** Only the owner ever sees it, whatever the grants say. */
  ownerOnly?: boolean;
  /** API prefixes that are this page's alone, so switching the page off refuses them too. */
  api?: readonly string[];
}

export interface Area {
  key: string;
  label: string;
  /** One line the owner reads on the access matrix. */
  about: string;
  pages: readonly Page[];
  /** API prefixes the area owns. Longest prefix wins across all areas. */
  api: readonly string[];
  /** The old console's addresses the area owns (src/server.ts, server-rendered). */
  console?: readonly string[];
  /** The levels that mean something here. Default none, view, edit. */
  levels?: readonly Level[];
  /** Personal data: shown with a warning on the matrix and left out of the gentler templates. */
  sensitive?: boolean;
}

const V = "/api/v1";
const seo = (key: string, label: string, api: string[] = [`${V}/seo/${key}`]): Page => ({ key: `seo/${key}`, label, api });

/** The areas, in the sidebar's order. Keep in step with web/src/components/shell/nav.ts. */
export const AREAS: readonly Area[] = [
  {
    key: "overview",
    label: "Command Center",
    about: "The website today: tiles, traffic, what needs attention and the recent activity.",
    pages: [{ key: "overview", label: "Command Center", api: [`${V}/overview`] }],
    api: [`${V}/overview`],
    levels: ["none", "view"],
  },
  {
    key: "insights",
    label: "Insights",
    about: "Articles: plan, write and publish. Edit lets them create, retry and publish under their own address.",
    pages: [{ key: "insights", label: "Insights" }],
    api: [`${V}/insights`, `${V}/article`],
    console: ["/draft", "/link"],
  },
  {
    key: "traffic",
    label: "Traffic",
    about: "Who visits and from where: GA4, Clarity and the live visitors.",
    pages: [{ key: "traffic", label: "Traffic" }],
    api: [`${V}/traffic`],
    levels: ["none", "view"],
  },
  {
    key: "seo",
    label: "SEO",
    about: "Search queries, keywords, indexing, technical checks and the SEO engine. Edit lets them run audits and work the opportunities.",
    pages: [
      { key: "seo", label: "Overview", api: [`${V}/seo/overview`] },
      seo("opportunities", "Opportunities"),
      seo("pages", "Pages", [`${V}/seo/pages`, `${V}/seo/optimize`]),
      seo("keywords", "Keywords"),
      seo("content-gaps", "Content Gaps"),
      seo("backlinks", "Backlinks"),
      seo("technical", "Technical", [`${V}/seo/technical`, `${V}/spider`]),
      seo("search-console", "Search Console"),
      seo("competitors", "Competitors"),
      seo("ai-search", "AI Search"),
      seo("automations", "Automations"),
    ],
    api: [`${V}/seo`, `${V}/spider`],
  },
  {
    key: "pages",
    label: "Pages",
    about: "Every page of the site with what the crawler and Google say about it.",
    pages: [{ key: "pages", label: "Pages" }],
    api: [`${V}/pages`],
    levels: ["none", "view"],
  },
  {
    key: "content",
    label: "Content",
    about: "The quality and coverage of what is written, and the old console's queue.",
    pages: [{ key: "content", label: "Content" }],
    api: [`${V}/content`],
    console: ["/console"],
    levels: ["none", "view"],
  },
  {
    key: "conversions",
    label: "Conversions",
    about: "From visitor to enquiry: the funnel and the forms, as counts.",
    pages: [{ key: "conversions", label: "Conversions" }],
    api: [`${V}/conversions`],
    levels: ["none", "view"],
  },
  {
    key: "leads",
    label: "Leads",
    about: "Enquiries and booked calls. View shows counts; names, contact details and messages need the enquiry right as well.",
    pages: [{ key: "leads", label: "Leads" }],
    api: [`${V}/leads`],
    levels: ["none", "view"],
    sensitive: true,
  },
  {
    key: "experiments",
    label: "Experiments",
    about: "Tests on the site and the comparisons kept. Edit lets them save and delete comparisons.",
    pages: [{ key: "experiments", label: "Experiments" }],
    api: [`${V}/experiments`],
  },
  {
    key: "site-health",
    label: "Site Health",
    about: "Uptime, speed, errors, the logs and the deployments.",
    pages: [{ key: "site-health", label: "Site Health" }],
    api: [`${V}/health`],
    levels: ["none", "view"],
  },
  {
    key: "hosting",
    label: "Hosting",
    about: "True page views, Vercel builds, the domain and the engine's health.",
    pages: [{ key: "hosting", label: "Hosting" }],
    api: [`${V}/hosting`],
    levels: ["none", "view"],
  },
  {
    key: "automations",
    label: "Automations",
    about: "The scheduled jobs and the article writer. Edit lets them run what is due; switching a job off stays the owner's.",
    pages: [{ key: "automations", label: "Automations" }],
    api: [`${V}/automations`],
  },
  {
    key: "assets",
    label: "Assets",
    about: "Pictures, covers and films on the site.",
    pages: [{ key: "assets", label: "Assets" }],
    api: [`${V}/assets`],
    levels: ["none", "view"],
  },
  {
    key: "operator",
    label: "AI Operator",
    about: "Ask about the website and approve its proposals. It reads every area's figures to answer, so give it to people who may see them.",
    pages: [{ key: "operator", label: "AI Operator" }],
    api: [`${V}/operator`],
  },
  {
    key: "settings",
    label: "Settings",
    about: "Sources, sign-in, writing and the server. Only the owner changes anything there.",
    pages: [{ key: "settings", label: "Settings" }],
    api: [`${V}/settings`],
    levels: ["none", "view"],
  },
  {
    key: "team",
    label: "Team",
    about: "The team list. Activity, access and invitations are the owner's alone, whatever this says.",
    pages: [
      { key: "team", label: "Activity", ownerOnly: true, api: [`${V}/team/activity`] },
      { key: "team/members", label: "Members", api: [`${V}/team/members`] },
      { key: "team/access", label: "Access & Roles", ownerOnly: true, api: [`${V}/team/access`] },
      { key: "team/invitations", label: "Invitations", ownerOnly: true, api: [`${V}/team/invitations`] },
    ],
    api: [`${V}/team`],
    console: ["/people"],
    levels: ["none", "view"],
  },
];

export const AREA_KEYS = AREAS.map((a) => a.key);
const BY_KEY = new Map(AREAS.map((a) => [a.key, a]));
const PAGE_LIST = AREAS.flatMap((a) => a.pages.map((p) => ({ ...p, area: a.key })));
const PAGE_KEYS = new Set(PAGE_LIST.map((p) => p.key));

/** The levels an area offers. */
export const levelsOf = (a: Area): readonly Level[] => a.levels ?? LEVELS;
const ceilingOf = (a: Area): Level => levelsOf(a).at(-1) ?? "view";

/** The two calls everybody may always make: who am I (a person waiting for access must learn that they are), and the page's minute beat. */
const EXEMPT = [`${V}/me`, `${V}/team/beat`];

const within = (path: string, prefix: string) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);

const AREA_PREFIXES = AREAS.flatMap((a) => [...a.api, ...(a.console ?? [])].map((p) => [p, a] as const)).sort((x, y) => y[0].length - x[0].length);
const PAGE_PREFIXES = PAGE_LIST.flatMap((p) => (p.api ?? []).map((x) => [x, p] as const)).sort((x, y) => y[0].length - x[0].length);

/** Which area serves this path (an API path or the old console's), or null when none does. Longest prefix wins. */
export function areaOfPath(path: string): Area | null {
  const p = path.split("?")[0];
  if (EXEMPT.some((x) => within(p, x))) return null;
  return AREA_PREFIXES.find(([pre]) => within(p, pre))?.[1] ?? null;
}

/** Which page's own API this path is, or null when it belongs to its area as a whole. */
export function pageOfPath(path: string): (Page & { area: string }) | null {
  const p = path.split("?")[0];
  return PAGE_PREFIXES.find(([pre]) => within(p, pre))?.[1] ?? null;
}

/**
 * Which page an address of the interface is: "/seo/pages/view" is SEO's Pages,
 * "/insights/12" is Insights, "/" and the Command Center's two lists are the
 * Command Center. Null for an address that is no page of the desk.
 */
export function pageOfHref(href: string): (Page & { area: string }) | null {
  const parts = href.split(/[?#]/)[0].split("/").filter(Boolean);
  if (!parts.length || parts[0] === "activity" || parts[0] === "attention") return PAGE_LIST.find((p) => p.key === "overview") ?? null;
  for (let n = Math.min(parts.length, 2); n > 0; n--) {
    const key = parts.slice(0, n).join("/");
    const hit = PAGE_LIST.find((p) => p.key === key);
    if (hit) return hit;
  }
  return null;
}

export const pageLabel = (key: string): string => {
  const p = PAGE_LIST.find((x) => x.key === key);
  if (!p) return key;
  const a = BY_KEY.get(p.area);
  return a && a.pages.length > 1 ? `${a.label} › ${p.label}` : p.label;
};
export const areaOf = (key: string): Area | null => BY_KEY.get(key) ?? null;

/* ---------- a person's grants ------------------------------------------------ */

/**
 * A person's row: area keys carry a Level; `page:<key>` keys OVERRIDE the area
 * for one page (kept even when "none": an override says something). NULL in
 * the database means no row at all: everything, as before.
 */
export type Grants = Record<string, Level>;

/** Read a stored row, keeping only what still means something: an area or page that exists, a level it offers. */
export function parseGrants(raw: unknown): Grants | null {
  if (raw === null || raw === undefined || raw === "") return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      /* A row nobody can read is a row that grants nothing: refused, never widened. */
      return {};
    }
  }
  if (obj === null) return null;
  if (typeof obj !== "object" || Array.isArray(obj)) return {};
  return clean(obj as Record<string, unknown>);
}

/** Only real areas and pages, only levels they offer; "none" for an area is the same as leaving it out. */
export function clean(given: Record<string, unknown>): Grants {
  const out: Grants = {};
  for (const [k, v] of Object.entries(given)) {
    const level = String(v ?? "") as Level;
    if (!LEVELS.includes(level)) continue;
    if (k.startsWith("page:")) {
      const page = PAGE_LIST.find((p) => p.key === k.slice(5));
      if (!page || page.ownerOnly) continue;
      const area = BY_KEY.get(page.area)!;
      if (area.pages.length < 2 || !levelsOf(area).includes(level)) continue;
      out[k] = level;
      continue;
    }
    const area = BY_KEY.get(k);
    if (!area || level === "none" || !levelsOf(area).includes(level)) continue;
    out[k] = level;
  }
  /* A page override under an area that is not granted at all can only say "none", which it already is. */
  for (const k of Object.keys(out)) {
    if (!k.startsWith("page:")) continue;
    const page = PAGE_LIST.find((p) => p.key === k.slice(5))!;
    if (!out[page.area]) delete out[k];
  }
  return out;
}

/** Everything the desk gives somebody with no row, written out as a row: where "customise" starts, so it never means "start from nothing". */
export function fullGrants(): Grants {
  const out: Grants = {};
  for (const a of AREAS) out[a.key] = ceilingOf(a);
  return out;
}

export interface Holder {
  owner: boolean;
  revoked: boolean;
  grants: Grants | null;
}

/** What this person may do in this area, grants and ownership both applied. */
export function areaLevel(who: Holder, key: string): Level {
  const area = BY_KEY.get(key);
  if (!area || who.revoked) return "none";
  if (who.owner || !who.grants) return ceilingOf(area);
  const g = who.grants[key] ?? "none";
  return levelsOf(area).includes(g) ? g : "none";
}

/**
 * One page's level: owner-only pages are the owner's; an override when the
 * row has one (either way: SEO on view with Opportunities on edit is a thing
 * to want); the area's otherwise. A page never opens in an area that is off.
 */
export function pageLevel(who: Holder, key: string): Level {
  const page = PAGE_LIST.find((p) => p.key === key);
  if (!page || who.revoked) return "none";
  const area = BY_KEY.get(page.area)!;
  if (page.ownerOnly) return who.owner ? ceilingOf(area) : "none";
  const base = areaLevel(who, page.area);
  if (who.owner || !who.grants || base === "none") return base;
  const o = who.grants[`page:${key}`];
  return o && levelsOf(area).includes(o) ? o : base;
}

/** The higher of two levels. */
export const higher = (a: Level, b: Level): Level => (RANK[a] >= RANK[b] ? a : b);

/** Does a request of this method pass at this level? A change needs edit. */
export function allows(level: Level, method: string): boolean {
  if (level === "none") return false;
  if (level === "edit") return true;
  return /^(GET|HEAD|OPTIONS)$/i.test(method);
}

/** May see at least one page / may change on at least one: the rule for paths that belong to no area. */
export const seesAnything = (who: Holder): boolean => PAGE_LIST.some((p) => pageLevel(who, p.key) !== "none");
export const changesAnything = (who: Holder): boolean => PAGE_LIST.some((p) => pageLevel(who, p.key) === "edit");

export interface Verdict {
  ok: boolean;
  /** One sentence for a refusal. */
  why?: string;
}

/**
 * THE RULE, for one request. Called by the server's gate (src/server.ts) for
 * every path past sign-in, the API's and the old console's alike, so there is
 * one door and not a check per route.
 */
export function judge(who: Holder, path: string, method: string): Verdict {
  if (who.owner) return { ok: true };
  const p = path.split("?")[0];
  if (EXEMPT.some((x) => within(p, x))) return { ok: true };
  const area = areaOfPath(p);
  if (!area) {
    const isApi = p === "/api" || p.startsWith("/api/");
    if (!isApi) return { ok: true };
    if (!seesAnything(who)) return { ok: false, why: "The owner has not given you access to anything on the desk yet." };
    if (!allows("view", method) && !changesAnything(who)) return { ok: false, why: "You can look at the desk but not change anything on it." };
    return { ok: true };
  }
  const page = pageOfPath(p);
  const level = page && page.area === area.key ? pageLevel(who, page.key) : areaLevel(who, area.key);
  if (allows(level, method)) return { ok: true };
  const what = page && page.area === area.key && area.pages.length > 1 ? `${area.label} › ${page.label}` : area.label;
  return {
    ok: false,
    why: level === "none" ? `You do not have access to ${what}. Ask the owner for it.` : `You can view ${what} but not change it. Ask the owner for edit access.`,
  };
}

/** The whole picture for one person: what the sidebar shows, what /me answers. */
export function accessOf(who: Holder): { restricted: boolean; areas: Record<string, Level>; pages: Record<string, Level>; home: string | null } {
  const areas: Record<string, Level> = {};
  const pages: Record<string, Level> = {};
  for (const a of AREAS) {
    areas[a.key] = areaLevel(who, a.key);
    for (const p of a.pages) pages[p.key] = pageLevel(who, p.key);
  }
  const first = PAGE_LIST.find((p) => pages[p.key] !== "none");
  return { restricted: !who.owner && !!who.grants, areas, pages, home: first ? (first.key === "overview" ? "/" : `/${first.key}`) : null };
}

/* ---------- templates ------------------------------------------------------- */

export interface Preset {
  key: string;
  label: string;
  about: string;
  /** null: no restriction at all (removes the row rather than listing every area). */
  grants: Grants | null;
}

/**
 * A starting point per kind of work, so adding a teammate is one click and not
 * sixteen. Suggestions the owner then edits: nothing applies one on its own,
 * except the newcomer rule below when the owner chose one. None of them gives
 * Leads: an enquiry is a stranger's personal data, granted person by person.
 */
export const PRESETS: readonly Preset[] = [
  { key: "administrator", label: "Administrator", about: "Every area, as the desk gave everybody before access existed. Owner-only doors stay the owner's.", grants: null },
  {
    key: "content-editor",
    label: "Content Editor",
    about: "Writes and publishes articles; sees content, pages, assets and SEO.",
    grants: { overview: "view", insights: "edit", content: "view", pages: "view", assets: "view", seo: "view", traffic: "view", team: "view" },
  },
  {
    key: "seo-analyst",
    label: "SEO Analyst",
    about: "Works SEO end to end; reads traffic, pages, content and site health.",
    grants: { overview: "view", seo: "edit", pages: "view", content: "view", traffic: "view", "site-health": "view", insights: "view", conversions: "view", team: "view" },
  },
  {
    key: "developer",
    label: "Developer",
    about: "Site health, hosting, automations and experiments; the technical SEO.",
    grants: { overview: "view", "site-health": "view", hosting: "view", automations: "edit", experiments: "edit", pages: "view", seo: "view", assets: "view", settings: "view", team: "view" },
  },
  {
    key: "analyst",
    label: "Analyst",
    about: "Reads the figures: traffic, conversions, SEO, pages and experiments. Changes nothing.",
    grants: { overview: "view", traffic: "view", conversions: "view", seo: "view", pages: "view", experiments: "view", insights: "view", team: "view" },
  },
  {
    key: "viewer",
    label: "Viewer",
    about: "Read-only on every area except Leads, Settings and Team.",
    grants: Object.fromEntries(AREAS.filter((a) => !a.sensitive && a.key !== "settings" && a.key !== "team").map((a) => [a.key, "view" as Level])),
  },
];

const sameGrants = (a: Grants | null, b: Grants | null): boolean => {
  if (a === null || b === null) return a === b;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

/**
 * What a person's grants are called: the template they match exactly, or
 * "Custom". Worked out every time rather than stored, so the name on the team
 * list can never disagree with what the person can actually do.
 */
export function roleOf(who: Holder): { key: string; label: string } {
  if (who.owner) return { key: "owner", label: "Owner" };
  if (who.grants && !seesAnything(who)) return { key: "waiting", label: "No access yet" };
  const hit = PRESETS.find((p) => sameGrants(p.grants === null ? null : clean(p.grants), who.grants));
  return hit ? { key: hit.key, label: hit.label } : { key: "custom", label: "Custom" };
}

/* ---------- what a newcomer gets ---------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS team_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

/** "full": everything, as before (the default). "nothing": they wait for the owner. Else a template's key. */
export type Newcomers = "full" | "nothing" | string;

export function newcomers(): Newcomers {
  const r = db.prepare("SELECT value FROM team_settings WHERE key = 'newcomers'").get() as { value: string } | undefined;
  const v = r?.value ?? "full";
  return v === "full" || v === "nothing" || PRESETS.some((p) => p.key === v) ? v : "full";
}

export function setNewcomers(v: Newcomers): void {
  db.prepare("INSERT INTO team_settings (key, value) VALUES ('newcomers', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(v);
}

/** The grants a person signing in for the first time, uninvited, starts with. */
export function newcomerGrants(): Grants | null {
  const v = newcomers();
  if (v === "full") return null;
  if (v === "nothing") return {};
  const p = PRESETS.find((x) => x.key === v);
  return p?.grants ? clean(p.grants) : null;
}

/** For storing: NULL for no row, else the cleaned row as JSON. */
export const grantsColumn = (g: Grants | null): string | null => (g === null ? null : JSON.stringify(clean(g)));

/** Is this a page key the desk knows? */
export const isPage = (key: string): boolean => PAGE_KEYS.has(key);
