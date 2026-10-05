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
 * light, the search box, the list of jobs) is open to anybody who may see at
 * least one area. Three things that look like one are not:
 *
 *   the activity feed   is the Command Center's. It carries every part of the
 *                       desk's news, so it is an area's route like any other,
 *                       and the bell shows somebody without the Command
 *                       Center only the rows that lead to a page they have
 *                       (`readsFeed`, `noticeFor`).
 *   running a job       is a change, and it follows the areas the job feeds:
 *                       edit on Automations runs any job; anybody else who
 *                       may change something runs the jobs behind the areas
 *                       they see (`JOB_AREAS`, `mayRunJob`). What a job's
 *                       last run said is read by the same people (`seesJob`).
 *   an SEO address      that is no single page's follows the page switches
 *                       all the same: the earlier screen needs every page, a
 *                       button the pages that draw it, the rest one page.
 *
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
  /**
   * API prefixes that are this page's, so switching the page off refuses them
   * too. Several pages may list the same prefix (a button drawn on each): the
   * address then follows the highest of their levels.
   */
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
    /* The activity feed is the Command Center's: it tells every part of the desk's news (people, proposals, incidents), so it is not a route for anybody with one page. */
    pages: [{ key: "overview", label: "Command Center", api: [`${V}/overview`, `${V}/activity`] }],
    api: [`${V}/overview`, `${V}/activity`],
    levels: ["none", "view"],
  },
  {
    key: "insights",
    label: "Insights",
    about: "Articles: plan, write and publish. Edit lets them create, retry and publish under their own address.",
    pages: [{ key: "insights", label: "Insights" }],
    api: [`${V}/insights`, `${V}/article`],
    /* The covers the desk drew (a draft's too, before anything is published) and the matcher are Insights' own, like the pages that show them. */
    console: ["/draft", "/link", "/cover", "/match"],
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
    about: "Search queries, keywords, indexing, technical checks and the SEO engine. Edit lets them run audits and work the opportunities. Its AI buttons, and the answers they lead to, need the AI Operator as well.",
    /* A button's address belongs to the pages that draw it: the cluster map is Keywords', "sent to
       Google" is on Technical and on Search Console, an owner task is closed from three pages. What the desk
       does at Google itself (/seo/google: inspect an address, submit a sitemap, IndexNow) is a panel of
       Technical whose buttons Search Console and Pages draw too. */
    pages: [
      { key: "seo", label: "Overview", api: [`${V}/seo/overview`] },
      /* Taking an opportunity's action and closing an audit step are drawn on Technical too (its opportunities
         card), so both pages list those two addresses: listed by Technical alone they would stop being Opportunities'. */
      seo("opportunities", "Opportunities", [`${V}/seo/opportunities`, `${V}/seo/opportunities/act`, `${V}/seo/opportunities/owner-task`]),
      seo("pages", "Pages", [`${V}/seo/pages`, `${V}/seo/optimize`, `${V}/seo/google`]),
      seo("keywords", "Keywords", [`${V}/seo/keywords`, `${V}/seo/clusters`]),
      seo("content-gaps", "Content Gaps", [`${V}/seo/content-gaps`, `${V}/seo/owner-tasks`]),
      seo("backlinks", "Backlinks", [`${V}/seo/backlinks`, `${V}/seo/owner-tasks`]),
      seo("technical", "Technical", [`${V}/seo/technical`, `${V}/spider`, `${V}/seo/indexing`, `${V}/seo/google`, `${V}/seo/opportunities/act`, `${V}/seo/opportunities/owner-task`]),
      seo("search-console", "Search Console", [`${V}/seo/search-console`, `${V}/seo/indexing`, `${V}/seo/google`]),
      seo("competitors", "Competitors"),
      seo("ai-search", "AI Search"),
      seo("automations", "Automations", [`${V}/seo/automations`, `${V}/seo/owner-tasks`]),
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
    about: "The scheduled jobs and the article writer. Edit lets them run any job, and what is due; switching a job off stays the owner's.",
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
    about: "Ask about the website and work with its proposals. It reads every area's figures to answer, so give it to people who may see them. Approving a proposal changes the live site, so it also needs publishing: an address and edit on Insights.",
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

/** The pages whose own API this path is: every page that lists the longest prefix it falls under. Empty when it belongs to its area as a whole. */
export function pagesOfPath(path: string): (Page & { area: string })[] {
  const p = path.split("?")[0];
  const longest = PAGE_PREFIXES.find(([pre]) => within(p, pre))?.[0];
  return longest === undefined ? [] : PAGE_PREFIXES.filter(([pre]) => pre === longest).map(([, page]) => page);
}

/** The first of them, or null: for a caller that only needs to name one. */
export const pageOfPath = (path: string): (Page & { area: string }) | null => pagesOfPath(path)[0] ?? null;

/**
 * THE EARLIER SEO SCREEN (src/cc/routes/seo.ts: the first screen, its lists
 * and its report) draws several SEO pages' panels in one answer, so it is no
 * single page's. Exactly `/api/v1/seo` and what is under /list and /report:
 * never `/api/v1/seo` as a prefix, which would claim /nav, /audit and every
 * page's own address.
 */
const isEarlierSeo = (p: string): boolean => p === `${V}/seo` || within(p, `${V}/seo/list`) || within(p, `${V}/seo/report`);

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

/** The higher, and the lower, of two levels. */
export const higher = (a: Level, b: Level): Level => (RANK[a] >= RANK[b] ? a : b);
const lower = (a: Level, b: Level): Level => (RANK[a] <= RANK[b] ? a : b);

/**
 * What the earlier SEO screen is to this person: the LOWEST of SEO's pages. It
 * carries panels of several of them in one answer, so it opens only for
 * somebody for whom no SEO page is switched off; the owner and a person with
 * no grants get the ceiling, as everywhere.
 */
export function earlierSeo(who: Holder): Level {
  const area = BY_KEY.get("seo")!;
  return area.pages.map((p) => pageLevel(who, p.key)).reduce(lower, ceilingOf(area));
}

/** Does a request of this method pass at this level? A change needs edit. */
export function allows(level: Level, method: string): boolean {
  if (level === "none") return false;
  if (level === "edit") return true;
  return /^(GET|HEAD|OPTIONS)$/i.test(method);
}

/** May see at least one page / may change on at least one: the rule for paths that belong to no area. */
export const seesAnything = (who: Holder): boolean => PAGE_LIST.some((p) => pageLevel(who, p.key) !== "none");
export const changesAnything = (who: Holder): boolean => PAGE_LIST.some((p) => pageLevel(who, p.key) === "edit");

/**
 * THE BELL. The top bar's notices are the newest rows of the activity feed,
 * and the feed is the Command Center's. Somebody who has the Command Center
 * reads the whole feed anyway (`readsFeed`: the owner and a person with no
 * grants come out true by themselves). Anybody else is shown a row only when
 * it LEADS to a page they may open (`noticeFor`): a row with no link, or one
 * that leads outside the desk, says something about a part of the desk nobody
 * can vouch they were given (a person switched off, a deployment, an
 * incident), so it is left out, never passed through.
 */
export const readsFeed = (who: Holder): boolean => pageLevel(who, "overview") !== "none";
export function noticeFor(who: Holder, href: string | null | undefined): boolean {
  if (!href) return false;
  const page = pageOfHref(href);
  return !!page && pageLevel(who, page.key) !== "none";
}

/* ---------- the scheduled jobs --------------------------------------------------- */

/**
 * WHAT EACH SCHEDULED JOB FEEDS: the areas whose screens it fills, and whose
 * "refresh" button asks for it. Running a job is no single area's, so the
 * gate decides it from this table:
 *
 *   run it          edit on Automations (any job, and what is due); or, for
 *                   somebody who may change something on the desk at all, at
 *                   least view on one area the job feeds: the refresh behind
 *                   a screen they have. Not edit on that area: seven of them
 *                   offer only none and view.
 *   read its note   view on one of the same areas, or Automations. What the
 *                   last run said (pages crawled, queries read) is those
 *                   areas' figures.
 *
 * A job that is not in the table is Automations' alone: a collector added
 * later stays closed until somebody says here what it feeds, and cannot open
 * by being forgotten. Keep in step with the collectors' own headers (src/cc).
 */
const JOB_AREAS = new Map<string, readonly string[]>(
  Object.entries({
    /* The website, read page by page: every screen that shows a page, a link, a picture or an issue. */
    crawl: ["overview", "pages", "content", "seo", "site-health", "assets", "operator"],
    assets: ["assets"],
    speed: ["seo", "site-health"],
    "crux-daily": ["seo", "site-health"],
    probe: ["site-health", "overview"],
    sitemap: ["seo", "site-health", "pages"],
    /* The website's history, Vercel and the engine's health. */
    repo: ["hosting", "site-health"],
    vercel: ["hosting", "site-health"],
    "vercel-status": ["hosting", "site-health"],
    engine: ["hosting", "site-health"],
    /* Visitors. */
    "ga4-live": ["traffic", "conversions", "overview"],
    "ga4-warm": ["traffic", "conversions", "overview"],
    "clarity-daily": ["traffic", "conversions", "overview"],
    /* Search, and the SEO engine's own. */
    "gsc-access": ["seo"],
    "gsc-daily": ["seo"],
    "gsc-inspect": ["seo"],
    "bing-daily": ["seo"],
    "seo-snapshot": ["seo"],
    "seo-engine": ["seo"],
    "seo-readiness": ["seo"],
    "seo-referrals": ["seo"],
    "seo-research": ["seo"],
    "seo-competitors": ["seo"],
    "seo-presence": ["seo"],
  }),
);

const feedsThem = (who: Holder, job: string): boolean => (JOB_AREAS.get(job) ?? []).some((k) => areaLevel(who, k) !== "none");

/** May this person run this job now. True for the owner and for a person with no grants without a special case: both have Automations on edit. */
export const mayRunJob = (who: Holder, job: string): boolean => areaLevel(who, "automations") === "edit" || (changesAnything(who) && feedsThem(who, job));

/** May this person read what the job's last run said. */
export const seesJob = (who: Holder, job: string): boolean => areaLevel(who, "automations") !== "none" || feedsThem(who, job);

const JOB_RUN = /^\/api\/v1\/jobs\/([^/]+)\/run$/;

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
  const change = !allows("view", method);

  /* Running a job: decided here and not in its handler, so a refusal is the gate's and is recorded as one. */
  const job = change ? JOB_RUN.exec(p) : null;
  if (job) {
    if (!seesAnything(who)) return { ok: false, why: "The owner has not given you access to anything on the desk yet." };
    if (mayRunJob(who, job[1])) return { ok: true };
    if (!changesAnything(who)) return { ok: false, why: "You can look at the desk but not change anything on it." };
    return { ok: false, why: "That job reads for a part of the desk the owner has not given you. Ask the owner for that part, or for edit access to Automations." };
  }

  const area = areaOfPath(p);
  if (!area) {
    const isApi = p === "/api" || p.startsWith("/api/");
    if (!isApi) return { ok: true };
    if (!seesAnything(who)) return { ok: false, why: "The owner has not given you access to anything on the desk yet." };
    if (change && !changesAnything(who)) return { ok: false, why: "You can look at the desk but not change anything on it." };
    return { ok: true };
  }

  const several = area.pages.length > 1;
  const mine = pagesOfPath(p).filter((x) => x.area === area.key);
  let level: Level;
  let what = area.label;
  let first = "";
  if (area.key === "seo" && isEarlierSeo(p)) {
    level = earlierSeo(who);
    const off = area.pages.find((x) => pageLevel(who, x.key) === "none");
    if (off && areaLevel(who, area.key) !== "none") {
      what = `${area.label} › ${off.label}`;
      first = "This screen shows figures of every SEO page at once. ";
    }
  } else if (mine.length) {
    /* A button drawn on several pages follows the highest of them: refusing it for one page's level would refuse the other page's button. */
    level = mine.map((x) => pageLevel(who, x.key)).reduce(higher, "none");
    if (several) what = `${area.label} › ${mine.map((x) => x.label).join(" or ")}`;
  } else {
    level = areaLevel(who, area.key);
    /* An address of the area as a whole, where the area has several pages (SEO's counts, its audit): it also
       needs one page of the area open at that level, so an area left "on" with every page off opens nothing. */
    if (several) level = lower(level, area.pages.map((x) => pageLevel(who, x.key)).reduce(higher, "none"));
  }
  if (allows(level, method)) return { ok: true };
  if (level === "none") return { ok: false, why: `${first}You do not have access to ${what}. Ask the owner for it.` };
  /* Where the area offers nothing to edit, nobody can be given it: say whose it is instead of sending them to ask. */
  return {
    ok: false,
    why: levelsOf(area).includes("edit") ? `You can view ${what} but not change it. Ask the owner for edit access.` : `Only the owner changes anything in ${what}.`,
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
    about: "Works SEO end to end, with the AI Operator that writes its briefs and proposals; reads traffic, pages, content and site health. Approving a proposal stays with people who publish.",
    /* SEO's own AI buttons post to the AI Operator and their answers open there, so the two go together. */
    grants: { overview: "view", seo: "edit", operator: "edit", pages: "view", content: "view", traffic: "view", "site-health": "view", insights: "view", conversions: "view", team: "view" },
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

/** The same access, whatever order the row lists it in: NULL (no row) only equals NULL. */
export const sameGrants = (a: Grants | null, b: Grants | null): boolean => {
  if (a === null || b === null) return a === b;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

/**
 * What a person's grants are called: the template they match exactly, or
 * "Custom". Worked out every time rather than stored, so the name on the team
 * list can never disagree with what the person was given. It names the STORED
 * row: somebody switched off keeps the name of the access they come back to
 * (that they are off is said beside it), and "No access yet" is only for a
 * row that opens nothing.
 */
export function roleOf(who: Holder): { key: string; label: string } {
  if (who.owner) return { key: "owner", label: "Owner" };
  if (who.grants && !seesAnything({ ...who, revoked: false })) return { key: "waiting", label: "No access yet" };
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
